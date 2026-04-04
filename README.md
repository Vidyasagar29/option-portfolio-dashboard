# Option Portfolio Dashboard 2026

This project is a compact NIFTY options portfolio dashboard built for Aprameya.

It:
- reads historical NIFTY closing prices
- calculates option values using the Black-Scholes model
- shows a portfolio snapshot, trend chart, and payoff table

## Current Data Source

The dashboard is now configured to read data from Supabase in read-only mode.

Configured source:
- `dataSource: "supabase"` in `config.js`
- table: `nifty_sensex_closing_prices`
- date column: `date`
- close column: `nifty`

## Project Files

- `index.html`: dashboard markup
- `style.css`: dashboard styles
- `main.js`: dashboard logic, pricing, chart rendering, and data fetch
- `config.js`: runtime config for Supabase or CSV mode
- `nifty_close.csv`: local CSV fallback / legacy data file
- `update_from_sheet.py`: old Google Sheets sync script kept as legacy reference

## Configuration

Edit `config.js` to control the data source.

Example:

```js
window.APP_CONFIG = {
    dataSource: "supabase",
    csvUrl: "./nifty_close.csv",
    supabase: {
        url: "YOUR_SUPABASE_URL",
        anonKey: "YOUR_SUPABASE_ANON_KEY",
        publishableKey: "YOUR_SUPABASE_PUBLISHABLE_KEY",
        table: "nifty_sensex_closing_prices",
        dateColumn: "date",
        closeColumn: "nifty"
    }
};
```

Notes:
- use `anonKey` for frontend read-only access
- do not use a `service_role` key in frontend code
- if you want to switch back to local CSV, set `dataSource: "csv"`

## How To Run

You can run this as a simple static site.

Using Python:

```powershell
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Supabase Requirements

Your Supabase table should:
- allow read access for the frontend through RLS policies
- contain a valid date column
- contain a numeric NIFTY close column

## Legacy Note

The previous version of this project used Google Sheets and a GitHub Action to update `nifty_close.csv`.

That legacy workflow file and script still exist, but the dashboard itself is now configured to use Supabase.
