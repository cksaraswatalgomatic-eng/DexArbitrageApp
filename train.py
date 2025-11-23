from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
import logging
import subprocess
import sys
from pathlib import Path
import shutil
from typing import Any, Dict, List

import numpy as np
import pandas as pd
from sklearn.base import clone

from ml_pipeline import data_loading, feature_engineering, modeling
from ml_pipeline.config import TrainingConfig

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')
LOGGER = logging.getLogger('train')

EXPORT_SCRIPT = Path('scripts/export_diff_dataset.py')


def parse_window_list(value: str) -> List[int]:
    if not value:
        return []
    parts = [int(v.strip()) for v in value.split(',') if v.strip()]
    return [v for v in parts if v > 0]


def parse_model_params(raw: str | None) -> Dict:
    if not raw:
        return {}
    try:
        if raw.strip().startswith('{'):
            return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f'Invalid JSON for model params: {exc}') from exc

    params: Dict[str, object] = {}
    for fragment in raw.split(','):
        if '=' not in fragment:
            continue
        key, value = fragment.split('=', 1)
        key = key.strip()
        value = value.strip()
        if value.lower() in {'true', 'false'}:
            params[key] = value.lower() == 'true'
            continue
        try:
            params[key] = float(value) if '.' in value else int(value)
        except ValueError:
            params[key] = value
    return params


def build_config(args: argparse.Namespace) -> TrainingConfig:
    config = TrainingConfig()
    config.data_root = Path(args.data_root)
    config.servers = args.servers
    config.tokens = args.tokens
    config.task = args.task
    config.target_column = 'label_class' if config.task == 'classification' else 'label_regression'
    config.model_type = args.model_type
    config.model_params = parse_model_params(args.model_params)
    config.row_limit = args.row_limit
    config.tolerance_minutes = args.tolerance_minutes
    config.cv_splits = args.cv_splits
    config.cv_gap_minutes = args.cv_gap_minutes
    config.validation_holdout_days = args.holdout_days
    minutes_windows = parse_window_list(args.feature_windows_minutes)
    hours_windows = parse_window_list(args.feature_windows_hours)
    if minutes_windows:
        config.feature_windows_minutes = minutes_windows
    if hours_windows:
        config.feature_windows_hours = hours_windows
    config.output_root = Path(args.output_root)
    config.experiment_name = args.experiment_name
    config.max_training_rows = args.max_rows
    config.n_jobs = args.n_jobs
    config.random_state = args.random_state
    return config


def update_model_registry(config: TrainingConfig, output_dir: Path, metadata: Dict[str, Any], model_path: Path) -> None:
    registry_dir = config.output_root if config.output_root.is_absolute() else Path.cwd() / config.output_root
    registry_dir.mkdir(parents=True, exist_ok=True)
    registry_path = registry_dir / 'registry.json'
    registry: Dict[str, Any] = {"active": None, "models": []}
    if registry_path.exists():
        try:
            registry = json.loads(registry_path.read_text(encoding='utf-8'))
        except json.JSONDecodeError:
            registry = {"active": None, "models": []}
    entry_id = output_dir.name
    entry = {
        "id": entry_id,
        "path": str(output_dir),
        "model": str(model_path),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "experiment": config.experiment_name,
        "metrics": {
            "cv": metadata.get('cv', {}).get('mean'),
            "holdout": metadata.get('holdout'),
        },
    }
    registry['models'] = [m for m in registry.get('models', []) if m.get('id') != entry_id]
    registry['models'].append(entry)
    registry['active'] = entry_id
    registry_path.write_text(json.dumps(registry, indent=2), encoding='utf-8')
    latest_path = registry_dir / 'latest.txt'
    latest_path.write_text(f"{entry_id}\n", encoding='utf-8')

def refresh_data(config: TrainingConfig, args: argparse.Namespace) -> None:
    if not args.refresh_data:
        return
    if not EXPORT_SCRIPT.exists():
        LOGGER.error('Export script not found at %s', EXPORT_SCRIPT)
        return
    command = [
        sys.executable,
        str(EXPORT_SCRIPT),
        '--output-dir', str(config.data_root),
        '--tolerance-minutes', str(config.tolerance_minutes),
        '--formats', args.export_formats,
    ]
    if config.servers:
        command.extend(['--servers', ','.join(config.servers)])
    if config.row_limit:
        command.extend(['--row-limit', str(config.row_limit)])
    if args.refresh_args:
        command.extend(args.refresh_args)
    LOGGER.info('Refreshing data via %s', ' '.join(command))
    subprocess.run(command, check=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Train ML model for diff analysis')
    parser.add_argument('--data-root', default='data_exports', help='Directory containing exported datasets')
    parser.add_argument('--servers', nargs='*', help='Server IDs to include')
    parser.add_argument('--tokens', nargs='*', help='Token symbols to include')
    parser.add_argument('--task', choices=['classification', 'regression'], default='classification')
    parser.add_argument('--model-type', default='gradient_boosting', help='Model family (random_forest, xgboost, lightgbm, logistic_regression, gradient_boosting)')
    parser.add_argument('--model-params', help='Model parameter overrides as JSON or key=value list')
    parser.add_argument('--row-limit', type=int, help='Maximum rows to read per table during export load')
    parser.add_argument('--tolerance-minutes', type=float, default=2.0)
    parser.add_argument('--cv-splits', type=int, default=5)
    parser.add_argument('--cv-gap-minutes', type=float, default=5.0)
    parser.add_argument('--holdout-days', type=int, default=14)
    parser.add_argument('--feature-windows-minutes', default='5,15,30,60')
    parser.add_argument('--feature-windows-hours', default='4,12,24')
    parser.add_argument('--max-rows', type=int, help='Limit total training rows (after filtering)')
    parser.add_argument('--output-root', default='models')
    parser.add_argument('--experiment-name', default='ml-analysis')
    parser.add_argument('--refresh-data', action='store_true', help='Run data export before training')
    parser.add_argument('--refresh-args', nargs='*', help='Additional args forwarded to export script')
    parser.add_argument('--export-formats', default='parquet', help='Formats to request during export (csv,parquet)')
    parser.add_argument('--n-jobs', type=int, default=-1)
    parser.add_argument('--random-state', type=int, default=42)
    return parser.parse_args()


def main():
    args = parse_args()
    config = build_config(args)

    if config.task == 'classification':
        config.model_params = dict(config.model_params)
        config.model_params.setdefault('class_weight', 'balanced')
        
        # Add regularization defaults to prevent overfitting
        config.model_params.setdefault('max_depth', 10)
        config.model_params.setdefault('min_samples_leaf', 40)
        config.model_params.setdefault('n_estimators', 200)
        
        if config.model_type.lower() == 'gradient_boosting':
            LOGGER.info('Switching default classifier to random_forest with balanced class weights.')
            config.model_type = 'random_forest'



    refresh_data(config, args)

    trades_df, context = data_loading.load_datasets(config)
    if trades_df.empty:
        LOGGER.error('No trades available after loading datasets. Aborting.')
        sys.exit(1)

    feature_matrix, target, meta = feature_engineering.build_feature_matrix(trades_df, context, config)
    timestamps = pd.Series(meta.get('timestamps'))

    if config.max_training_rows and len(feature_matrix) > config.max_training_rows:
        LOGGER.info('Applying max row cap: %d', config.max_training_rows)
        feature_matrix = feature_matrix.tail(config.max_training_rows)
        target = target.tail(config.max_training_rows)
        timestamps = timestamps.tail(config.max_training_rows)

    dataset = pd.concat([
        feature_matrix,
        target.rename('target'),
        timestamps.rename('timestamp'),
    ], axis=1).dropna(subset=['timestamp'])

    feature_matrix = dataset[feature_matrix.columns]
    target = dataset['target']
    timestamps = dataset['timestamp']

    holdout_mask = pd.Series(False, index=feature_matrix.index)
    if config.validation_holdout_days > 0 and not timestamps.empty:
        cutoff = timestamps.max() - pd.Timedelta(days=config.validation_holdout_days)
        holdout_mask = timestamps >= cutoff
        LOGGER.info('Holdout cutoff %s covers %d rows', cutoff, holdout_mask.sum())

    if holdout_mask.sum() == len(holdout_mask):
        LOGGER.warning('Holdout window captured entire dataset; disabling holdout split')
        holdout_mask[:] = False
    elif holdout_mask.sum() == 0:
        LOGGER.info('No rows in holdout window; training on full dataset.')

    train_mask = ~holdout_mask
    X_train = feature_matrix.loc[train_mask].reset_index(drop=True)
    y_train = target.loc[train_mask].reset_index(drop=True)
    ts_train = timestamps.loc[train_mask].reset_index(drop=True)

    X_holdout = feature_matrix.loc[holdout_mask].reset_index(drop=True)
    y_holdout = target.loc[holdout_mask].reset_index(drop=True)
    ts_holdout = timestamps.loc[holdout_mask].reset_index(drop=True)

    if X_train.empty:
        LOGGER.warning('Training split empty after holdout; using full dataset for training and disabling holdout.')
        X_train = feature_matrix.reset_index(drop=True)
        y_train = target.reset_index(drop=True)
        ts_train = timestamps.reset_index(drop=True)
        X_holdout = pd.DataFrame(columns=feature_matrix.columns)
        y_holdout = pd.Series(dtype=target.dtype)
        ts_holdout = pd.Series(dtype=timestamps.dtype)

    pipeline, numeric_cols, categorical_cols = modeling.build_pipeline(X_train, meta.get('categorical_columns', []), config)

    cv_metrics = modeling.cross_validate(pipeline, X_train, y_train, ts_train, config)
    cv_summary: Dict[str, object] = {}
    if cv_metrics:
        cv_df = pd.DataFrame(cv_metrics)
        cv_summary = {
            'folds': cv_metrics,
            'mean': cv_df.mean(numeric_only=True).to_dict(),
            'std': cv_df.std(numeric_only=True).to_dict(),
        }
        LOGGER.info('CV mean metrics: %s', cv_summary['mean'])

    final_model = clone(pipeline)
    final_model.fit(X_train, y_train)

    holdout_metrics = None
    holdout_predictions = None
    if not X_holdout.empty:
        preds = final_model.predict(X_holdout)
        probs = None
        if config.task == 'classification' and hasattr(final_model.named_steps['model'], 'predict_proba'):
            probs = final_model.predict_proba(X_holdout)[:, 1]
            holdout_metrics = modeling._classification_metrics(y_holdout, preds, probs)
        else:
            holdout_metrics = modeling._regression_metrics(y_holdout, preds)
        LOGGER.info('Holdout metrics: %s', holdout_metrics)

        holdout_predictions = pd.DataFrame({
            'timestamp': ts_holdout.astype(str),
            'y_true': y_holdout,
            'y_pred': preds,
        })
        if probs is not None:
            holdout_predictions['y_prob'] = probs

    rng = np.random.default_rng(config.random_state)
    if len(X_train) > 0:
        sample_size = min(1000, len(X_train))
        sample_idx = rng.choice(len(X_train), size=sample_size, replace=False)
        importance = modeling.compute_feature_importance(final_model, X_train.iloc[sample_idx], y_train.iloc[sample_idx])
    else:
        importance = {}

    output_dir = config.resolve_output_dir()
    metadata = {
        'dataset': {
            'rows': int(len(feature_matrix)),
            'train_rows': int(len(X_train)),
            'holdout_rows': int(len(X_holdout)),
            'servers': config.servers,
            'tokens': config.tokens,
            'time_start': str(timestamps.min()) if not timestamps.empty else None,
            'time_end': str(timestamps.max()) if not timestamps.empty else None,
        },
        'cv': cv_summary,
        'holdout': holdout_metrics,
        'features': {
            'numeric': numeric_cols,
            'categorical': categorical_cols,
            'all': list(feature_matrix.columns),
        },
        'feature_importance': dict(sorted(importance.items(), key=lambda kv: abs(kv[1]), reverse=True)),
    }

    model_path = modeling.save_artifacts(output_dir, final_model, config, metadata)
    LOGGER.info('Saved model to %s', model_path)

    update_model_registry(config, output_dir, metadata, model_path)

    latest_dir = config.output_root if config.output_root.is_absolute() else Path.cwd() / config.output_root
    latest_dir = latest_dir / 'latest'
    latest_dir.mkdir(parents=True, exist_ok=True)

    try:
        shutil.copy2(model_path, latest_dir / 'model.joblib')
        metadata_path = output_dir / 'metadata.json'
        if metadata_path.exists():
            shutil.copy2(metadata_path, latest_dir / 'metadata.json')
        LOGGER.info('Updated latest model snapshot at %s', latest_dir)
    except Exception as exc:
        LOGGER.warning('Failed to update latest model snapshot: %s', exc)

    if holdout_predictions is not None:
        holdout_file = output_dir / 'holdout_predictions.csv'
        holdout_predictions.to_csv(holdout_file, index=False)
        LOGGER.info('Holdout predictions written to %s', holdout_file)


if __name__ == '__main__':
    main()
