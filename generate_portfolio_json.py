import csv
import json
import math
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
CSV_PATH = BASE_DIR / "nifty_close.csv"
OUTPUT_PATH = BASE_DIR / "data" / "option-portfolio.json"

PORTFOLIO = {
    "quantity": 2475,
    "putStrike": 26000,
    "callStrike": 29000,
    "putIV": 0.16,
    "callIV": 0.09,
    "riskFreeRate": 0.10,
    "expiryDate": "2026-12-29",
}


def cumulative_normal_distribution(x: float) -> float:
    t = 1 / (1 + 0.2316419 * abs(x))
    d = 0.3989423 * math.exp(-x * x / 2)
    probability = d * t * (
        0.3193815
        + t
        * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))
    )
    return 1 - probability if x > 0 else probability


def black_scholes(spot, strike, time_to_expiry, risk_free_rate, volatility, option_type):
    if time_to_expiry <= 0:
      if option_type == "call":
          return max(spot - strike, 0)
      return max(strike - spot, 0)

    denominator = volatility * math.sqrt(time_to_expiry)
    d1 = (
        math.log(spot / strike)
        + (risk_free_rate + 0.5 * volatility * volatility) * time_to_expiry
    ) / denominator
    d2 = d1 - denominator

    if option_type == "call":
        return spot * cumulative_normal_distribution(d1) - strike * math.exp(
            -risk_free_rate * time_to_expiry
        ) * cumulative_normal_distribution(d2)

    return strike * math.exp(-risk_free_rate * time_to_expiry) * cumulative_normal_distribution(
        -d2
    ) - spot * cumulative_normal_distribution(-d1)


def round_number(value, digits=6):
    return round(float(value), digits)


def load_price_data():
    rows = []
    with CSV_PATH.open("r", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            try:
                date_value = datetime.strptime(row["date"].strip(), "%Y-%m-%d")
                close_value = float(row["close"])
            except (KeyError, ValueError):
                continue

            rows.append({"date": date_value, "close": close_value})

    rows.sort(key=lambda item: item["date"])
    return rows


def build_portfolio_payload():
    price_data = load_price_data()
    if not price_data:
        raise RuntimeError("No valid price data found in nifty_close.csv")

    expiry_date = datetime.strptime(PORTFOLIO["expiryDate"], "%Y-%m-%d")
    start_date = price_data[0]["date"]
    start_spot = price_data[0]["close"]
    start_time_to_expiry = max((expiry_date - start_date).days / 365, 0)

    start_put_price = black_scholes(
        start_spot,
        PORTFOLIO["putStrike"],
        start_time_to_expiry,
        PORTFOLIO["riskFreeRate"],
        PORTFOLIO["putIV"],
        "put",
    )

    start_call_price = black_scholes(
        start_spot,
        PORTFOLIO["callStrike"],
        start_time_to_expiry,
        PORTFOLIO["riskFreeRate"],
        PORTFOLIO["callIV"],
        "call",
    )

    initial_investment = (
        start_spot * PORTFOLIO["quantity"]
        + start_put_price * PORTFOLIO["quantity"]
        - start_call_price * PORTFOLIO["quantity"]
    )

    records = []
    for entry in price_data:
        time_to_expiry = max((expiry_date - entry["date"]).days / 365, 0)
        put_price = black_scholes(
            entry["close"],
            PORTFOLIO["putStrike"],
            time_to_expiry,
            PORTFOLIO["riskFreeRate"],
            PORTFOLIO["putIV"],
            "put",
        )
        call_price = black_scholes(
            entry["close"],
            PORTFOLIO["callStrike"],
            time_to_expiry,
            PORTFOLIO["riskFreeRate"],
            PORTFOLIO["callIV"],
            "call",
        )
        portfolio_value = (
            entry["close"] * PORTFOLIO["quantity"]
            + put_price * PORTFOLIO["quantity"]
            - call_price * PORTFOLIO["quantity"]
        )

        records.append(
            {
                "date": entry["date"].strftime("%Y-%m-%d"),
                "spot": round_number(entry["close"]),
                "putPrice": round_number(put_price),
                "callPrice": round_number(call_price),
                "portfolioValue": round_number(portfolio_value),
                "pnl": round_number(portfolio_value - initial_investment),
            }
        )

    return {
        "lastUpdated": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "config": PORTFOLIO,
        "summary": {
            "startSpot": round_number(start_spot),
            "startPutPrice": round_number(start_put_price),
            "startCallPrice": round_number(start_call_price),
            "initialInvestment": round_number(initial_investment),
        },
        "records": records,
    }


def main():
    payload = build_portfolio_payload()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Updated option portfolio JSON for {len(payload['records'])} records.")


if __name__ == "__main__":
    main()
