<div align="center">

# Quiet Ledger

**A minimalist, cross-platform expense tracker for households and individuals.**
Shared spaces, salary-driven budgets, and category insights — as an installable
PWA that runs the same on iPhone and Android, all on a free stack.

</div>

---

## What it does

- **Two kinds of spaces, side by side.** A *Household* space your whole family
  shares, and a *Personal* space that's just yours. Switch with one tap, or see an
  **All** view that merges everything.
- **Salary-driven budgets.** Enter your monthly income, your fixed expenses (rent,
  utilities, insurance…), and a savings goal. It auto-suggests a budget for every
  category from what's left — and every number stays editable.
- **Spend at a glance.** A tonal donut and category list show where the money goes,
  in both amount and percentage, with MTD and YTD views.
- **Pace tracking.** A marker shows whether you're spending faster than the month is
  passing, so overspending is visible early instead of at month-end.
- **Statement import.** Upload a CSV exported from your bank or card. It auto-detects
  columns, guesses categories from the description, drops credits like salary, and
  lets you review before importing — all parsed on-device.
- **Real sharing.** Invite people to a space by email. Everyone signs in and edits
  one live ledger; changes sync across phones in real time. Roles are
  owner / member / viewer.

## Screens

| Home | Insights | Plan |
|---|---|---|
| Total, pace bar, donut, categories, recent | Monthly trend, daily average, category share | Income, fixed costs, auto budgets |

*(Add screenshots here once deployed — e.g. `docs/home.png`.)*

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| UI | **React + Vite** | Fast, single codebase for both platforms |
| Install | **PWA** (`vite-plugin-pwa`) | "Add to Home Screen," no app stores, no fees |
| Backend | **Supabase** (Postgres, Auth, Realtime) | Free tier, live sync, no server to run |
| Security | **Row-Level Security** | Access enforced in the database, per space membership |
| Hosting | **Vercel** | Free static hosting, deploy from GitHub |
| CSV parsing | **PapaParse** | Robust client-side statement import |

**Cost to run:** ₹0 for personal + family use. No credit card, no store fees.

## Project layout

```
schema.sql                 # run once in Supabase — tables + RLS + invite flow
src/
  App.jsx                  # the whole UI (spaces, budgets, insights, sheets)
  useLedger.js             # loads spaces, persists changes, live sync (the data brain)
  lib/
    supabaseClient.js      # connects with the public anon key
    ledgerApi.js           # every read/write + realtime subscription
  components/
    AuthGate.jsx           # magic-link / Google sign-in wrapper
.github/workflows/
  heartbeat.yml            # keeps the free DB awake (pings every 3 days)
```

Everything that touches the database lives in `src/useLedger.js` and
`src/lib/ledgerApi.js` — the UI never talks to Supabase directly.

## Getting started

Full step-by-step (GitHub → Supabase → Vercel, ~15 min) is in
**[GETSTARTED.md](./GETSTARTED.md)**. The short version:

```bash
# 1. Configure
cp .env.example .env        # add your Supabase URL + anon key

# 2. Run locally
npm install
npm run dev                 # http://localhost:5173

# 3. Build for production
npm run build
```

You'll also run `schema.sql` once in the Supabase SQL editor, and set the same two
env vars in Vercel. That's it.

### Environment variables

| Variable | Where to find it |
|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon public key |

The anon key is safe to ship to the browser — Row-Level Security is what protects
the data, not key secrecy.

## Security notes

- Every table has **Row-Level Security**: a user can only read or write rows for
  spaces they belong to, checked by Postgres on every query.
- Only the public anon key reaches the browser; the service key never leaves Supabase.
- TLS in transit, encrypted at rest.
- `.env` is git-ignored — don't commit your keys.

## Roadmap

- [ ] Roommates / split spaces: per-person balances and settle-up (schema already
      records `paid_by`)
- [ ] PDF statement import
- [ ] Recurring fixed-expense auto-logging
- [ ] Custom categories
- [ ] App Store / Play Store builds via Capacitor (optional)

## Status

Built and building cleanly. Not yet run against a live database — if a screen errors
after connecting Supabase, it's a quick fix in the data layer.

## License

Personal project. Use it, fork it, make it yours.
