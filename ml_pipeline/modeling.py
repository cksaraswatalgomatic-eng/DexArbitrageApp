from __future__ import annotations

import json
import logging
from dataclasses import asdict
from importlib import import_module
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor, RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    f1_score,
    mean_absolute_error,
    mean_absolute_percentage_error,
    mean_squared_error,
    precision_recall_fscore_support,
    roc_auc_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .config import TrainingConfig

LOGGER = logging.getLogger(__name__)


def _optional_import(module_name: str, class_name: str):
    try:
        module = import_module(module_name)
        return getattr(module, class_name)
    except (ImportError, AttributeError):
        return None


def _build_estimator(config: TrainingConfig):
    model_type = config.model_type.lower()
    if config.task == "classification":
        if model_type == "random_forest":
            return RandomForestClassifier(
                n_estimators=config.model_params.get("n_estimators", 300),
                max_depth=config.model_params.get("max_depth"),
                class_weight=config.model_params.get("class_weight", "balanced"),
                n_jobs=config.n_jobs,
                random_state=config.random_state,
            )
        if model_type == "logistic_regression":
            return LogisticRegression(
                max_iter=config.model_params.get("max_iter", 1000),
                class_weight=config.model_params.get("class_weight", "balanced"),
                solver=config.model_params.get("solver", "lbfgs"),
            )
        if model_type == "xgboost":
            cls = _optional_import("xgboost", "XGBClassifier")
            if cls is None:
                LOGGER.warning("xgboost not installed; falling back to GradientBoostingClassifier")
            else:
                params = {"n_estimators": 300, "learning_rate": 0.05, "max_depth": 6, "subsample": 0.8, "colsample_bytree": 0.8}
                params.update(config.model_params)
                return cls(**params)
        if model_type == "lightgbm":
            cls = _optional_import("lightgbm", "LGBMClassifier")
            if cls is None:
                LOGGER.warning("lightgbm not installed; falling back to GradientBoostingClassifier")
            else:
                params = {"n_estimators": 500, "learning_rate": 0.05, "num_leaves": 64}
                params.update(config.model_params)
                return cls(**params)
        return GradientBoostingClassifier(**config.model_params)

    # Regression models
    if model_type == "random_forest":
        return RandomForestRegressor(
            n_estimators=config.model_params.get("n_estimators", 400),
            max_depth=config.model_params.get("max_depth"),
            n_jobs=config.n_jobs,
            random_state=config.random_state,
        )
    if model_type == "xgboost":
        cls = _optional_import("xgboost", "XGBRegressor")
        if cls is None:
            LOGGER.warning("xgboost not installed; falling back to GradientBoostingRegressor")
        else:
            params = {"n_estimators": 400, "learning_rate": 0.05, "max_depth": 6, "subsample": 0.8, "colsample_bytree": 0.8}
            params.update(config.model_params)
            return cls(**params)
    if model_type == "lightgbm":
        cls = _optional_import("lightgbm", "LGBMRegressor")
        if cls is None:
            LOGGER.warning("lightgbm not installed; falling back to GradientBoostingRegressor")
        else:
            params = {"n_estimators": 600, "learning_rate": 0.05, "num_leaves": 128}
            params.update(config.model_params)
            return cls(**params)
    return GradientBoostingRegressor(**config.model_params)


def build_pipeline(features: pd.DataFrame, categorical_columns: Sequence[str], config: TrainingConfig) -> Tuple[Pipeline, List[str], List[str]]:
    categorical_columns = [c for c in categorical_columns if c in features.columns]
    numeric_columns = [col for col in features.columns if col not in categorical_columns]

    numeric_transformer = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )
    categorical_transformer = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("encoder", OneHotEncoder(handle_unknown="ignore")),
        ]
    )

    preprocessor = ColumnTransformer(
        transformers=[
            ("num", numeric_transformer, numeric_columns),
            ("cat", categorical_transformer, categorical_columns),
        ],
        remainder="drop",
        sparse_threshold=0.3,
    )

    estimator = _build_estimator(config)
    pipeline = Pipeline(steps=[("preprocess", preprocessor), ("model", estimator)])
    return pipeline, numeric_columns, list(categorical_columns)


def _generate_time_splits(timestamps: pd.Series, config: TrainingConfig) -> List[Tuple[np.ndarray, np.ndarray]]:
    ts = pd.Series(timestamps).reset_index(drop=True)
    if ts.empty or ts.dropna().empty:
        return []
    unique_times = np.sort(ts.dropna().unique())
    if len(unique_times) <= config.cv_splits + 1:
        LOGGER.warning("Not enough unique timestamps for %d splits", config.cv_splits)
        return []

    boundaries = np.linspace(0, len(unique_times) - 1, config.cv_splits + 2, dtype=int)
    gap_delta = pd.Timedelta(minutes=config.cv_gap_minutes)
    splits: List[Tuple[np.ndarray, np.ndarray]] = []

    for idx in range(config.cv_splits):
        val_start = unique_times[boundaries[idx + 1]]
        val_end = unique_times[boundaries[idx + 2]]
        train_cutoff = val_start - gap_delta
        train_mask = ts < train_cutoff
        val_mask = (ts >= val_start) & (ts <= val_end)
        train_idx = np.where(train_mask)[0]
        val_idx = np.where(val_mask)[0]
        if train_idx.size == 0 or val_idx.size == 0:
            continue
        splits.append((train_idx, val_idx))
    return splits


def _classification_metrics(y_true, y_pred, y_prob) -> Dict[str, float]:
    metrics: Dict[str, float] = {}
    if y_prob is not None:
        try:
            metrics["roc_auc"] = roc_auc_score(y_true, y_prob)
        except ValueError:
            metrics["roc_auc"] = float("nan")
        try:
            metrics["avg_precision"] = average_precision_score(y_true, y_prob)
        except ValueError:
            metrics["avg_precision"] = float("nan")
    precision, recall, f1, _ = precision_recall_fscore_support(y_true, y_pred, average="binary")
    metrics.update({"precision": precision, "recall": recall, "f1": f1})
    return metrics


def _regression_metrics(y_true, y_pred) -> Dict[str, float]:
    mse = mean_squared_error(y_true, y_pred)
    metrics = {
        "mae": mean_absolute_error(y_true, y_pred),
        "mape": mean_absolute_percentage_error(y_true, y_pred),
        "rmse": float(np.sqrt(mse)),
    }
    return metrics


def cross_validate(
    pipeline: Pipeline,
    features: pd.DataFrame,
    target: pd.Series,
    timestamps: pd.Series,
    config: TrainingConfig,
) -> List[Dict[str, float]]:
    splits = _generate_time_splits(timestamps, config)
    fold_metrics: List[Dict[str, float]] = []
    if not splits:
        LOGGER.warning("Skipping cross-validation; insufficient splits")
        return fold_metrics

    for fold_idx, (train_idx, val_idx) in enumerate(splits, start=1):
        model = clone(pipeline)
        X_train, y_train = features.iloc[train_idx], target.iloc[train_idx]
        X_val, y_val = features.iloc[val_idx], target.iloc[val_idx]
        model.fit(X_train, y_train)
        y_pred = model.predict(X_val)
        if config.task == "classification":
            y_prob = model.predict_proba(X_val)[:, 1] if hasattr(model.named_steps["model"], "predict_proba") else None
            metrics = _classification_metrics(y_val, y_pred, y_prob)
        else:
            metrics = _regression_metrics(y_val, y_pred)
        metrics["fold"] = fold_idx
        fold_metrics.append(metrics)
    return fold_metrics


def holdout_evaluation(
    pipeline: Pipeline,
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_holdout: pd.DataFrame,
    y_holdout: pd.Series,
    config: TrainingConfig,
) -> Dict[str, float]:
    model = clone(pipeline)
    model.fit(X_train, y_train)
    y_pred = model.predict(X_holdout)
    if config.task == "classification":
        y_prob = model.predict_proba(X_holdout)[:, 1] if hasattr(model.named_steps["model"], "predict_proba") else None
        metrics = _classification_metrics(y_holdout, y_pred, y_prob)
    else:
        metrics = _regression_metrics(y_holdout, y_pred)
    return metrics


def compute_feature_importance(pipeline: Pipeline, X: pd.DataFrame, y: pd.Series, n_repeats: int = 5) -> Dict[str, float]:
    try:
        importance = permutation_importance(
            pipeline,
            X,
            y,
            n_repeats=n_repeats,
            n_jobs=1,
            random_state=42,
        )
    except Exception as exc:  # pylint: disable=broad-except
        LOGGER.warning("Permutation importance failed: %s", exc)
        return {}
    scores = dict(zip(X.columns, importance.importances_mean))
    return scores


def save_artifacts(output_dir: Path, pipeline: Pipeline, config: TrainingConfig, metadata: Dict) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    model_path = output_dir / "model.joblib"
    joblib.dump(pipeline, model_path)

    metadata_to_write = metadata.copy()
    metadata_to_write["config"] = asdict(config)

    with (output_dir / "metadata.json").open("w", encoding="utf-8") as f:
        json.dump(metadata_to_write, f, indent=2, default=str)
    return model_path

