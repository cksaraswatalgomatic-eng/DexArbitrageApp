from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class TrainingConfig:
    data_root: Path = Path("data_exports")
    servers: Optional[List[str]] = None
    tokens: Optional[List[str]] = None
    task: str = "classification"  # or "regression"
    target_column: str = "label_class"
    regression_target: str = "label_regression"
    classification_threshold: float = 0.0
    tolerance_minutes: float = 2.0
    row_limit: Optional[int] = None
    refresh_data: bool = False
    refresh_args: Optional[List[str]] = None
    model_type: str = "gradient_boosting"
    model_params: Dict[str, Any] = field(default_factory=dict)
    cv_splits: int = 5
    cv_gap_minutes: float = 5.0
    validation_holdout_days: int = 14
    feature_windows_minutes: List[int] = field(default_factory=lambda: [5, 15, 30, 60])
    feature_windows_hours: List[int] = field(default_factory=lambda: [4, 12, 24])
    imbalance_eps: float = 1e-6
    output_root: Path = Path("models")
    experiment_name: str = "ml-analysis"
    n_jobs: int = -1
    random_state: int = 42
    max_training_rows: Optional[int] = None
    scoring_metric: Optional[str] = None
    use_optuna: bool = False
    optuna_trials: int = 0
    optuna_timeout: Optional[int] = None
    time_column: str = "trade_ts"
    server_column: str = "serverId"
    token_column: str = "token"

    @property
    def target(self) -> str:
        return self.target_column if self.task == "classification" else self.regression_target

    def resolve_output_dir(self) -> Path:
        base = self.output_root
        if not base.is_absolute():
            base = Path.cwd() / base
        base.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        run_dir = base / f"{self.experiment_name}-{stamp}"
        run_dir.mkdir(parents=True, exist_ok=True)
        return run_dir

