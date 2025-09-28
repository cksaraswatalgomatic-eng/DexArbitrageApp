
import sqlite3
import pandas as pd
import joblib
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score
import json
import os

# Function to get the active server's database path
def get_active_db_path():
    servers_file = 'servers.json'
    if not os.path.exists(servers_file):
        return 'data.sqlite'  # Default fallback
    with open(servers_file, 'r') as f:
        servers_config = json.load(f)
    active_id = servers_config.get('activeId', 'bnb')
    return f'data-{active_id}.sqlite'

# Load data from the database
DB_PATH = get_active_db_path()
print(f"Using database: {DB_PATH}")
conn = sqlite3.connect(DB_PATH)

trades_df = pd.read_sql_query("SELECT * FROM completed_trades", conn)
diff_df = pd.read_sql_query("SELECT * FROM diff_history", conn)

conn.close()

# --- Feature Engineering ---

# 1. Define successful trades
trades_df['is_successful'] = (trades_df['executedGrossProfit'] > 0).astype(int)

# 2. Prepare for merging
trades_df['ts'] = pd.to_datetime(trades_df['lastUpdateTime'], unit='ms')
diff_df['ts'] = pd.to_datetime(diff_df['ts'], unit='ms')

# Extract token from pair
def extract_token_from_pair(pair_str):
    if not pair_str: return None
    parts = pair_str.split('->')
    if not parts: return None
    # Take the first part of the pair
    first_leg = parts[0]
    # Split by '_' and take the last part, which should be TOKEN/QUOTE
    token_part = first_leg.split('_')[-1]
    if '/' in token_part:
        return token_part.split('/')[0]
    return None

trades_df['token'] = trades_df['pair'].apply(extract_token_from_pair)

# Extract token from curId
diff_df['token'] = diff_df['curId'].apply(lambda x: x.split('_')[1])

# Sort by timestamp for merge_asof
trades_df = trades_df.sort_values('ts')
diff_df = diff_df.sort_values('ts')

# 3. Merge dataframes
# Find the closest diff data for each trade within a 2-minute tolerance
merged_df = pd.merge_asof(
    trades_df,
    diff_df,
    on='ts',
    by='token',
    tolerance=pd.Timedelta('2m'),
    direction='nearest'
)

# 4. Create features and target
# For simplicity, we will use a subset of features that are likely to be available
# for prediction before a trade is executed.

# Extract features from props JSON
def extract_props(props_str):
    try:
        props = json.loads(props_str)
        return {
            'Diff': props.get('Diff'),
            'DexSlip': props.get('DexSlip'),
            'CexSlip': props.get('CexSlip')
        }
    except (json.JSONDecodeError, TypeError):
        return {'Diff': None, 'DexSlip': None, 'CexSlip': None}

props_features = trades_df['props'].apply(extract_props).apply(pd.Series)
merged_df = pd.concat([merged_df, props_features], axis=1)


features = ['buyDiffBps', 'sellDiffBps', 'Diff', 'DexSlip', 'CexSlip']
target = 'is_successful'

# Drop rows with missing feature values
final_df = merged_df.dropna(subset=features + [target])

X = final_df[features]
y = final_df[target]

if len(X) > 0:
    # --- Model Training ---
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    model = RandomForestClassifier(n_estimators=100, random_state=42)
    model.fit(X_train, y_train)

    # Evaluate the model
    y_pred = model.predict(X_test)
    accuracy = accuracy_score(y_test, y_pred)
    print(f"Model Accuracy: {accuracy:.2f}")

    # Save the model
    joblib.dump(model, 'trade_model.joblib')
    print("Model trained and saved as trade_model.joblib")
else:
    print("Not enough data to train the model. Please ensure both trades and diff data are available.")

