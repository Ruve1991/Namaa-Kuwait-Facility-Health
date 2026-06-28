# Namaa Facility Health Dashboard — Kuwait

A standalone web dashboard (no Apps Script) for tracking kitchen occupancy, churn, GMV,
and processing fees across all Kuwait facilities: Hawally 1, Hawally 2, Hawally 3, Bidaa.

## Files
- `index.html` — the app shell
- `app.js` — all dashboard logic (filtering, sorting, metrics, modals)
- `data.js` — embedded sample data (145 kitchens) shown until you connect your sheet
- `netlify.toml` — deploy config

## Deploy to Netlify
Same flow as your other tools:
1. Push this folder to a new GitHub repo (e.g. `Ruve1991/kuwait-facility-health`)
2. Netlify → Add new site → Import from GitHub → pick the repo
3. Build command: leave blank · Publish directory: `.`
4. Deploy. You'll get a `*.netlify.app` URL.

No environment variables, no functions, no backend needed for the base app —
it's pure static HTML/JS reading from a public CSV link.

## Connect your real Google Sheet
1. Open `Kuwait_Facility_Health_Template.xlsx` in Google Sheets (or just build your own
   sheet with the same column headers — see the "Read Me" tab in that file).
2. Fill in your real kitchen data, one row per kitchen unit.
3. In Google Sheets: **File → Share → Publish to web** → select the **Kitchens** sheet
   → format **Comma-separated values (.csv)** → Publish.
4. Copy the link it gives you (looks like
   `https://docs.google.com/spreadsheets/d/XXXX/pub?gid=0&single=true&output=csv`).
5. On the live dashboard, click **⚙ Data source** (top right) → paste the link →
   **Connect & reload**.

The link is saved in the browser only (localStorage), so each person who opens the
dashboard sets their own source — nothing is sent to a server.

## How it works
- Reads the published CSV on every page load (no caching beyond the browser).
- If the sheet can't be reached (wrong link, not published, sheet renamed), it falls
  back to sample data and shows a warning banner — it won't show a blank page.
- All metrics (occupancy, churn, GMV, PF take rate, tenure, grade mix) are computed
  live in the browser from whatever rows are loaded, broken down by facility and by
  licensee type (Start-up / Independent / Growth / Enterprise).
- Filters, search, and the "At-risk only" toggle all apply instantly — no reload needed.
- Click any facility row to drill into just that facility. Click any kitchen row for
  full detail. Export button downloads whatever's currently filtered, as CSV.

## Updating the sheet later
Just edit the Google Sheet directly — anyone with the dashboard open just needs to
reload the page to see fresh numbers. No re-publish needed after the first time
(published links stay live as the source sheet changes).

## Adding more facilities
Nothing to configure — just add rows with a new value in the **Facility** column and
the dashboard will pick it up automatically (filter dropdown + facility comparison
strip both regenerate from whatever facility names exist in the data).
