# Quiet Ledger — get it live (≈15 min, ₹0)

The whole app is built and committed. Your only job is to create three free
accounts and paste two keys. No coding. Follow in order.

## A. Put it on GitHub (3 min)
1. Make a new empty repo at github.com (name it `quiet-ledger`, keep it private).
2. In a terminal, inside this folder, run the three lines GitHub shows you under
   **"…or push an existing repository"** — they look like:
   ```
   git remote add origin https://github.com/YOU/quiet-ledger.git
   git branch -M main
   git push -u origin main
   ```
   (The repo is already committed, so `git push` is all that's left.)

## B. Create the database (5 min)
1. Sign up at **supabase.com** → New project (region: Mumbai or Singapore). No card.
2. Open **SQL Editor**, paste all of **`schema.sql`**, press **Run**.
3. **Project Settings → API** → copy the **Project URL** and the **anon public** key.
4. **Authentication → Providers**: Email is already on (magic-link login). Optionally enable Google.
5. **Authentication → URL Configuration**: add your future site URL
   (e.g. `https://quiet-ledger.vercel.app`) to the redirect list. Add `http://localhost:5173` too if you want to run it locally.

## C. Deploy to Vercel (5 min)
1. Sign up at **vercel.com** with your GitHub → **Add New → Project** → import `quiet-ledger`.
2. In **Environment Variables**, add the two from step B3:
   ```
   VITE_SUPABASE_URL   = https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY = your-anon-public-key
   ```
3. Click **Deploy**. You get a live `https://quiet-ledger.vercel.app`.

## D. Use it
- Open the URL, sign in with your email (magic link). Two starter spaces —
  **Household** and **Personal** — are created for you automatically.
- On each phone: open the URL → browser menu → **Add to Home Screen**. It now
  launches full-screen like a real app, on both iPhone and Android.
- **Share Household with your parents:** open Household → **+ Invite** → type their
  email. They open the same URL, sign in with that email, and they're in. All
  three phones now show the same live ledger. Your Personal stays yours.

## E. Keep it free & awake (optional, 2 min)
Free Supabase sleeps after 7 idle days. To prevent it:
- In your GitHub repo → **Settings → Secrets and variables → Actions**, add
  `SUPABASE_URL` and `SUPABASE_ANON_KEY` (same two values).
- The included `.github/workflows/heartbeat.yml` pings the DB every 3 days. Done.

---
### Run locally first (optional)
```
cp .env.example .env      # paste your two keys into it
npm install
npm run dev               # opens http://localhost:5173
```

### If something misbehaves
The app is built and compiles cleanly, but it hasn't been run against a live
database yet — if a screen errors after you connect Supabase, tell Claude the
exact message and it's a quick fix. Everything data-related lives in
`src/useLedger.js` and `src/lib/ledgerApi.js`.
