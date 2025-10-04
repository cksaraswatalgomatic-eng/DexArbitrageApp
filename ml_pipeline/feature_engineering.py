from __future__ import annotations

import logging
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from pandas.api.types import is_datetime64_any_dtype

from .config import TrainingConfig

LOGGER = logging.getLogger(__name__)

ROLLING_NUMERIC_COLUMNS = [
    "buyDiffBps",
    "sellDiffBps",
    "cexVol",
    "dexVolume",
    "serverBuy",
    "serverSell",
]


def _safe_ratio(numerator, denominator, eps):
    return numerator / (denominator + eps)


def _add_base_columns(df: pd.DataFrame, config: TrainingConfig) -> pd.DataFrame:
    result = df.copy()
    numeric_cols = [
        "executedQtyDst",
        "executedDstPrice",
        "executedQtySrc",
        "executedSrcPrice",
        "buyDiffBps",
        "sellDiffBps",
        "cexVol",
        "dexVolume",
        "serverBuy",
        "serverSell",
        "netProfit",
    ]
    for col in numeric_cols:
        if col in result.columns:
            result[col] = pd.to_numeric(result[col], errors="coerce")
        else:
            result[col] = np.nan

    result["grossNotionalDst"] = result["executedQtyDst"].fillna(0) * result["executedDstPrice"].fillna(0)
    result["grossNotionalSrc"] = result["executedQtySrc"].fillna(0) * result["executedSrcPrice"].fillna(0)
    result["tradePnLRatio"] = _safe_ratio(result["netProfit"], result["grossNotionalDst"], config.imbalance_eps)
    result["spreadMid"] = (result["buyDiffBps"] + result["sellDiffBps"]) / 2.0
    result["liquidityImbalance"] = _safe_ratio(result["cexVol"], result["dexVolume"], config.imbalance_eps)
    if "rejectReason" in result.columns:
        result["hasRejectReason"] = result["rejectReason"].notna().astype(int)
    else:
        result["hasRejectReason"] = 0
    return result


def _apply_rolling_features(df: pd.DataFrame, config: TrainingConfig) -> pd.DataFrame:
    if df.empty:
        return df

    df = df[df[config.time_column].notna()].copy()
    if df.empty:
        return df

    df = df.sort_values(config.time_column)
    group_cols = ["serverId", config.token_column]

    for window in config.feature_windows_minutes:
        window_label = f"{window}m"
        rolling_obj = df.groupby(group_cols).rolling(window=f"{window}min", on=config.time_column)
        for col in ROLLING_NUMERIC_COLUMNS:
            if col not in df.columns:
                continue
            df[f"{col}_mean_{window_label}"] = rolling_obj[col].mean().reset_index(level=group_cols, drop=True)
            df[f"{col}_std_{window_label}"] = rolling_obj[col].std().reset_index(level=group_cols, drop=True)
            df[f"{col}_max_{window_label}"] = rolling_obj[col].max().reset_index(level=group_cols, drop=True)
            df[f"{col}_min_{window_label}"] = rolling_obj[col].min().reset_index(level=group_cols, drop=True)
        df[f"rejectRate_{window_label}"] = rolling_obj["hasRejectReason"].mean().reset_index(level=group_cols, drop=True)
        if "liquidityImbalance" in df.columns:
            series = rolling_obj["liquidityImbalance"]
            mean_series = series.mean().reset_index(level=group_cols, drop=True)
            std_series = series.std().reset_index(level=group_cols, drop=True)
            df[f"liquidityImbalance_mean_{window_label}"] = mean_series
            df[f"liquidityImbalance_std_{window_label}"] = std_series
            df[f"liquidityImbalance_z_{window_label}"] = (df["liquidityImbalance"] - mean_series) / (std_series.replace(0, np.nan))

    for hours in config.feature_windows_hours:
        window_label = f"{hours}h"
        rolling_obj = df.groupby(group_cols).rolling(window=f"{hours}h", on=config.time_column)
        for col in ("spreadMid", "tradePnLRatio", "netProfit"):
            if col not in df.columns:
                continue
            df[f"{col}_mean_{window_label}"] = rolling_obj[col].mean().reset_index(level=group_cols, drop=True)
            df[f"{col}_std_{window_label}"] = rolling_obj[col].std().reset_index(level=group_cols, drop=True)

    return df


def _prepare_balances_features(df: pd.DataFrame, config: TrainingConfig) -> Optional[pd.DataFrame]:
    if df is None or df.empty:
        return None
    balances = df.copy()
    time_col = "balance_ts" if "balance_ts" in balances.columns else "timestamp"
    balances = balances.sort_values(time_col)
    balances[time_col] = pd.to_datetime(balances[time_col], utc=True, errors="coerce")

    for window in config.feature_windows_hours:
        label = f"balanceDelta_{window}h"
        balances[label] = balances["total_usdt"].diff(periods=int(window)).fillna(0)
    balances.rename(columns={time_col: "feature_ts"}, inplace=True)

    keep_cols = [col for col in balances.columns if col.startswith("balanceDelta_")]
    for col in ("feature_ts", "total_usdt", "total_dex_usdt", "total_cex_usdt"):
        if col in balances.columns:
            keep_cols.append(col)
    return balances[keep_cols].drop_duplicates(subset="feature_ts")


def _prepare_gas_features(df: pd.DataFrame, config: TrainingConfig) -> Optional[pd.DataFrame]:
    if df is None or df.empty:
        return None
    gas = df.copy()
    time_col = "gas_ts" if "gas_ts" in gas.columns else "timestamp"
    gas[time_col] = pd.to_datetime(gas[time_col], utc=True, errors="coerce")
    gas.sort_values(time_col, inplace=True)
    gas["isLowGas"] = gas.get("is_low", 0)
    gas.rename(columns={time_col: "feature_ts", "gas": "gasBalance"}, inplace=True)
    keep_cols = [col for col in ("feature_ts", "gasBalance", "isLowGas") if col in gas.columns]
    return gas[keep_cols].drop_duplicates(subset="feature_ts")


def _prepare_contract_features(df: pd.DataFrame, config: TrainingConfig) -> Optional[pd.DataFrame]:
    if df is None or df.empty:
        return None
    contracts = df.copy()
    time_col = "tx_ts" if "tx_ts" in contracts.columns else "timestamp"
    contracts[time_col] = pd.to_datetime(contracts[time_col], utc=True, errors="coerce")
    contracts.sort_values(time_col, inplace=True)
    contracts["isError"] = contracts.get("isError", 0).astype(int)
    contracts.rename(columns={time_col: "feature_ts"}, inplace=True)
    contracts["errorCount1h"] = (
        contracts.set_index("feature_ts")["isError"].rolling("1H").sum().reset_index(drop=True)
    )
    keep_cols = [col for col in ("feature_ts", "isError", "errorCount1h") if col in contracts.columns]
    return contracts[keep_cols].drop_duplicates(subset="feature_ts")


def _merge_context_features(
    trades: pd.DataFrame,
    context_by_server: Dict[str, Dict[str, pd.DataFrame]],
    config: TrainingConfig,
) -> pd.DataFrame:
    if not context_by_server:
        return trades

    enriched_frames = []
    for server_id, trades_server in trades.groupby("serverId"):
        context = context_by_server.get(server_id, {})
        working = trades_server.sort_values(config.time_column)
        if not context:
            enriched_frames.append(working)
            continue

        balances = _prepare_balances_features(context.get("balances_history"), config)
        if balances is not None:
            working = pd.merge_asof(
                working.sort_values(config.time_column),
                balances.sort_values("feature_ts"),
                left_on=config.time_column,
                right_on="feature_ts",
                direction="backward",
                suffixes=("", "_balance"),
            )

        gas = _prepare_gas_features(context.get("gas_balances"), config)
        if gas is not None:
            working = pd.merge_asof(
                working.sort_values(config.time_column),
                gas.sort_values("feature_ts"),
                left_on=config.time_column,
                right_on="feature_ts",
                direction="backward",
                suffixes=("", "_gas"),
            )

        contracts = _prepare_contract_features(context.get("contract_transactions"), config)
        if contracts is not None and not contracts.empty:
            working = pd.merge_asof(
                working.sort_values(config.time_column),
                contracts.sort_values("feature_ts"),
                left_on=config.time_column,
                right_on="feature_ts",
                direction="backward",
                suffixes=("", "_contract"),
            )

        enriched_frames.append(working)

    return pd.concat(enriched_frames, axis=0, ignore_index=True)


def build_feature_matrix(
    trades: pd.DataFrame,
    context_by_server: Dict[str, Dict[str, pd.DataFrame]],
    config: TrainingConfig,
) -> Tuple[pd.DataFrame, pd.Series, Dict[str, List[str]]]:
    if trades.empty:
        return trades, pd.Series(dtype=float), {"feature_columns": [], "categorical_columns": []}

    LOGGER.info("Building feature matrix from %d trades", len(trades))

    enriched = _add_base_columns(trades, config)
    enriched = _apply_rolling_features(enriched, config)
    enriched = _merge_context_features(enriched, context_by_server, config)

    target_col = config.target
    if target_col not in enriched.columns:
        raise KeyError(f"Target column {target_col} missing from dataset")

    enriched = enriched.dropna(subset=[target_col, config.time_column])
    timestamps = enriched[config.time_column].copy()

    categorical_columns = [
        col
        for col in ("serverId", config.token_column, "status", "rejectReason", "propExecutionMode")
        if col in enriched.columns
    ]

    drop_columns = set(
        [
            "id_x",
            "id_y",
            "props",
            "raw_data",
            "creationTime",
            "openTime",
            "lastUpdateTime",
            "feature_ts",
        ]
    )
    drop_columns.add(target_col)
    drop_columns.add(config.time_column)

    feature_columns = [col for col in enriched.columns if col not in drop_columns]
    feature_columns = [col for col in feature_columns if not is_datetime64_any_dtype(enriched[col])]
    inferred_cats = [col for col in feature_columns if enriched[col].dtype == 'object']
    categorical_columns = sorted(set(categorical_columns).union(inferred_cats))

    features = enriched[feature_columns].copy()
    target = enriched[target_col].copy()

    non_empty_mask = features.notna().any(axis=0)
    mask_dict = non_empty_mask.to_dict()
    if not non_empty_mask.all():
        dropped = [col for col, keep in mask_dict.items() if not keep]
        if dropped:
            LOGGER.info('Dropping %d feature(s) with no observed values: %s', len(dropped), dropped)
    features = features.loc[:, [col for col, keep in mask_dict.items() if keep]]
    feature_columns = [col for col in feature_columns if mask_dict.get(col, False)]
    categorical_columns = [col for col in categorical_columns if mask_dict.get(col, False)]

    if config.task == 'classification':
        class_counts = target.value_counts(dropna=False).to_dict()
        LOGGER.info('Target distribution: %s', class_counts)

    meta = {
        "feature_columns": feature_columns,
        "categorical_columns": categorical_columns,
        "time_column": config.time_column,
        "target": target_col,
        "timestamps": timestamps,
    }

    return features, target, meta

