#!/usr/bin/env python3
import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any, Dict

# Add project root to path for imports
sys.path.append(str(Path(__file__).parent.parent))

import pandas as pd
import joblib
import numpy as np

from ml_pipeline import data_loading, feature_engineering
from ml_pipeline.config import TrainingConfig

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')
LOGGER = logging.getLogger('market_analysis')

def load_latest_model(models_dir: Path) -> Any:
    # Try models/latest/model.joblib
    latest = models_dir / 'latest' / 'model.joblib'
    if latest.exists():
        LOGGER.info(f"Loading model from {latest}")
        return joblib.load(latest)
    
    # Fallback to finding newest in models/
    subdirs = [d for d in models_dir.iterdir() if d.is_dir() and d.name.startswith('ml-analysis')]
    if not subdirs:
        raise FileNotFoundError("No trained models found in models/")
    
    newest = max(subdirs, key=lambda d: d.stat().st_mtime)
    model_path = newest / 'model.joblib'
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found in {newest}")
    
    LOGGER.info(f"Loading model from {model_path}")
    return joblib.load(model_path)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-root', default='data_exports')
    parser.add_argument('--models-root', default='models')
    parser.add_argument('--servers', default=None) # 'bnb,arbitrum'
    parser.add_argument('--limit', type=int, default=2000)
    args = parser.parse_args()

    config = TrainingConfig()
    config.data_root = Path(args.data_root)
    config.row_limit = args.limit
    if args.servers:
        config.servers = args.servers.split(',')
    
    # Load data
    trades_df, context = data_loading.load_datasets(config)
    if trades_df.empty:
        print(json.dumps({"error": "No data available"}))
        return

    # Mock target for feature engineering to work (it drops NA targets)
    if config.target_column not in trades_df.columns:
        trades_df[config.target_column] = 0
    else:
        trades_df[config.target_column] = trades_df[config.target_column].fillna(0)
        
    # config.target is a property derived from config.task and target_column.
    # We don't need to set it manually if config.task is correct.
    # Default task is "classification" -> target = target_column ("label_class")

    # Build features
    # We need to be careful: feature_engineering might drop rows if windows aren't full.
    # But we want the LATEST state.
    features, _, meta = feature_engineering.build_feature_matrix(trades_df, context, config)
    
    if features.empty:
         print(json.dumps({"error": "No features could be generated"}))
         return

    # Add metadata columns back for identification
    # features index corresponds to trades_df index
    if 'token' in trades_df.columns:
        features['token'] = trades_df.loc[features.index, 'token']
    elif config.token_column in trades_df.columns:
        features['token'] = trades_df.loc[features.index, config.token_column]
        
    features['timestamp'] = meta['timestamps']
    
    # Group by token and take the last row (latest time)
    # We assume the dataframe is sorted by time implicitly or explicitly
    features = features.sort_values('timestamp')
    latest_features = features.groupby('token').last().reset_index()
    
    # Prepare for prediction
    # Load model
    try:
        model = load_latest_model(Path(args.models_root))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        return

    # Align columns
    # The model expects specific columns.
    # We should check model metadata if possible, but for now assume pipeline handles it.
    # If the pipeline includes OneHotEncoder, we might have issues if categories don't match.
    # But we are using the same pipeline logic.
    
    # Drop non-feature columns for prediction
    # meta['feature_columns'] contains the list used during training (hopefully)
    # But we don't have the training metadata loaded here.
    # We rely on the model pipeline's 'preprocessor' to handle selection if it exists.
    # If the model is just a regressor/classifier, we must pass exact columns.
    
    # Prepare X
    X = latest_features.copy()
    
    # Check if model has 'feature_names_in_'
    model_step = model.named_steps.get('model') if hasattr(model, 'named_steps') else model
    
    prediction_cols = None
    if hasattr(model_step, 'feature_names_in_'):
        prediction_cols = model_step.feature_names_in_
    elif hasattr(model, 'feature_names_in_'):
        prediction_cols = model.feature_names_in_

    if prediction_cols is not None:
        # Add missing columns with default 0 to support legacy models trained with leakage features
        missing_cols = set(prediction_cols) - set(X.columns)
        if missing_cols:
            LOGGER.warning(f"Model expects columns {missing_cols} which are missing. Filling with 0 (Model might need retraining).")
            for col in missing_cols:
                X[col] = 0
        
        # Reorder columns to match model expectation
        X = X[prediction_cols]
    
    try:
        # Remove metadata columns from X before predicting, unless pipeline expects them (e.g. for encoding)
        # The pipeline usually expects the columns returned by build_feature_matrix
        # 'token' and 'timestamp' were added by us above. 'timestamp' definitely not needed.
        # 'token' might be needed if categorical.
        
        # We need to match the columns output by build_feature_matrix
        valid_cols = [c for c in X.columns if c not in ('timestamp', 'token_x', 'token_y')]
        # If 'token' was in categorical_columns, keep it.
        if 'token' in meta['categorical_columns']:
             # ensure it's kept
             pass
        
        preds = model.predict(X)
        probs = None
        if hasattr(model, 'predict_proba'):
             probs = model.predict_proba(X)[:, 1] # Probability of class 1
    except Exception as e:
        print(json.dumps({"error": f"Prediction failed: {str(e)}"}))
        return

    # Construct result
    results = []
    for i, row in latest_features.iterrows():
        # Try to find feature values in the row, or fallback to 0
        buy_diff = float(row.get('buyDiffBps', 0))
        sell_diff = float(row.get('sellDiffBps', 0))
        
        # Slippage might be propDexSlip or DexSlip depending on feature engineering
        dex_slip = float(row.get('DexSlip', row.get('propDexSlip', 0)))
        cex_slip = float(row.get('CexSlip', row.get('propCexSlip', 0)))

        res = {
            "token": row['token'],
            "timestamp": str(row['timestamp']),
            "probability": float(probs[i]) if probs is not None else None,
            "prediction": float(preds[i]),
            "liquidity": float(row.get('tokenLiquidity', 0)),
            "price": float(row.get('tokenPrice', 0)),
            "spread": float(row.get('spreadMid', 0)),
            "buyDiffBps": buy_diff,
            "sellDiffBps": sell_diff,
            "dexSlip": dex_slip,
            "cexSlip": cex_slip
        }
        results.append(res)
        
    print("__JSON_START__")
    print(json.dumps(results))
    print("__JSON_END__")

if __name__ == '__main__':
    main()
