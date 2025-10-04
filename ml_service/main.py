from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="ML Analysis Service", version="1.0.0")

MODEL_CACHE: Dict[str, Dict[str, Any]] = {}
MODEL_LOCK = threading.Lock()
DEFAULT_MODEL_PATH = os.getenv("MODEL_ARTIFACT", "models/latest/model.joblib")


class PredictRequest(BaseModel):
    payloads: List[Dict[str, Any]] = Field(..., description="List of feature dictionaries")
    model_path: Optional[str] = Field(None, description="Override model artifact path")
    include_probabilities: bool = Field(True, description="Return probability scores when supported")


class ExplainRequest(BaseModel):
    model_path: Optional[str] = None
    top_k: int = 15


def _resolve_model_path(model_path: Optional[str]) -> Path:
    candidate = Path(model_path or DEFAULT_MODEL_PATH)
    if not candidate.is_absolute():
        candidate = Path.cwd() / candidate
    if not candidate.exists():
        raise FileNotFoundError(f"Model artifact not found: {candidate}")
    return candidate


def _load_model(model_path: Path) -> Dict[str, Any]:
    resolved = model_path.resolve()
    key = str(resolved)
    current_mtime = resolved.stat().st_mtime
    with MODEL_LOCK:
        cached = MODEL_CACHE.get(key)
        if cached and cached.get("mtime") == current_mtime:
            return cached
        pipeline = joblib.load(resolved)
        metadata_path = resolved.with_name("metadata.json")
        if metadata_path.exists():
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        else:
            metadata = {}
        entry = {"pipeline": pipeline, "metadata": metadata, "mtime": current_mtime}
        MODEL_CACHE[key] = entry
        return entry


def _prepare_frame(payloads: List[Dict[str, Any]], feature_order: List[str]) -> pd.DataFrame:
    frame = pd.DataFrame(payloads)
    for column in feature_order:
        if column not in frame.columns:
            frame[column] = None
    return frame[feature_order]


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/predict")
def predict(request: PredictRequest) -> Dict[str, Any]:
    model_data = _load_model(_resolve_model_path(request.model_path))
    pipeline = model_data["pipeline"]
    metadata = model_data.get("metadata", {})
    feature_order = metadata.get("features", {}).get("all")
    if not feature_order:
        raise HTTPException(status_code=500, detail="Model metadata missing feature definitions")

    frame = _prepare_frame(request.payloads, feature_order)
    try:
        predictions = pipeline.predict(frame)
    except Exception as exc:  # pylint: disable=broad-except
        raise HTTPException(status_code=400, detail=f"Prediction failed: {exc}") from exc

    response: Dict[str, Any] = {"predictions": predictions.tolist()}

    if request.include_probabilities and hasattr(pipeline.named_steps.get("model"), "predict_proba"):
        try:
            probs = pipeline.predict_proba(frame)
            response["probabilities"] = probs.tolist()
        except Exception as exc:  # pylint: disable=broad-except
            response["probabilities_error"] = str(exc)

    response["feature_order"] = feature_order
    response["config"] = metadata.get("config")
    return response


@app.post("/explain")
def explain(request: ExplainRequest) -> Dict[str, Any]:
    model_data = _load_model(_resolve_model_path(request.model_path))
    metadata = model_data.get("metadata", {})
    importance = metadata.get("feature_importance")
    if not importance:
        raise HTTPException(status_code=404, detail="Feature importance unavailable")
    sorted_items = sorted(importance.items(), key=lambda item: abs(item[1]), reverse=True)
    top_k = max(1, request.top_k)
    return {"feature_importance": sorted_items[:top_k]}


@app.get("/metadata")
def metadata_endpoint(model_path: Optional[str] = None) -> Dict[str, Any]:
    model_data = _load_model(_resolve_model_path(model_path))
    return model_data.get("metadata", {})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("ml_service.main:app", host=os.getenv("ML_SERVICE_HOST", "0.0.0.0"), port=int(os.getenv("ML_SERVICE_PORT", "8100")))
