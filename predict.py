
import joblib
import pandas as pd
import sys
import json

# Load the trained model
model = joblib.load('trade_model.joblib')

def predict(features):
    """
    Receives a list of features and returns a prediction.
    """
    # The model expects a DataFrame with feature names
    df = pd.DataFrame([features], columns=['buyDiffBps', 'sellDiffBps', 'Diff', 'DexSlip', 'CexSlip'])
    
    # Predict the probability of success (class 1)
    probability = model.predict_proba(df)[:, 1]
    
    return {'success_probability': probability[0]}

if __name__ == "__main__":
    # Features are passed as command-line arguments
    # e.g., python predict.py buyDiffBps sellDiffBps Diff DexSlip CexSlip
    if len(sys.argv) != 6:
        print(json.dumps({"error": "Invalid number of features. Expected 5."}))
        sys.exit(1)

    try:
        features = [float(arg) for arg in sys.argv[1:]]
        result = predict(features)
        print(json.dumps(result))
    except (ValueError, TypeError) as e:
        print(json.dumps({"error": f"Invalid feature format: {e}"}))
        sys.exit(1)
