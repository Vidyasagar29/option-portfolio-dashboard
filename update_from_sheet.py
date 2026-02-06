import pandas as pd
import requests
import io
from datetime import date

# ===== CONFIG =====
SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTT0QXf8Hekn8p7M3HPoBhv_l_35bl781r7xHFAjnAXw3SgLwpCtuj9Uwa8UUYoz4KNfj7C2iE_ITK2/pub?gid=0&single=true&output=csv"
OUTPUT_CSV = "nifty_close.csv"
# ==================

today = date.today().isoformat()

# Fetch Google Sheet CSV
response = requests.get(SHEET_CSV_URL, timeout=30)
response.raise_for_status()

df = pd.read_csv(io.StringIO(response.text), header=None)

# B1 → row 0, column 1
close_price = float(df.iloc[0, 1])

new_row = pd.DataFrame([[today, close_price]], columns=["date", "close"])

# Append safely (no duplicate date)
try:
    existing = pd.read_csv(OUTPUT_CSV)
    if today not in existing["date"].astype(str).values:
        pd.concat([existing, new_row]).to_csv(OUTPUT_CSV, index=False)
except FileNotFoundError:
    new_row.to_csv(OUTPUT_CSV, index=False)
