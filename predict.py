
import joblib
import pandas as pd
import sys
import json

# Load the trained model - check multiple possible locations
import os

model_path = None
possible_paths = [
    'models/latest/model.joblib',  # Standard location after training
    'model.joblib',  # Fallback for local testing
    'trade_model.joblib',  # Original path (deprecated)
]

# Also check relative to script location
script_dir = os.path.dirname(os.path.abspath(__file__))
for base_path in ['', script_dir]:
    for rel_path in ['models/latest/model.joblib', 'model.joblib', 'trade_model.joblib']:
        full_path = os.path.join(base_path, rel_path) if base_path else rel_path
        if os.path.exists(full_path):
            model_path = full_path
            break
    if model_path:
        break

if model_path is None:
    raise FileNotFoundError("No model file found. Expected one of: models/latest/model.joblib, model.joblib, trade_model.joblib")

print(f"Loading model from: {model_path}", file=sys.stderr)
model = joblib.load(model_path)

def predict(features):
    """
    Receives a list of features and returns a prediction.
    """
    # The model expects a DataFrame with feature names
    df = pd.DataFrame([features], columns=['buyDiffBps', 'sellDiffBps', 'Diff', 'DexSlip', 'CexSlip'])
    
    # Validate input features to ensure they're within reasonable ranges
    for i, col in enumerate(df.columns):
        if not pd.api.types.is_numeric_dtype(df.iloc[:, i]) or pd.isna(df.iloc[0, i]):
            print(f"Warning: Invalid feature value for {col}: {df.iloc[0, i]}", file=sys.stderr)
    
    # Check if all features are the same (which might indicate a problem with data)
    if all(x == features[0] for x in features):
        print(f"Warning: All features are identical: {features}", file=sys.stderr)
    
    # Predict the probability of success (class 1)
    try:
        # Get prediction probabilities for both classes
        all_probabilities = model.predict_proba(df)
        prob_class_0 = all_probabilities[0][0]  # Probability of class 0 (failure)
        prob_class_1 = all_probabilities[0][1]  # Probability of class 1 (success)
        
        # Debug output (comment out in production)
        # print(f"Debug: Input features: {features}", file=sys.stderr)
        # print(f"Debug: Probabilities: class_0={prob_class_0}, class_1={prob_class_1}", file=sys.stderr)
        
        # Ensure probability is in [0, 1] range
        prob_value = float(prob_class_1)
        if prob_value < 0:
            prob_value = 0.0
        elif prob_value > 1:
            prob_value = 1.0
        
        return {'success_probability': prob_value, 'probabilities': [float(prob_class_0), float(prob_class_1)]}
    except Exception as e:
        print(f"Error during prediction: {str(e)}", file=sys.stderr)
        # Return a neutral probability if prediction fails
        return {'success_probability': 0.5, 'error': str(e)}

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
