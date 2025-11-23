#!/usr/bin/env python3
"""Export aligned trade/diff datasets per server and token.

This script enumerates configured servers, optionally triggers a fresh
fetch via the running Node backend, and then exports harmonised CSV
and Parquet artefacts ready for downstream ML pipelines.
"""
import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
import sqlite3

import pandas as pd

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')

SUPPORTED_FORMATS = {"csv", "parquet"}
TABLES_TO_EXPORT = (
    "completed_trades",
    "diff_history",
    "balances_history",
    "server_tokens",
    "gas_balances",
    "contract_transactions",
    "liquidity_data",
)
DEFAULT_TOLERANCE_MINUTES = 2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export ML datasets from server SQLite stores.")
    parser.add_argument(
        "--servers-config",
        default="servers.json",
        help="Path to servers.json configuration (default: servers.json).",
    )
    parser.add_argument(
        "--output-dir",
        default="data_exports",
        help="Destination directory for exported datasets (default: data_exports).",
    )
    parser.add_argument(
        "--formats",
        default="csv,parquet",
        help="Comma-separated list of output formats (supported: csv, parquet).",
    )
    parser.add_argument(
        "--servers",
        help="Comma-separated server IDs to include (default: all servers).",
    )
    parser.add_argument(
        "--row-limit",
        type=int,
        help="Optional maximum rows to load per table (for testing/debug).",
    )
    parser.add_argument(
        "--tolerance-minutes",
        type=float,
        default=DEFAULT_TOLERANCE_MINUTES,
        help="Merge tolerance in minutes when aligning trades with diff snapshots (default: 2).",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Trigger fetchAllAndStore via the running Node server before exporting.",
    )
    parser.add_argument(
        "--refresh-url",
        default="http://localhost:3000/admin/fetch-all",
        help="Endpoint to trigger refresh when --refresh is supplied (default: http://localhost:3000/admin/fetch-all).",
    )
    parser.add_argument(
        "--direction",
        choices=("backward", "nearest"),
        default="backward",
        help="merge_asof direction for diff alignment (default: backward).",
    )
    return parser.parse_args()


def read_servers(path: Path) -> Dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def ensure_formats(formats_arg: str) -> List[str]:
    formats = {fmt.strip().lower() for fmt in formats_arg.split(",") if fmt.strip()}
    unknown = formats - SUPPORTED_FORMATS
    if unknown:
        raise ValueError(f"Unsupported formats requested: {', '.join(sorted(unknown))}")
    if not formats:
        raise ValueError("At least one output format must be specified.")
    return sorted(formats)


def trigger_refresh(url: str) -> None:
    try:
        import urllib.request
        import urllib.error

        logging.info("Triggering refresh at %s", url)
        req = urllib.request.Request(url, method="POST")
        with urllib.request.urlopen(req, timeout=60) as resp:  # nosec B310
            if resp.status >= 300:
                raise RuntimeError(f"Refresh request failed with HTTP {resp.status}")
        logging.info("Refresh completed.")
    except Exception as exc:  # pylint: disable=broad-except
        logging.warning("Failed to trigger refresh: %s", exc)


def resolve_db_path(server_id: str) -> Path:
    return Path(f"data-{server_id}.sqlite")


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    )
    return cursor.fetchone() is not None


def read_table(conn: sqlite3.Connection, table_name: str, limit: Optional[int] = None) -> pd.DataFrame:
    if not table_exists(conn, table_name):
        logging.debug("Skipping missing table %s", table_name)
        return pd.DataFrame()
    query = f"SELECT * FROM {table_name}"
    if limit and limit > 0:
        query += f" LIMIT {int(limit)}"
    return pd.read_sql_query(query, conn)


def extract_token_from_pair(pair: Optional[str]) -> Optional[str]:
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


def token_from_cur_id(cur_id: Optional[str]) -> Optional[str]:
    if not cur_id:
        return None
    segments = cur_id.split("_")
    if len(segments) >= 2:
        return segments[1].strip().lower() or None
    return cur_id.strip().lower() or None


def parse_json_column(value: Optional[str]) -> Dict:
    if value in (None, ""):
        return {}
    if isinstance(value, dict):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return {}

def safe_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def enrich_trades(df: pd.DataFrame, server_id: str) -> pd.DataFrame:
    if df.empty:
        return df
    trades = df.copy()
    trades["serverId"] = server_id

    trades["trade_ts"] = pd.to_datetime(trades["lastUpdateTime"], unit="ms", utc=True, errors="coerce")
    trades["token"] = trades["pair"].apply(extract_token_from_pair)

    for col in ("executedQtyDst", "executedDstPrice", "executedSrcPrice", "executedQtySrc"):
        if col not in trades.columns:
            trades[col] = 0.0

    qty_dst = trades["executedQtyDst"].fillna(0.0)
    dst_price = trades["executedDstPrice"].fillna(0.0)
    src_price = trades["executedSrcPrice"].fillna(0.0)
    qty_src = trades["executedQtySrc"].fillna(0.0)

    trades["netProfit"] = (qty_dst * dst_price) - (src_price * qty_src) - (0.0002 * qty_dst * dst_price)
    trades["label_regression"] = trades["netProfit"].astype(float)
    trades["label_class"] = (trades["netProfit"] > 0).astype(int)

    trades["isHedged"] = trades.get("hedge", 0).fillna(0).astype(int)

    est_qty = trades.get("estimatedQty")
    trades["isPartialFill"] = False
    if est_qty is not None:
        trades["isPartialFill"] = (trades["executedQtyDst"].fillna(0) < est_qty.fillna(0)).astype(int)

    if "props" in trades.columns:
        def extract_props_features(payload):
            data = parse_json_column(payload)
            if not isinstance(data, dict):
                return {}
            result = {}
            for key, raw in data.items():
                key_str = str(key).strip().lower()
                if not key_str:
                    continue
                if key_str == 'diff':
                    result['propDiff'] = safe_float(raw)
                elif key_str in ('dexslip', 'dex_slip') or ('dex' in key_str and 'slip' in key_str):
                    result['propDexSlip'] = safe_float(raw)
                elif key_str in ('cexslip', 'cex_slip') or ('cex' in key_str and 'slip' in key_str):
                    result['propCexSlip'] = safe_float(raw)
                elif key_str in ('executioneta', 'execeta', 'eta') or ('eta' in key_str and 'exec' in key_str):
                    result['propExecutionEta'] = safe_float(raw)
                elif 'slippage' in key_str and 'dex' in key_str:
                    result['propDexSlippage'] = safe_float(raw)
                elif 'slippage' in key_str and 'cex' in key_str:
                    result['propCexSlippage'] = safe_float(raw)
                elif key_str in ('exec', 'execution', 'mode'):
                    result['propExecutionMode'] = str(raw) if raw is not None else None
            return result

        props_features = trades['props'].apply(extract_props_features)
        props_df = pd.DataFrame(props_features.tolist())
        if not props_df.empty:
            trades = pd.concat([trades, props_df], axis=1)

    return trades


def enrich_diff(df: pd.DataFrame, server_id: str) -> pd.DataFrame:
    if df.empty:
        return df
    diff = df.copy()
    diff["serverId"] = server_id
    diff["diff_ts"] = pd.to_datetime(diff["ts"], unit="ms", utc=True, errors="coerce")
    diff["token"] = diff["curId"].apply(token_from_cur_id)
    return diff


def enrich_balances(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    balances = df.copy()
    balances["balance_ts"] = pd.to_datetime(balances["timestamp"], utc=True, errors="coerce")
    return balances


def enrich_gas(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    gas = df.copy()
    gas["gas_ts"] = pd.to_datetime(gas["timestamp"], utc=True, errors="coerce")
    return gas


def enrich_contracts(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    contracts = df.copy()
    if contracts["timestamp"].dtype.kind in {"i", "u"}:
        contracts["tx_ts"] = pd.to_datetime(contracts["timestamp"], unit="ms", utc=True, errors="coerce")
    else:
        contracts["tx_ts"] = pd.to_datetime(contracts["timestamp"], utc=True, errors="coerce")
    return contracts


def enrich_liquidity(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    liq = df.copy()
    # liquidity_data has 'timestamp' string ISO format or similar
    liq["liq_ts"] = pd.to_datetime(liq["timestamp"], utc=True, errors="coerce")
    liq["token"] = liq["symbol"].astype(str).str.lower().str.strip()
    return liq


def write_dataframe(df: pd.DataFrame, base_path: Path, formats: Iterable[str], manifest_entry: Dict) -> None:
    if df is None or df.empty:
        manifest_entry["rows"] = 0
        return
    manifest_entry["rows"] = int(len(df))
    for fmt in formats:
        target = base_path.with_suffix(f".{fmt}")
        try:
            if fmt == "csv":
                df.to_csv(target, index=False)
            elif fmt == "parquet":
                df.to_parquet(target, index=False)
            manifest_entry.setdefault("artifacts", []).append(str(target))
        except Exception as exc:  # pylint: disable=broad-except
            logging.warning("Failed to write %s: %s", target, exc)
            manifest_entry.setdefault("errors", []).append({"file": str(target), "error": str(exc)})


def build_quality_rows(merged: pd.DataFrame, server_id: str) -> List[Dict]:
    if merged.empty:
        return []
    rows: List[Dict] = []
    grouped = merged.groupby(merged["token"].fillna("unknown"))
    for token, group in grouped:
        matched = group["curId"].notna().sum()
        total = len(group)
        row = {
            "serverId": server_id,
            "token": token,
            "tradeCount": int(total),
            "matchedDiffCount": int(matched),
            "missingDiffCount": int(total - matched),
        }
        if "trade_ts" in group.columns:
            row["firstTradeAt"] = group["trade_ts"].min()
            row["lastTradeAt"] = group["trade_ts"].max()
        rows.append(row)
    return rows


def create_exports_for_server(
    server_id: str,
    server_conn: sqlite3.Connection,
    formats: List[str],
    tolerance_minutes: float,
    direction: str,
    output_dir: Path,
    row_limit: Optional[int] = None,
    global_conn: Optional[sqlite3.Connection] = None, # New parameter
) -> Dict:
    server_dir = output_dir / server_id
    server_dir.mkdir(parents=True, exist_ok=True)

    summary: Dict = {"serverId": server_id, "tables": {}, "tokens": {}}

    raw_tables: Dict[str, pd.DataFrame] = {}
    for table in TABLES_TO_EXPORT:
        # Read liquidity_data from global_conn if available, otherwise from server_conn
        if table == "liquidity_data" and global_conn:
            df = read_table(global_conn, table, limit=row_limit)
        else:
            df = read_table(server_conn, table, limit=row_limit)
        raw_tables[table] = df
        summary["tables"][table] = {"rows": int(len(df)) if not df.empty else 0}

    trades = enrich_trades(raw_tables["completed_trades"], server_id)
    diff = enrich_diff(raw_tables["diff_history"], server_id)
    balances = enrich_balances(raw_tables["balances_history"])
    server_tokens = raw_tables["server_tokens"].copy()
    gas = enrich_gas(raw_tables["gas_balances"])
    contracts = enrich_contracts(raw_tables["contract_transactions"])
    liquidity = enrich_liquidity(raw_tables.get("liquidity_data", pd.DataFrame()))

    merged = pd.DataFrame()
    if not trades.empty and not diff.empty:
        trades_sorted = trades.sort_values("trade_ts")
        diff_sorted = diff.sort_values("diff_ts")
        merged = pd.merge_asof(
            trades_sorted,
            diff_sorted,
            left_on="trade_ts",
            right_on="diff_ts",
            by="token",
            tolerance=pd.Timedelta(minutes=tolerance_minutes),
            direction=direction,
        )
        merged["hasDiffMatch"] = merged["curId"].notna().astype(int)

    quality_rows = build_quality_rows(merged, server_id)
    if quality_rows:
        quality_df = pd.DataFrame(quality_rows)
        write_dataframe(quality_df, server_dir / "data_quality", formats=["csv"], manifest_entry={})
        summary["quality"] = {
            "rows": int(len(quality_df))
        }

    write_dataframe(trades, server_dir / "completed_trades", formats, summary["tables"]["completed_trades"])
    write_dataframe(diff, server_dir / "diff_history", formats, summary["tables"]["diff_history"])
    write_dataframe(balances, server_dir / "balances_history", formats, summary["tables"]["balances_history"])
    write_dataframe(server_tokens, server_dir / "server_tokens", formats, summary["tables"]["server_tokens"])
    write_dataframe(gas, server_dir / "gas_balances", formats, summary["tables"]["gas_balances"])
    write_dataframe(contracts, server_dir / "contract_transactions", formats, summary["tables"]["contract_transactions"])
    write_dataframe(liquidity, server_dir / "liquidity_data", formats, summary["tables"]["liquidity_data"])

    if not merged.empty:
        write_dataframe(merged, server_dir / "trades_with_diff", formats, summary.setdefault("merged", {}))

    if not trades.empty:
        for token, token_trades in trades.groupby(trades["token"].fillna("unknown")):
            token_key = token or "unknown"
            token_dir = server_dir / token_key
            token_dir.mkdir(parents=True, exist_ok=True)

            token_summary = summary["tokens"].setdefault(token_key, {})
            token_summary["tradeRows"] = int(len(token_trades))

            write_dataframe(token_trades, token_dir / "trades", formats, token_summary.setdefault("trades", {}))
            token_diff = diff[diff["token"] == token]
            if not token_diff.empty:
                write_dataframe(token_diff, token_dir / "diff_history", formats, token_summary.setdefault("diff", {}))
            if not merged.empty:
                token_merged = merged[merged["token"] == token]
                if not token_merged.empty:
                    write_dataframe(token_merged, token_dir / "merged", formats, token_summary.setdefault("merged", {}))

    return summary


def main() -> None:
    args = parse_args()

    formats = ensure_formats(args.formats)
    config_path = Path(args.servers_config)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.refresh:
        trigger_refresh(args.refresh_url)

    config = read_servers(config_path)
    selected_servers = None
    if args.servers:
        selected_servers = {sid.strip() for sid in args.servers.split(',') if sid.strip()}

    generated_at = datetime.now(timezone.utc).isoformat()

    manifest = {
        "generatedAt": generated_at,
        "toleranceMinutes": args.tolerance_minutes,
        "direction": args.direction,
        "formats": formats,
        "serversConfig": str(config_path),
        "servers": [],
    }
    if args.row_limit:
        manifest["rowLimit"] = int(args.row_limit)
    if selected_servers:
        manifest["filters"] = {"servers": sorted(selected_servers)}

    # Open global DB connection once
    default_db_path = Path("data.sqlite")
    if not default_db_path.exists():
        logging.warning("Default database %s not found. Skipping global data export.", default_db_path)
        global_conn = None
    else:
        global_conn = sqlite3.connect(default_db_path)

    for server in config.get("servers", []):
        server_id = server.get("id")
        if not server_id:
            continue
        if selected_servers and server_id not in selected_servers:
            continue
        db_path = resolve_db_path(server_id)
        server_entry = {
            "serverId": server_id,
            "dbPath": str(db_path),
            "exists": db_path.exists(),
        }
        if not db_path.exists():
            logging.warning("Skipping server %s; database %s missing", server_id, db_path)
            server_entry["error"] = "missing database"
            manifest["servers"].append(server_entry)
            continue

        with sqlite3.connect(db_path) as server_conn:
            summary = create_exports_for_server(
                server_id=server_id,
                server_conn=server_conn,
                formats=formats,
                tolerance_minutes=args.tolerance_minutes,
                direction=args.direction,
                output_dir=output_dir,
                row_limit=args.row_limit,
                global_conn=global_conn, # Pass global connection
            )
            server_entry.update(summary)

        manifest["servers"].append(server_entry)
    
    if global_conn:
        global_conn.close() # Close global connection

    manifest_path = output_dir / "manifest.json"
    with manifest_path.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, default=str, indent=2)
    logging.info("Export manifest written to %s", manifest_path)


if __name__ == "__main__":
    main()
