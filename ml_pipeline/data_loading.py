from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict, Iterable, Optional, Tuple

import pandas as pd
import numpy as np

from .config import TrainingConfig

LOGGER = logging.getLogger(__name__)


def _extract_token_from_pair(pair: Optional[str]) -> Optional[str]:
    if not pair:
        return None
    parts = pair.split("->")
    first_leg = parts[0] if parts else pair
    token_part = first_leg.split("_")[-1]
    if "/" in token_part:
        token_part = token_part.split("/")[0]
    if not token_part:
        return None
    return token_part.strip().lower()


def _token_from_cur_id(cur_id: Optional[str]) -> Optional[str]:
    if not cur_id:
        return None
    segments = cur_id.split("_")
    if len(segments) >= 2:
        return segments[1].strip().lower() or None
    return cur_id.strip().lower() or None


def _read_frame(base_path: Path, row_limit: Optional[int] = None) -> pd.DataFrame:
    parquet_path = base_path.with_suffix(".parquet")
    csv_path = base_path.with_suffix(".csv")

    if parquet_path.exists():
        df = pd.read_parquet(parquet_path)
    elif csv_path.exists():
        try:
            df = pd.read_csv(csv_path)
        except pd.errors.EmptyDataError:
            LOGGER.warning("CSV file is empty: %s", csv_path)
            return pd.DataFrame()
    else:
        LOGGER.warning("Missing dataset for %s", base_path)
        return pd.DataFrame()

    if row_limit is not None and row_limit > 0:
        df = df.head(row_limit)
    return df


def _ensure_datetime(df: pd.DataFrame, columns: Iterable[str]) -> pd.DataFrame:
    for col in columns:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], utc=True, errors="coerce")
    return df


def load_server_dataset(config: TrainingConfig, server_id: str) -> Tuple[pd.DataFrame, Dict[str, pd.DataFrame]]:
    server_dir = config.data_root / server_id
    if not server_dir.exists():
        LOGGER.warning("Server directory missing: %s", server_dir)
        return pd.DataFrame(), {}

    trades = _read_frame(server_dir / "trades_with_diff", config.row_limit)
    if trades.empty:
        return trades, {}

    if config.token_column not in trades.columns:
        LOGGER.info("Column '%s' not found, attempting to derive it.", config.token_column)
        if "pair" in trades.columns:
            trades[config.token_column] = trades["pair"].apply(_extract_token_from_pair)
            LOGGER.info("Dynamically added missing '%s' column from 'pair' column.", config.token_column)
        elif "curId" in trades.columns:
            trades[config.token_column] = trades["curId"].apply(_token_from_cur_id)
            LOGGER.info("Dynamically added missing '%s' column from 'curId' column.", config.token_column)
        else:
            LOGGER.warning("Could not create missing '%s' column from 'pair' or 'curId'.", config.token_column)

    trades = _ensure_datetime(trades, ["trade_ts", "diff_ts", "balance_ts"])  # balance_ts may appear post-merge
    if "serverId_x" in trades.columns:
        trades.rename(columns={"serverId_x": "serverId"}, inplace=True)
    elif "serverId" not in trades.columns:
        trades["serverId"] = server_id

    context_tables: Dict[str, pd.DataFrame] = {}
    for name in ("balances_history", "gas_balances", "contract_transactions", "server_tokens", "liquidity_data"):
        frame = _read_frame(server_dir / name, config.row_limit)
        if frame.empty:
            continue
        if name == "balances_history":
            frame = _ensure_datetime(frame, ["balance_ts", "timestamp"])
        elif name == "gas_balances":
            frame = _ensure_datetime(frame, ["gas_ts", "timestamp"])
        elif name == "contract_transactions":
            frame = _ensure_datetime(frame, ["tx_ts", "timestamp"])
        elif name == "liquidity_data":
            frame = _ensure_datetime(frame, ["liq_ts", "timestamp"])
        context_tables[name] = frame

    return trades, context_tables


def load_datasets(config: TrainingConfig) -> Tuple[pd.DataFrame, Dict[str, Dict[str, pd.DataFrame]]]:
    LOGGER.info("Loading datasets from %s", config.data_root)
    all_trades = []
    context_by_server: Dict[str, Dict[str, pd.DataFrame]] = {}

    servers = config.servers or [p.name for p in config.data_root.iterdir() if p.is_dir()]
    for server_id in servers:
        trades, context = load_server_dataset(config, server_id)
        if trades.empty:
            continue
        trades["serverId"] = server_id
        all_trades.append(trades)
        context_by_server[server_id] = context

    if not all_trades:
        return pd.DataFrame(), context_by_server

    combined = pd.concat(all_trades, axis=0, ignore_index=True)

    if config.tokens:
        if config.token_column in combined.columns:
            combined = combined[combined[config.token_column].isin(config.tokens)]
        else:
            LOGGER.warning("Token filter specified but '%s' column not found.", config.token_column)

    if config.regression_target in combined.columns:
        label_series = pd.to_numeric(combined[config.regression_target], errors='coerce')
    else:
        label_series = pd.Series(np.nan, index=combined.index)

    if label_series.isna().all():
        fallback_cols = ['netProfit', 'executedProfit', 'executedGrossProfit']
        for col in fallback_cols:
            if col in combined.columns:
                fallback = pd.to_numeric(combined[col], errors='coerce')
                if not fallback.isna().all():
                    label_series = fallback
                    break
    combined[config.regression_target] = label_series

    if config.task == 'classification':
        threshold = config.classification_threshold if config.classification_threshold is not None else 0.0
        combined[config.target_column] = np.where(label_series > threshold, 1, 0)

    return combined, context_by_server

