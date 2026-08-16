import React, { useState, useEffect, useRef } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { useLedger } from "./useLedger";
import { signOut } from "./lib/ledgerApi";

// ── Quiet Ledger ─────────────────────────────────────────────────
// Spaces (Family shared-pool / Roommates split) · All view ·
// bottom tabs (Home / Insights / Plan) · salary-driven budgets · INR.
// Persists via window.storage.

const P = {
  paper: "#F4F3F0", surface: "#FCFBF9", ink: "#1C1B19", inkSoft: "#77736C",
  inkFaint: "#A8A39B", hairline: "#E7E3DC", accent: "#2E5A47", accentSoft: "#EAF0EC",
  warn: "#B0703A", over: "#A5453A",
};
const CATEGORIES = [
  { id: "food", label: "Food & Dining", color: "#2E5A47" },
  { id: "grocery", label: "Groceries", color: "#6E8E5F" },
  { id: "transport", label: "Transport", color: "#4A6C7A" },
  { id: "bills", label: "Rent & Bills", color: "#3A3A44" },
  { id: "shopping", label: "Shopping", color: "#9C6B4E" },
  { id: "fun", label: "Entertainment", color: "#7A5A78" },
  { id: "health", label: "Health", color: "#B08A3E" },
  { id: "other", label: "Other", color: "#8A8580" },
];
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
const WEIGHTS = { grocery: 0.22, food: 0.18, transport: 0.12, shopping: 0.14, fun: 0.12, health: 0.1, other: 0.12 };
const STORE_KEY = "quiet-ledger-v3";
const CURRENCIES = { "₹": { code: "INR", locale: "en-IN" }, "$": { code: "USD", locale: "en-US" } };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const now = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const uid = () => crypto.randomUUID();

// ── budget engine ────────────────────────────────────────────────
function suggest(income, savingsPct, fixed) {
  const inc = Math.max(0, income || 0);
  const fixedByCat = {}; CATEGORIES.forEach((c) => (fixedByCat[c.id] = 0));
  (fixed || []).forEach((f) => (fixedByCat[f.cat] += f.amount || 0));
  const fixedTotal = Object.values(fixedByCat).reduce((a, b) => a + b, 0);
  const savings = Math.round((inc * (savingsPct || 0)) / 100);
  const allocatable = Math.max(0, inc - savings);
  const spendable = Math.max(0, allocatable - fixedTotal);
  const suggested = {};
  CATEGORIES.forEach((c) => (suggested[c.id] = Math.round((fixedByCat[c.id] || 0) + (WEIGHTS[c.id] ? spendable * WEIGHTS[c.id] : 0))));
  return { suggested, fixedByCat, fixedTotal, savings, allocatable, spendable };
}
const effBudgets = (sp) => {
  const pl = suggest(sp.income, sp.savingsPct, sp.fixed), b = {};
  CATEGORIES.forEach((c) => (b[c.id] = sp.overrides[c.id] != null ? sp.overrides[c.id] : pl.suggested[c.id]));
  return b;
};

// ── seed ─────────────────────────────────────────────────────────
function seed(list) {
  const y = now.getFullYear(), m = now.getMonth(), day = now.getDate(), out = [];
  list.thisMonth.forEach((e, i) => {
    const d = Math.max(1, Math.min(day, 1 + Math.floor((i / list.thisMonth.length) * day)));
    out.push({ id: uid(), date: iso(new Date(y, m, d)), cat: e[0], amount: e[1], note: e[2] });
  });
  for (let mm = 0; mm < m; mm++) list.past.forEach((p) => out.push({ id: uid(), date: iso(new Date(y, mm, 12)), cat: p[0], amount: p[1] * (0.8 + Math.random() * 0.4), note: p[2] }));
  return out.map((e) => ({ ...e, amount: Math.round(e.amount) }));
}
function defaultData() {
  return {
    cur: "₹", activeSpace: "household",
    spaces: [
      {
        id: "household", name: "Household", type: "family", members: ["You", "Mom", "Dad"],
        income: 180000, savingsPct: 20,
        fixed: [
          { id: uid(), name: "Rent", amount: 45000, cat: "bills" },
          { id: uid(), name: "Utilities", amount: 6000, cat: "bills" },
          { id: uid(), name: "Internet & phone", amount: 2200, cat: "bills" },
          { id: uid(), name: "Help & maintenance", amount: 8000, cat: "other" },
          { id: uid(), name: "Insurance", amount: 5000, cat: "health" },
        ],
        overrides: {},
        expenses: seed({
          thisMonth: [["grocery", 3200, "Monthly stock-up"], ["grocery", 1650, "Veg & fruit"], ["food", 1400, "Dinner out"], ["food", 620, "Snacks"], ["transport", 2600, "Fuel"], ["transport", 380, "Auto"], ["shopping", 2900, "Home goods"], ["fun", 900, "Family outing"], ["health", 740, "Medicines"], ["other", 500, "Sundries"]],
          past: [["bills", 45000, "Rent"], ["grocery", 5200, "Groceries"], ["food", 2800, "Eating out"], ["transport", 3200, "Fuel"], ["shopping", 1800, "Household"]],
        }),
      },
      {
        id: "personal", name: "Personal", type: "family", members: ["You"],
        income: 40000, savingsPct: 15,
        fixed: [{ id: uid(), name: "Phone plan", amount: 800, cat: "bills" }, { id: uid(), name: "Subscriptions", amount: 1200, cat: "fun" }],
        overrides: {},
        expenses: seed({
          thisMonth: [["food", 260, "Lunch"], ["food", 130, "Boba"], ["food", 190, "Coffee"], ["transport", 320, "Rides"], ["shopping", 950, "Tee"], ["grocery", 420, "Snacks"], ["fun", 250, "Movie"], ["other", 160, "Misc"]],
          past: [["food", 1600, "Eating out"], ["transport", 800, "Transit"], ["shopping", 1200, "Clothes"]],
        }),
      },
    ],
  };
}

export default function App() {
  const { ready: loaded, data, setData, actions, invites } = useLedger();
  const [tab, setTab] = useState("home");
  const [period, setPeriod] = useState("mtd");
  const [selected, setSelected] = useState(null);
  const [sheet, setSheet] = useState(null);
  useEffect(() => {
    const id = "ql-fonts";
    if (!document.getElementById(id)) {
      const l = document.createElement("link"); l.id = id; l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap";
      document.head.appendChild(l);
    }
  }, []);

  const cur = data?.cur || "₹";
  const c = CURRENCIES[cur];
  const fmt = (n) => { const v = Math.round((n || 0) * 100) / 100, whole = Math.round(v) === v; return new Intl.NumberFormat(c.locale, { style: "currency", currency: c.code, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(v); };
  const fmtK = (n) => { const v = Math.round(n || 0); return cur + (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : v); };

  const serif = { fontFamily: "'Fraunces', Georgia, serif" };
  const sans = { fontFamily: "'Inter', system-ui, sans-serif" };
  const eyebrow = { ...sans, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: P.inkFaint };
  const tnum = { fontVariantNumeric: "tabular-nums" };
  const S = { serif, sans, eyebrow, tnum, fmt, fmtK, cur };

  if (!loaded || !data)
    return <div style={{ ...sans, minHeight: 520, background: P.paper, display: "flex", alignItems: "center", justifyContent: "center", color: P.inkFaint, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase" }}>Opening ledger…</div>;

  // no spaces yet → show pending invites to join, and/or create your first space
  if (data.spaces.length === 0)
    return <FirstSpace invites={invites} onApprove={actions.approveInvite} onDecline={actions.declineInvite} onCreate={actions.createSpaceAction} S={S} />;

  const isAll = data.activeSpace === "all";
  const realSpaces = data.spaces;
  const activeReal = realSpaces.find((s) => s.id === data.activeSpace);

  // build the "view" — a real space, or a synthesized aggregate for All
  let view, budgets;
  if (isAll) {
    const merged = realSpaces.flatMap((s) => s.expenses);
    const inc = realSpaces.reduce((a, s) => a + s.income, 0);
    const sav = realSpaces.reduce((a, s) => a + suggest(s.income, s.savingsPct, s.fixed).savings, 0);
    view = { id: "all", name: "All spaces", type: "all", members: [], income: inc, savingsPct: inc ? Math.round((sav / inc) * 100) : 0, fixed: realSpaces.flatMap((s) => s.fixed), overrides: {}, expenses: merged };
    budgets = {}; CATEGORIES.forEach((cat) => (budgets[cat.id] = realSpaces.reduce((a, s) => a + effBudgets(s)[cat.id], 0)));
  } else {
    view = activeReal; budgets = effBudgets(view);
  }

  // mutators — optimistic local update, then persist to Supabase via the hook
  const patchSpace = (patch) => {
    const sid = data.activeSpace, prev = activeReal;
    setData((d) => ({ ...d, spaces: d.spaces.map((s) => (s.id === sid ? { ...s, ...patch } : s)) }));
    actions.persistPatch(sid, patch, prev);
  };
  const setActive = (id) => { actions.setActive(id); setSelected(null); setTab("home"); };
  const setCur = (x) => actions.setCur(x);
  const addExpense = (e) => { actions.addTransaction(data.activeSpace, e); setSheet(null); };
  const addMany = (rows) => { actions.importMany(data.activeSpace, rows); setSheet(null); };
  const delExpense = (id) => actions.removeTransaction(data.activeSpace, id);
  const addSpace = (name, type) => { actions.createSpaceAction(name, type); setSheet(null); setTab("plan"); };

  // period derived
  const y = now.getFullYear(), m = now.getMonth();
  const inPeriod = (e) => { const d = new Date(e.date); return period === "mtd" ? d.getFullYear() === y && d.getMonth() === m : d.getFullYear() === y; };
  const pe = view.expenses.filter(inPeriod);
  const byCat = {}; CATEGORIES.forEach((cat) => (byCat[cat.id] = 0)); pe.forEach((e) => (byCat[e.cat] += e.amount));
  const total = Object.values(byCat).reduce((a, b) => a + b, 0);
  const monthsElapsed = period === "mtd" ? 1 : m + 1;
  const budgetTotal = Object.values(budgets).reduce((a, b) => a + b, 0) * monthsElapsed;
  const ranked = CATEGORIES.map((cat) => ({ ...cat, spent: byCat[cat.id] })).filter((x) => x.spent > 0).sort((a, b) => b.spent - a.spent);

  const ctx = { data, view, isAll, budgets, period, setPeriod, selected, setSelected, byCat, total, budgetTotal, monthsElapsed, ranked, pe, delExpense, addMany, setActive, setSheet, invite: actions.invite, S };

  return (
    <div style={{ ...sans, background: P.paper, minHeight: 700, display: "flex", justifyContent: "center", color: P.ink }}>
      <div style={{ width: "100%", maxWidth: 430, position: "relative", paddingBottom: 96 }}>

        {invites && invites.length > 0 && <InviteBanner invites={invites} onApprove={actions.approveInvite} onDecline={actions.declineInvite} S={S} />}

        {/* top bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 16px 10px" }}>
          <div style={eyebrow}>Quiet Ledger</div>
          <button onClick={() => setSheet("settings")} aria-label="Settings" style={{ ...sans, background: "none", border: `1px solid ${P.hairline}`, borderRadius: 999, width: 34, height: 34, cursor: "pointer", color: P.inkSoft, fontSize: 15 }}>⚙</button>
        </div>

        {/* space pills */}
        <div className="ql-scroll" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "2px 16px 14px" }}>
          <SpacePill label="All" active={isAll} onClick={() => setActive("all")} S={S} />
          {realSpaces.map((s) => <SpacePill key={s.id} label={s.name} sub={s.type === "roommates" ? "split" : null} active={data.activeSpace === s.id} onClick={() => setActive(s.id)} S={S} />)}
          <button onClick={() => setSheet("space")} style={{ ...sans, flex: "0 0 auto", fontSize: 16, fontWeight: 500, color: P.inkSoft, background: "none", border: `1px dashed ${P.hairline}`, borderRadius: 999, width: 38, height: 34, cursor: "pointer" }}>+</button>
        </div>

        {/* screen */}
        <div style={{ padding: "0 16px" }}>
          {tab === "home" && <Home ctx={ctx} />}
          {tab === "insights" && <Insights ctx={ctx} />}
          {tab === "plan" && <Plan ctx={ctx} patchSpace={patchSpace} />}
        </div>

        {/* floating add */}
        {!isAll && (
          <button onClick={() => setSheet("add")} aria-label="Add expense"
            style={{ ...sans, position: "fixed", bottom: 78, left: "50%", transform: "translateX(calc(215px - 100%))", background: P.accent, color: "#fff", border: "none", borderRadius: 999, width: 56, height: 56, fontSize: 26, cursor: "pointer", boxShadow: "0 8px 24px rgba(46,90,71,0.36)", zIndex: 40 }}>+</button>
        )}

        {/* bottom tabs */}
        <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: P.surface, borderTop: `1px solid ${P.hairline}`, display: "flex", zIndex: 30 }}>
          {[["home", "Home", IconHome], ["insights", "Insights", IconChart], ["plan", "Plan", IconTarget]].map(([k, lbl, Ico]) => (
            <button key={k} onClick={() => setTab(k)} style={{ ...sans, flex: 1, background: "none", border: "none", padding: "11px 0 13px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, color: tab === k ? P.accent : P.inkFaint }}>
              <Ico active={tab === k} />
              <span style={{ fontSize: 10.5, fontWeight: tab === k ? 600 : 500 }}>{lbl}</span>
            </button>
          ))}
        </div>

        {sheet === "add" && <AddSheet onClose={() => setSheet(null)} onAdd={addExpense} space={activeReal} S={S} />}
        {sheet === "import" && <ImportSheet onClose={() => setSheet(null)} onImport={addMany} space={activeReal} S={S} />}
        {sheet === "space" && <CreateSpaceSheet onClose={() => setSheet(null)} onCreate={addSpace} S={S} />}
        {sheet === "settings" && <SettingsSheet cur={cur} setCur={setCur} space={activeReal} isAll={isAll} onDelete={() => { actions.deleteSpace(data.activeSpace); setSheet(null); }} onSignOut={signOut} onClose={() => setSheet(null)} S={S} />}
      </div>

      <style>{`
        .ql-row:hover { background: ${P.accentSoft}; }
        .ql-scroll::-webkit-scrollbar { display: none; }
        .ql-scroll { scrollbar-width: none; }
        button:focus-visible { outline: 2px solid ${P.accent}; outline-offset: 2px; }
        @keyframes ql-up { from { transform: translateY(24px); opacity:.4 } to { transform: translateY(0); opacity:1 } }
        input:focus, select:focus { outline: none; border-color: ${P.accent} !important; }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
      `}</style>
    </div>
  );
}

// ── HOME ─────────────────────────────────────────────────────────
function Home({ ctx }) {
  const { view, isAll, budgets, period, setPeriod, selected, setSelected, total, budgetTotal, monthsElapsed, ranked, pe, delExpense, S } = ctx;
  const { serif, sans, eyebrow, tnum, fmt } = S;
  const remaining = budgetTotal - total;
  const y = now.getFullYear(), m = now.getMonth();
  const dEl = now.getDate(), dIn = daysInMonth(y, m), paceFrac = dEl / dIn;
  const savings = suggest(view.income, view.savingsPct, view.fixed).savings;
  const recent = [...pe].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 30);

  return (
    <>
      <PeriodToggle period={period} setPeriod={(p) => { setPeriod(p); setSelected(null); }} S={S} />
      {!isAll && <MembersRow space={view} onInvite={ctx.invite} S={S} />}

      <div style={{ marginBottom: 8 }}>
        <div style={eyebrow}>{isAll ? "All spaces · total spent" : "Total spent"}</div>
        <div style={{ ...serif, ...tnum, fontSize: 46, fontWeight: 500, lineHeight: 1.05, marginTop: 6, letterSpacing: "-0.02em" }}>{fmt(total)}</div>
        <div style={{ ...sans, ...tnum, fontSize: 13, color: remaining >= 0 ? P.inkSoft : P.over, marginTop: 8 }}>
          {remaining >= 0 ? <>{fmt(remaining)} left of {fmt(budgetTotal)} budget</> : <>{fmt(-remaining)} over your {fmt(budgetTotal)} budget</>}
        </div>
        {savings > 0 && period === "mtd" && <div style={{ ...sans, ...tnum, fontSize: 12, color: P.accent, marginTop: 4 }}>Saving {fmt(savings)}/mo</div>}
      </div>

      <div style={{ margin: "18px 0 26px" }}>
        <div style={{ position: "relative", height: 8, background: P.hairline, borderRadius: 999, overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, width: `${Math.min(100, budgetTotal ? (total / budgetTotal) * 100 : 0)}%`, background: total > budgetTotal ? P.over : P.accent, borderRadius: 999, transition: "width .4s ease" }} />
        </div>
        {period === "mtd" && budgetTotal > 0 && (
          <>
            <div style={{ position: "relative", height: 0 }}><div style={{ position: "absolute", top: -13, left: `${paceFrac * 100}%`, width: 1.5, height: 13, background: P.ink, opacity: 0.55, transform: "translateX(-50%)" }} /></div>
            <div style={{ ...sans, fontSize: 11.5, marginTop: 8, color: P.inkSoft }}>
              {total / budgetTotal > paceFrac ? <><span style={{ color: P.warn, fontWeight: 500 }}>Ahead of pace</span> — day {dEl} of {dIn}.</> : <><span style={{ color: P.accent, fontWeight: 500 }}>On pace</span> — day {dEl} of {dIn}.</>}
            </div>
          </>
        )}
      </div>

      <div style={{ background: P.surface, border: `1px solid ${P.hairline}`, borderRadius: 22, padding: "24px 20px 8px", marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
          <Donut data={ranked} total={total} selected={selected} onSelect={(id) => setSelected(id === selected ? null : id)} S={S} />
        </div>
        <div style={{ ...eyebrow, padding: "10px 4px 4px" }}>By category</div>
        {ranked.length === 0 && <div style={{ ...sans, fontSize: 13, color: P.inkFaint, padding: "18px 4px 24px", textAlign: "center" }}>No spending yet this period.</div>}
        {ranked.map((c) => {
          const bud = budgets[c.id] * monthsElapsed, pct = bud ? Math.min(100, (c.spent / bud) * 100) : 0, share = total ? Math.round((c.spent / total) * 100) : 0, dim = selected && selected !== c.id;
          return (
            <div key={c.id} onClick={() => setSelected(c.id === selected ? null : c.id)} style={{ padding: "13px 4px", borderTop: `1px solid ${P.hairline}`, cursor: "pointer", opacity: dim ? 0.4 : 1, transition: "opacity .2s" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: c.color }} /><span style={{ ...sans, fontSize: 14, fontWeight: 500 }}>{c.label}</span></div>
                <span style={{ ...sans, ...tnum, fontSize: 14, fontWeight: 500 }}>{fmt(c.spent)}<span style={{ color: P.inkFaint, fontWeight: 500, fontSize: 12 }}> · {share}%</span></span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <div style={{ flex: 1, height: 4, background: P.hairline, borderRadius: 999, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: c.spent > bud ? P.over : c.color, borderRadius: 999, transition: "width .4s" }} /></div>
                <span style={{ ...sans, ...tnum, fontSize: 11, color: c.spent > bud ? P.over : P.inkFaint, minWidth: 84, textAlign: "right" }}>of {fmt(bud)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 4px 10px" }}>
        <span style={eyebrow}>Recent</span>
        {!isAll && <button onClick={() => ctx.setSheet("import")} style={{ ...sans, fontSize: 11.5, fontWeight: 600, color: P.accent, background: "none", border: `1px solid ${P.hairline}`, borderRadius: 999, padding: "5px 12px", cursor: "pointer" }}>↥ Import statement</button>}
      </div>
      <div style={{ background: P.surface, border: `1px solid ${P.hairline}`, borderRadius: 22, overflow: "hidden" }}>
        {recent.length === 0 && <div style={{ ...sans, fontSize: 13, color: P.inkFaint, padding: 20, textAlign: "center" }}>Nothing logged yet.</div>}
        {recent.map((e, i) => (
          <div key={e.id} className="ql-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", borderTop: i ? `1px solid ${P.hairline}` : "none" }}>
            <span style={{ width: 8, height: 8, borderRadius: 3, background: CAT[e.cat]?.color || P.inkFaint }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...sans, fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.note || CAT[e.cat]?.label}{e.fixed && <span style={{ fontSize: 10, color: P.inkFaint }}> · fixed</span>}</div>
              <div style={{ ...sans, fontSize: 11, color: P.inkFaint, marginTop: 2 }}>{CAT[e.cat]?.label} · {new Date(e.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
            </div>
            <span style={{ ...sans, ...tnum, fontSize: 13.5, fontWeight: 500 }}>{fmt(e.amount)}</span>
            {!ctx.isAll && <button onClick={() => delExpense(e.id)} aria-label="Delete" style={{ background: "none", border: "none", cursor: "pointer", color: P.inkFaint, fontSize: 15, padding: "2px 4px" }}>×</button>}
          </div>
        ))}
      </div>
    </>
  );
}

// ── INSIGHTS ─────────────────────────────────────────────────────
function Insights({ ctx }) {
  const { view, ranked, byCat, S } = ctx;
  const { serif, sans, eyebrow, tnum, fmt, fmtK } = S;
  const y = now.getFullYear(), m = now.getMonth();
  const monthly = Array.from({ length: m + 1 }, (_, i) => view.expenses.filter((e) => { const d = new Date(e.date); return d.getFullYear() === y && d.getMonth() === i; }).reduce((a, e) => a + e.amount, 0));
  const maxM = Math.max(1, ...monthly);
  const thisM = monthly[m] || 0, lastM = monthly[m - 1] || 0;
  const delta = lastM ? Math.round(((thisM - lastM) / lastM) * 100) : 0;
  const dailyAvg = thisM / now.getDate();
  const ytd = monthly.reduce((a, b) => a + b, 0);
  const top = ranked[0];

  return (
    <div style={{ paddingTop: 6 }}>
      <div style={{ ...eyebrow, marginBottom: 14 }}>Insights · {view.name}</div>

      <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
        <Stat label="This month" value={fmt(thisM)} note={lastM ? `${delta >= 0 ? "+" : ""}${delta}% vs last` : "no prior month"} noteColor={delta > 0 ? P.over : P.accent} S={S} />
        <Stat label="Daily avg" value={fmt(Math.round(dailyAvg))} note={`over ${now.getDate()} days`} S={S} />
      </div>

      <div style={{ background: P.surface, border: `1px solid ${P.hairline}`, borderRadius: 22, padding: "20px 18px", marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18 }}>
          <div style={eyebrow}>Monthly spend · {y}</div>
          <div style={{ ...sans, ...tnum, fontSize: 12, color: P.inkSoft }}>YTD {fmt(ytd)}</div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 130 }}>
          {monthly.map((v, i) => (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{ ...sans, ...tnum, fontSize: 8.5, color: P.inkFaint, opacity: v ? 1 : 0 }}>{fmtK(v)}</div>
              <div style={{ width: "100%", maxWidth: 26, height: `${(v / maxM) * 96}px`, minHeight: v ? 3 : 0, background: i === m ? P.accent : P.hairline, borderRadius: 5, transition: "height .4s" }} />
              <div style={{ ...sans, fontSize: 9, color: i === m ? P.accent : P.inkFaint, fontWeight: i === m ? 600 : 500 }}>{MONTHS[i]}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: P.surface, border: `1px solid ${P.hairline}`, borderRadius: 22, padding: "20px 18px", marginBottom: 18 }}>
        <div style={{ ...eyebrow, marginBottom: 14 }}>Where it goes {top && <span style={{ color: P.inkSoft, textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>· {top.label} leads</span>}</div>
        {ranked.length === 0 && <div style={{ ...sans, fontSize: 13, color: P.inkFaint }}>No data yet.</div>}
        {ranked.map((c) => {
          const share = ctx.total ? Math.round((c.spent / ctx.total) * 100) : 0;
          return (
            <div key={c.id} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", ...sans, fontSize: 13, marginBottom: 5 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: 2.5, background: c.color }} />{c.label}</span>
                <span style={tnum}>{fmt(c.spent)} <span style={{ color: P.inkFaint }}>· {share}%</span></span>
              </div>
              <div style={{ height: 6, background: P.hairline, borderRadius: 999, overflow: "hidden" }}><div style={{ width: `${share}%`, height: "100%", background: c.color, borderRadius: 999, transition: "width .4s" }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── PLAN ─────────────────────────────────────────────────────────
function Plan({ ctx, patchSpace }) {
  const { view, isAll, budgets, setActive, data, addMany, S } = ctx;
  const { serif, sans, eyebrow, tnum, fmt, cur } = S;
  const [logged, setLogged] = useState(null);

  if (isAll)
    return (
      <div style={{ paddingTop: 6 }}>
        <div style={{ ...eyebrow, marginBottom: 14 }}>Plan</div>
        <div style={{ background: P.surface, border: `1px solid ${P.hairline}`, borderRadius: 22, padding: 24, textAlign: "center" }}>
          <div style={{ ...sans, fontSize: 13.5, color: P.inkSoft, marginBottom: 16, lineHeight: 1.5 }}>Income and budgets are set per space. Pick one to plan:</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            {data.spaces.map((s) => <button key={s.id} onClick={() => setActive(s.id)} style={{ ...sans, fontSize: 13, fontWeight: 500, padding: "10px 16px", borderRadius: 999, border: `1px solid ${P.hairline}`, background: "transparent", color: P.ink, cursor: "pointer" }}>{s.name}</button>)}
          </div>
        </div>
      </div>
    );

  const plan = suggest(view.income, view.savingsPct, view.fixed);
  const totalBudget = Object.values(budgets).reduce((a, b) => a + b, 0);
  const leftover = plan.allocatable - totalBudget;
  const inp = (w) => ({ ...sans, fontVariantNumeric: "tabular-nums", fontSize: 14, width: w, boxSizing: "border-box", textAlign: "right", padding: "9px 11px", border: `1px solid ${P.hairline}`, borderRadius: 10, background: P.surface, color: P.ink });
  const setBudget = (id, v) => patchSpace({ overrides: { ...view.overrides, [id]: Math.max(0, Math.round(parseFloat(v) || 0)) } });
  const resetBudget = (id) => { const o = { ...view.overrides }; delete o[id]; patchSpace({ overrides: o }); };
  const setFixed = (id, patch) => patchSpace({ fixed: view.fixed.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  const addFixed = () => patchSpace({ fixed: [...view.fixed, { id: uid(), name: "New item", amount: 0, cat: "bills" }] });
  const delFixed = (id) => patchSpace({ fixed: view.fixed.filter((f) => f.id !== id) });
  const logFixed = () => {
    const yy = now.getFullYear(), mm = now.getMonth();
    const already = new Set(view.expenses.filter((e) => e.fixed && new Date(e.date).getMonth() === mm && new Date(e.date).getFullYear() === yy).map((e) => e.note));
    const add = view.fixed.filter((f) => !already.has(f.name)).map((f) => ({ date: iso(now), cat: f.cat, amount: f.amount, note: f.name, fixed: true }));
    if (add.length) ctx.addMany(add);
    setLogged(add.length);
  };

  return (
    <div style={{ paddingTop: 6 }}>
      <div style={{ ...eyebrow, marginBottom: 6 }}>Plan · {view.name}</div>

      <div style={{ display: "flex", gap: 12, margin: "10px 0 6px" }}>
        <div style={{ flex: 1 }}>
          <div style={{ ...eyebrow, marginBottom: 7 }}>Monthly income</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${P.hairline}`, borderRadius: 12, padding: "4px 12px", background: P.surface }}>
            <span style={{ ...serif, fontSize: 18, color: P.inkSoft }}>{cur}</span>
            <input inputMode="decimal" value={view.income} onChange={(e) => patchSpace({ income: Math.max(0, parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0) })} style={{ ...serif, ...tnum, fontSize: 20, fontWeight: 500, border: "none", background: "none", width: "100%", color: P.ink, padding: "8px 0" }} />
          </div>
        </div>
        <div style={{ width: 108 }}>
          <div style={{ ...eyebrow, marginBottom: 7 }}>Savings %</div>
          <input inputMode="decimal" value={view.savingsPct} onChange={(e) => patchSpace({ savingsPct: Math.min(90, Math.max(0, parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0)) })} style={{ ...inp("100%"), ...serif, fontSize: 20, fontWeight: 500, height: 46, textAlign: "left", paddingLeft: 14 }} />
        </div>
      </div>

      <div style={{ background: P.accentSoft, borderRadius: 14, padding: "13px 15px", margin: "12px 0 22px" }}>
        {[["Income", plan.allocatable + plan.savings], ["Savings goal", -plan.savings], ["Fixed expenses", -plan.fixedTotal]].map(([l, v]) => (
          <div key={l} style={{ display: "flex", justifyContent: "space-between", ...sans, fontSize: 13, color: P.inkSoft, padding: "3px 0", fontVariantNumeric: "tabular-nums" }}><span>{l}</span><span>{v < 0 ? `− ${fmt(-v)}` : fmt(v)}</span></div>
        ))}
        <div style={{ borderTop: `1px solid ${P.hairline}`, margin: "7px 0", opacity: 0.6 }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={{ ...sans, fontSize: 13, fontWeight: 600, color: P.accent }}>Left to spend</span><span style={{ ...serif, fontSize: 20, fontWeight: 500, color: P.accent, fontVariantNumeric: "tabular-nums" }}>{fmt(plan.spendable)}</span></div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={eyebrow}>Fixed expenses</div>
        <button onClick={addFixed} style={{ ...sans, fontSize: 12, fontWeight: 600, color: P.accent, background: "none", border: "none", cursor: "pointer" }}>+ Add</button>
      </div>
      {view.fixed.map((f) => (
        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <input value={f.name} onChange={(e) => setFixed(f.id, { name: e.target.value })} style={{ ...sans, fontSize: 13.5, flex: 1, minWidth: 0, padding: "9px 11px", border: `1px solid ${P.hairline}`, borderRadius: 10, background: P.surface, color: P.ink, boxSizing: "border-box" }} />
          <select value={f.cat} onChange={(e) => setFixed(f.id, { cat: e.target.value })} style={{ ...sans, fontSize: 12, padding: "9px 8px", border: `1px solid ${P.hairline}`, borderRadius: 10, background: P.surface, color: P.inkSoft, cursor: "pointer", maxWidth: 92 }}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          <input inputMode="decimal" value={f.amount} onChange={(e) => setFixed(f.id, { amount: Math.max(0, parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0) })} style={inp(82)} />
          <button onClick={() => delFixed(f.id)} aria-label="Remove" style={{ background: "none", border: "none", color: P.inkFaint, fontSize: 16, cursor: "pointer", padding: 2 }}>×</button>
        </div>
      ))}
      <button onClick={logFixed} style={{ ...sans, fontSize: 12.5, fontWeight: 500, color: P.accent, background: P.accentSoft, border: "none", borderRadius: 10, padding: "10px 14px", cursor: "pointer", marginTop: 4 }}>Log fixed for this month</button>
      {logged != null && <span style={{ ...sans, fontSize: 12, color: P.inkSoft, marginLeft: 10 }}>{logged > 0 ? `Added ${logged}.` : "Already logged."}</span>}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "26px 0 6px" }}>
        <div style={eyebrow}>Category budgets</div>
        <button onClick={() => patchSpace({ overrides: {} })} style={{ ...sans, fontSize: 12, fontWeight: 500, color: P.inkSoft, background: "none", border: "none", cursor: "pointer" }}>Reset to auto</button>
      </div>
      <div style={{ ...sans, fontSize: 11.5, color: P.inkFaint, marginBottom: 12, lineHeight: 1.5 }}>Suggested from income and fixed costs. Edit any and it sticks; the rest stay automatic.</div>
      {CATEGORIES.map((c) => {
        const edited = view.overrides[c.id] != null;
        return (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: `1px solid ${P.hairline}` }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color }} />
            <span style={{ ...sans, fontSize: 13.5, fontWeight: 500, flex: 1 }}>{c.label}</span>
            <span style={{ ...sans, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: edited ? P.warn : P.inkFaint, minWidth: 40, textAlign: "right" }}>{edited ? "edited" : "auto"}</span>
            {edited && <button onClick={() => resetBudget(c.id)} aria-label="Reset" style={{ background: "none", border: "none", color: P.inkFaint, fontSize: 13, cursor: "pointer" }}>↺</button>}
            <input inputMode="decimal" value={budgets[c.id]} onChange={(e) => setBudget(c.id, e.target.value.replace(/[^0-9.]/g, ""))} style={inp(90)} />
          </div>
        );
      })}
      <div style={{ display: "flex", justifyContent: "space-between", ...sans, fontSize: 12.5, marginTop: 14, marginBottom: 8, color: Math.abs(leftover) < 1 ? P.accent : leftover < 0 ? P.over : P.inkSoft, fontVariantNumeric: "tabular-nums" }}>
        <span>Allocated {fmt(totalBudget)} of {fmt(plan.allocatable)}</span>
        <span>{Math.abs(leftover) < 1 ? "fully allocated" : leftover < 0 ? `${fmt(-leftover)} over` : `${fmt(leftover)} unallocated`}</span>
      </div>
    </div>
  );
}

// ── shared bits ──────────────────────────────────────────────────
function SpacePill({ label, sub, active, onClick, S }) {
  const { sans } = S;
  return (
    <button onClick={onClick} style={{ ...sans, flex: "0 0 auto", fontSize: 13, fontWeight: 600, padding: "8px 15px", borderRadius: 999, border: "none", cursor: "pointer", background: active ? P.accent : P.accentSoft, color: active ? "#fff" : P.accent, display: "flex", alignItems: "center", gap: 6 }}>
      {label}{sub && <span style={{ fontSize: 9, fontWeight: 600, opacity: 0.8, textTransform: "uppercase", letterSpacing: "0.06em" }}>{sub}</span>}
    </button>
  );
}
function PeriodToggle({ period, setPeriod, S }) {
  const { sans } = S;
  return (
    <div style={{ display: "inline-flex", background: P.surface, border: `1px solid ${P.hairline}`, borderRadius: 999, padding: 3, marginBottom: 18 }}>
      {[["mtd", "This month"], ["ytd", "Year to date"]].map(([k, lbl]) => (
        <button key={k} onClick={() => setPeriod(k)} style={{ ...sans, fontSize: 12.5, fontWeight: 500, padding: "7px 16px", borderRadius: 999, border: "none", cursor: "pointer", background: period === k ? P.ink : "transparent", color: period === k ? "#fff" : P.inkSoft, transition: "all .2s" }}>{lbl}</button>
      ))}
    </div>
  );
}
function MembersRow({ space, onInvite, S }) {
  const { sans } = S;
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const send = async () => { if (!email.trim()) return; try { await onInvite(space.id, email.trim()); setSent(true); setEmail(""); } catch { setSent(false); } };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
      <div style={{ display: "flex" }}>
        {space.members.slice(0, 4).map((mem, i) => (
          <div key={i} title={mem} style={{ ...sans, width: 26, height: 26, borderRadius: 999, background: [P.accent, "#6E8E5F", "#4A6C7A", "#9C6B4E"][i % 4], color: "#fff", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", marginLeft: i ? -7 : 0, border: `2px solid ${P.paper}` }}>{(mem[0] || "?").toUpperCase()}</div>
        ))}
      </div>
      <span style={{ ...sans, fontSize: 12, color: P.inkSoft }}>{space.members.join(", ")}</span>
      <button onClick={() => { setOpen((v) => !v); setSent(false); }} style={{ ...sans, fontSize: 11.5, fontWeight: 600, color: P.accent, background: "none", border: `1px solid ${P.hairline}`, borderRadius: 999, padding: "4px 10px", cursor: "pointer" }}>+ Invite</button>
      {open && (
        <div style={{ width: "100%", display: "flex", gap: 8, marginTop: 6 }}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="their email"
            style={{ ...sans, flex: 1, fontSize: 13, padding: "9px 11px", border: `1px solid ${P.hairline}`, borderRadius: 10, background: P.surface, color: P.ink, boxSizing: "border-box" }} />
          <button onClick={send} style={{ ...sans, fontSize: 13, fontWeight: 600, color: "#fff", background: P.accent, border: "none", borderRadius: 10, padding: "9px 16px", cursor: "pointer" }}>Send</button>
        </div>
      )}
      {open && sent && <span style={{ ...sans, fontSize: 11, color: P.accent, width: "100%" }}>Invite sent. They join by signing in with that email.</span>}
    </div>
  );
}
function Stat({ label, value, note, noteColor, S }) {
  const { serif, sans, eyebrow, tnum } = S;
  return (
    <div style={{ flex: 1, background: P.surface, border: `1px solid ${P.hairline}`, borderRadius: 18, padding: "16px 16px" }}>
      <div style={eyebrow}>{label}</div>
      <div style={{ ...serif, ...tnum, fontSize: 26, fontWeight: 500, margin: "6px 0 2px" }}>{value}</div>
      <div style={{ ...sans, fontSize: 11, color: noteColor || P.inkFaint }}>{note}</div>
    </div>
  );
}
function Donut({ data, total, selected, onSelect, S }) {
  const { serif, sans, fmt } = S;
  const size = 200, sw = 20, r = (size - sw) / 2, C = 2 * Math.PI * r, gap = data.length > 1 ? 2.2 : 0;
  let off = 0;
  const segs = data.map((d) => { const frac = total ? d.spent / total : 0; const s = { ...d, len: Math.max(0, frac * C - gap), dash: off }; off += frac * C; return s; });
  const focus = selected ? data.find((d) => d.id === selected) : null;
  const fShare = focus && total ? Math.round((focus.spent / total) * 100) : null;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={P.hairline} strokeWidth={sw} />
        {segs.map((s) => <circle key={s.id} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={selected === s.id ? sw + 4 : sw} strokeLinecap="round" strokeDasharray={`${s.len} ${C - s.len}`} strokeDashoffset={-s.dash} opacity={selected && selected !== s.id ? 0.28 : 1} style={{ cursor: "pointer", transition: "opacity .2s, stroke-width .2s" }} onClick={() => onSelect(s.id)} />)}
      </g>
      <text x="50%" y={fShare != null ? "40%" : "45%"} textAnchor="middle" style={{ ...sans, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", fill: P.inkFaint }}>{focus ? focus.label : "Total"}</text>
      <text x="50%" y={fShare != null ? "53%" : "57%"} textAnchor="middle" style={{ ...serif, fontSize: 22, fontWeight: 500, fill: P.ink, fontVariantNumeric: "tabular-nums" }}>{fmt(focus ? focus.spent : total)}</text>
      {fShare != null && <text x="50%" y="65%" textAnchor="middle" style={{ ...sans, fontSize: 12, fontWeight: 600, fill: focus.color }}>{fShare}% of spend</text>}
    </svg>
  );
}

// ── sheets ───────────────────────────────────────────────────────
function AddSheet({ onClose, onAdd, space, S }) {
  const { serif, sans, eyebrow, cur } = S;
  const [amount, setAmount] = useState(""); const [cat, setCat] = useState("food");
  const [note, setNote] = useState(""); const [date, setDate] = useState(iso(new Date()));
  const [paidBy, setPaidBy] = useState(space.members?.[0] || "You");
  const valid = parseFloat(amount) > 0;
  const submit = () => { if (valid) onAdd({ amount: parseFloat(amount), cat, note: note.trim(), date, ...(space.type === "roommates" ? { paidBy } : {}) }); };
  const inp = { ...sans, fontSize: 14, width: "100%", boxSizing: "border-box", padding: "10px 12px", border: `1px solid ${P.hairline}`, borderRadius: 12, background: P.surface, color: P.ink };
  return (
    <Sheet onClose={onClose} S={S}>
      <div style={eyebrow}>New expense · {space.name}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, margin: "14px 0 4px" }}>
        <span style={{ ...serif, fontSize: 34, color: P.inkSoft }}>{cur}</span>
        <input autoFocus inputMode="decimal" value={amount} placeholder="0" onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} onKeyDown={(e) => e.key === "Enter" && submit()} style={{ ...serif, fontSize: 44, fontWeight: 500, border: "none", background: "none", width: "100%", color: P.ink, padding: 0 }} />
      </div>
      <div style={{ borderBottom: `1px solid ${P.hairline}`, marginBottom: 20 }} />
      <div style={{ ...eyebrow, marginBottom: 10 }}>Category</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
        {CATEGORIES.map((c) => <button key={c.id} onClick={() => setCat(c.id)} style={{ ...sans, fontSize: 12.5, fontWeight: 500, padding: "8px 13px", borderRadius: 999, cursor: "pointer", border: `1px solid ${cat === c.id ? c.color : P.hairline}`, background: cat === c.id ? c.color : "transparent", color: cat === c.id ? "#fff" : P.inkSoft, transition: "all .15s" }}>{c.label}</button>)}
      </div>
      {space.type === "roommates" && (
        <>
          <div style={{ ...eyebrow, marginBottom: 10 }}>Paid by</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
            {space.members.map((mem) => <button key={mem} onClick={() => setPaidBy(mem)} style={{ ...sans, fontSize: 12.5, fontWeight: 500, padding: "8px 13px", borderRadius: 999, cursor: "pointer", border: `1px solid ${paidBy === mem ? P.accent : P.hairline}`, background: paidBy === mem ? P.accentSoft : "transparent", color: paidBy === mem ? P.accent : P.inkSoft }}>{mem}</button>)}
          </div>
        </>
      )}
      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        <div style={{ flex: 1 }}><div style={{ ...eyebrow, marginBottom: 8 }}>Note</div><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" style={inp} /></div>
        <div style={{ width: 150 }}><div style={{ ...eyebrow, marginBottom: 8 }}>Date</div><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inp} /></div>
      </div>
      <button onClick={submit} disabled={!valid} style={{ ...sans, width: "100%", padding: 15, borderRadius: 14, border: "none", fontSize: 15, fontWeight: 600, cursor: valid ? "pointer" : "not-allowed", background: valid ? P.accent : P.hairline, color: valid ? "#fff" : P.inkFaint, transition: "all .2s" }}>Add expense</button>
    </Sheet>
  );
}

function CreateSpaceSheet({ onClose, onCreate, S }) {
  const { serif, sans, eyebrow } = S;
  const [name, setName] = useState(""); const [type, setType] = useState("family");
  const types = [
    { id: "family", title: "Family", desc: "One shared pool. Everyone adds to the same ledger and you track total spending against a shared budget. No debts." },
    { id: "roommates", title: "Roommates", desc: "Track who paid each expense and settle up, Splitwise-style. Per-person balances. Full splitting activates once members join in the synced version." },
  ];
  return (
    <Sheet onClose={onClose} S={S}>
      <div style={eyebrow}>New space</div>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name it (e.g. Roommates, Trip)" style={{ ...serif, fontSize: 26, fontWeight: 500, border: "none", borderBottom: `1px solid ${P.hairline}`, background: "none", width: "100%", color: P.ink, padding: "12px 0", margin: "10px 0 22px", boxSizing: "border-box" }} />
      <div style={{ ...eyebrow, marginBottom: 10 }}>How is money shared?</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
        {types.map((t) => (
          <button key={t.id} onClick={() => setType(t.id)} style={{ textAlign: "left", cursor: "pointer", padding: "15px 16px", borderRadius: 16, border: `1.5px solid ${type === t.id ? P.accent : P.hairline}`, background: type === t.id ? P.accentSoft : P.surface }}>
            <div style={{ ...sans, fontSize: 14.5, fontWeight: 600, color: type === t.id ? P.accent : P.ink, marginBottom: 4 }}>{t.title}</div>
            <div style={{ ...sans, fontSize: 12, color: P.inkSoft, lineHeight: 1.5 }}>{t.desc}</div>
          </button>
        ))}
      </div>
      <button onClick={() => name.trim() && onCreate(name.trim(), type)} disabled={!name.trim()} style={{ ...sans, width: "100%", padding: 15, borderRadius: 14, border: "none", fontSize: 15, fontWeight: 600, cursor: name.trim() ? "pointer" : "not-allowed", background: name.trim() ? P.accent : P.hairline, color: name.trim() ? "#fff" : P.inkFaint }}>Create space</button>
    </Sheet>
  );
}

function SettingsSheet({ cur, setCur, space, isAll, onDelete, onSignOut, onClose, S }) {
  const { sans, eyebrow } = S;
  const [confirm, setConfirm] = useState(false);
  return (
    <Sheet onClose={onClose} S={S}>
      <div style={eyebrow}>Settings</div>
      <div style={{ ...sans, fontSize: 13, fontWeight: 500, margin: "18px 0 10px" }}>Currency</div>
      <div style={{ display: "flex", gap: 8 }}>
        {Object.keys(CURRENCIES).map((k) => <button key={k} onClick={() => setCur(k)} style={{ ...sans, fontSize: 15, fontWeight: 600, padding: "12px 22px", borderRadius: 12, cursor: "pointer", border: `1px solid ${cur === k ? P.accent : P.hairline}`, background: cur === k ? P.accentSoft : "transparent", color: cur === k ? P.accent : P.inkSoft }}>{k} {CURRENCIES[k].code}</button>)}
      </div>

      {!isAll && space && (
        <>
          <div style={{ ...sans, fontSize: 13, fontWeight: 500, margin: "26px 0 10px" }}>Space · {space.name}</div>
          {!confirm ? (
            <button onClick={() => setConfirm(true)} style={{ ...sans, fontSize: 13.5, color: P.over, background: "none", border: `1px solid ${P.hairline}`, borderRadius: 12, padding: "12px 18px", cursor: "pointer" }}>Delete / leave this space</button>
          ) : (
            <div>
              <div style={{ ...sans, fontSize: 12.5, color: P.inkSoft, marginBottom: 10, lineHeight: 1.5 }}>If you own it, this deletes the space and its data for everyone. If you were invited, it just removes you.</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={onDelete} style={{ ...sans, fontSize: 13.5, color: "#fff", background: P.over, border: "none", borderRadius: 12, padding: "12px 18px", cursor: "pointer", fontWeight: 600 }}>Yes, remove</button>
                <button onClick={() => setConfirm(false)} style={{ ...sans, fontSize: 13.5, color: P.inkSoft, background: "none", border: `1px solid ${P.hairline}`, borderRadius: 12, padding: "12px 18px", cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}

      <div style={{ ...sans, fontSize: 13, fontWeight: 500, margin: "26px 0 10px" }}>Account</div>
      <button onClick={onSignOut} style={{ ...sans, fontSize: 13.5, color: P.ink, background: "none", border: `1px solid ${P.hairline}`, borderRadius: 12, padding: "12px 18px", cursor: "pointer" }}>Sign out</button>
      <div style={{ ...sans, fontSize: 11.5, color: P.inkFaint, marginTop: 24, lineHeight: 1.5 }}>Your spaces sync across every phone signed in to them. Invite family or friends to a space from its Home tab.</div>
    </Sheet>
  );
}

// ── statement import (CSV + Excel, Paytm-aware) ──────────────────
const CAT_RULES = [
  ["food", ["swiggy", "zomato", "restaurant", "cafe", "coffee", "starbucks", "mcdonald", "domino", "kfc", "eatery", "dining", "pizza", "bakery", "chai", "biryani", "food", "hotel", "dhaba"]],
  ["grocery", ["bigbasket", "grocery", "dmart", "d-mart", "reliance fresh", "more retail", "spencer", "grofers", "blinkit", "zepto", "instamart", "supermarket", "kirana", "vegetable", "fruit", "milk", "dairy", "mart"]],
  ["transport", ["uber", "ola", "rapido", "fuel", "petrol", "diesel", "irctc", "metro", "fastag", "parking", "cab ", "auto ", "indian oil", "hp petrol", "bharat petroleum", "shell", "railway", "flight", "indigo", "airlines", "redbus"]],
  ["bills", ["rent", "electricity", "water bill", "gas bill", "broadband", "airtel", "jio", "vodafone", "vi ", "act fibernet", "tata power", "bescom", "bill payment", "recharge", "dth", "insurance", "emi", "loan", "premium", "maintenance"]],
  ["shopping", ["amazon", "flipkart", "myntra", "ajio", "meesho", "nykaa", "mall", "lifestyle", "shoppers stop", "decathlon", "ikea", "croma", "reliance digital", "store"]],
  ["fun", ["netflix", "spotify", "prime video", "hotstar", "disney", "bookmyshow", "pvr", "inox", "cinema", "gaming", "youtube premium", "subscription", "steam"]],
  ["health", ["pharmacy", "apollo", "medplus", "hospital", "clinic", "medical", "1mg", "pharmeasy", "diagnostic", "pathology", "lab ", "dentist", "gym", "fitness"]],
];
function guessCat(desc) {
  const d = (desc || "").toLowerCase();
  for (const [cat, kws] of CAT_RULES) if (kws.some((k) => d.includes(k))) return cat;
  return "other";
}
function parseAmt(v) { if (v == null) return 0; const n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; }
function parseDateStr(v) {
  if (!v) return iso(new Date());
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) { let c = m[3]; if (c.length === 2) c = "20" + c; const d = new Date(+c, +m[2] - 1, +m[1]); if (!isNaN(d.getTime())) return iso(d); }
  const d = new Date(s); return isNaN(d.getTime()) ? iso(new Date()) : iso(d);
}
// a row of cells is the header if it has a date column and a details/amount column
function looksLikeHeader(cells) {
  const t = cells.map((c) => String(c || "").toLowerCase());
  const hasDate = t.some((c) => /date/.test(c));
  const hasInfo = t.some((c) => /transaction details|narration|description|amount|particular/.test(c));
  return hasDate && hasInfo;
}
// turn an array-of-arrays (with possible metadata rows on top) into {fields, rows}
function rowsFromAoA(aoa) {
  const hi = aoa.findIndex(looksLikeHeader);
  if (hi === -1) return null;
  const fields = aoa[hi].map((c) => String(c || "").trim());
  const rows = [];
  for (let i = hi + 1; i < aoa.length; i++) {
    const cells = aoa[i]; if (!cells || cells.every((c) => c === "" || c == null)) continue;
    const o = {}; fields.forEach((f, j) => { if (f) o[f] = cells[j]; }); rows.push(o);
  }
  return { fields, rows };
}
// parse an Excel workbook, picking the sheet that holds the transaction table
function parseWorkbook(data) {
  const wb = XLSX.read(data, { type: "array" });
  const names = wb.SheetNames.slice().sort((a, b) =>
    (/passbook|transaction|history|upi|statement/i.test(b) ? 1 : 0) - (/passbook|transaction|history|upi|statement/i.test(a) ? 1 : 0));
  for (const name of names) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, raw: false });
    const parsed = rowsFromAoA(aoa);
    if (parsed && parsed.rows.length) return parsed;
  }
  return null;
}
function detectCols(fields, sample) {
  const find = (re) => fields.find((f) => re.test(f));
  let descCol = find(/^transaction details$/i) || find(/desc|narration|particular|detail|remark|transaction|merchant|name|payee/i);
  if (!descCol) { let best = fields[0], len = 0; fields.forEach((f) => { const l = String(sample[f] || "").length; if (l > len) { len = l; best = f; } }); descCol = best; }
  return {
    dateCol: find(/date/i) || fields[0],
    descCol,
    descCol2: find(/other transaction details|upi id|remark/i),
    debitCol: find(/debit|withdrawal|paid out|money out|\bdr\b/i),
    creditCol: find(/credit|deposit|money in|\bcr\b/i),
    amountCol: find(/amount|amt|value/i),
  };
}
function buildRows(rows, cols) {
  return rows.map((r) => {
    const d1 = String(r[cols.descCol] || "").trim();
    const d2 = cols.descCol2 ? String(r[cols.descCol2] || "").trim() : "";
    const note = (d1 || d2 || "Imported").slice(0, 60);
    const hay = (d1 + " " + d2).toLowerCase();
    let amount = 0, isCredit = false;
    if (cols.debitCol && parseAmt(r[cols.debitCol]) > 0) {
      amount = parseAmt(r[cols.debitCol]);
    } else if (cols.debitCol && cols.creditCol) {
      isCredit = parseAmt(r[cols.creditCol]) > 0; amount = 0;
    } else if (cols.amountCol) {
      const raw = String(r[cols.amountCol] || "");
      const val = Math.abs(parseAmt(raw));
      const signPos = /^\s*\+/.test(raw), signNeg = /^\s*-/.test(raw);
      const textCredit = /received|added|refund|cashback|credited|money received/i.test(hay);
      const textDebit = /paid|sent|debited|purchase|payment/i.test(hay);
      isCredit = signPos || (textCredit && !textDebit && !signNeg);
      amount = val;
    }
    return { date: parseDateStr(r[cols.dateCol]), note, amount, cat: guessCat(hay), include: !isCredit && amount > 0, isCredit };
  }).filter((x) => !x.isCredit && x.amount > 0);   // keep spends (Money Paid) only
}

function ImportSheet({ onClose, onImport, space, S }) {
  const { serif, sans, eyebrow, tnum, fmt } = S;
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [err, setErr] = useState("");

  const onFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setFileName(file.name); setErr(""); setRows(null);
    const finish = (fields, data) => {
      try {
        if (!fields.length) return setErr("Couldn't read the columns. Make sure it's the Paytm statement export.");
        const cols = detectCols(fields, data[0] || {});
        if (!cols.dateCol || (!cols.debitCol && !cols.amountCol)) return setErr("Couldn't find date and amount columns in this file.");
        const built = buildRows(data, cols);
        if (!built.length) return setErr("No spending rows found. (Money Received / credits are skipped.)");
        setRows(built.slice(0, 500));
      } catch { setErr("Something went wrong reading that file."); }
    };
    const isExcel = /\.x(lsx|ls)$/i.test(file.name);
    if (isExcel) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = parseWorkbook(new Uint8Array(reader.result));
          if (!parsed) return setErr("Couldn't find the transaction table in this Excel file.");
          finish(parsed.fields, parsed.rows);
        } catch { setErr("Couldn't read that Excel file."); }
      };
      reader.onerror = () => setErr("Couldn't read that file.");
      reader.readAsArrayBuffer(file);
    } else {
      Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: (res) => finish((res.meta && res.meta.fields) || [], res.data),
        error: () => setErr("Couldn't parse that file."),
      });
    }
  };
  const toggle = (i) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, include: !r.include } : r)));
  const setCat = (i, cat) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, cat } : r)));
  const selected = rows ? rows.filter((r) => r.include) : [];
  const sum = selected.reduce((a, r) => a + r.amount, 0);

  return (
    <Sheet onClose={onClose} S={S}>
      <div style={eyebrow}>Import statement · {space.name}</div>

      {!rows && (
        <>
          <label style={{ display: "block", marginTop: 16, marginBottom: 14, border: `1.5px dashed ${P.hairline}`, borderRadius: 16, padding: "30px 20px", textAlign: "center", cursor: "pointer", background: P.surface }}>
            <input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={onFile} style={{ display: "none" }} />
            <div style={{ ...serif, fontSize: 20, fontWeight: 500, color: P.ink, marginBottom: 6 }}>Choose your Paytm statement</div>
            <div style={{ ...sans, fontSize: 12.5, color: P.inkSoft, lineHeight: 1.5 }}>Paytm app → Balance &amp; History → Statement → Excel. Pick the .xlsx here (CSV also works).<br />{fileName && <span style={{ color: P.accent }}>{fileName}</span>}</div>
          </label>
          {err && <div style={{ ...sans, fontSize: 12.5, color: P.over, marginBottom: 14, lineHeight: 1.5 }}>{err}</div>}
          <div style={{ ...sans, fontSize: 11.5, color: P.inkFaint, lineHeight: 1.6 }}>
            Works with the usual columns: a <b>date</b>, a <b>description / narration</b>, and a <b>debit / amount</b>. Categories are guessed from the description and you can fix any before importing. The file is read on your device and never uploaded anywhere.
          </div>
        </>
      )}

      {rows && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "14px 0 12px" }}>
            <div style={{ ...sans, fontSize: 12.5, color: P.inkSoft }}>{selected.length} of {rows.length} selected · <span style={{ ...tnum, color: P.ink, fontWeight: 600 }}>{fmt(sum)}</span></div>
            <button onClick={() => { setRows(null); setFileName(""); }} style={{ ...sans, fontSize: 12, color: P.inkSoft, background: "none", border: "none", cursor: "pointer" }}>Choose another</button>
          </div>
          <div style={{ maxHeight: "44vh", overflowY: "auto", border: `1px solid ${P.hairline}`, borderRadius: 14 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", borderTop: i ? `1px solid ${P.hairline}` : "none", opacity: r.include ? 1 : 0.4 }}>
                <button onClick={() => toggle(i)} aria-label="Toggle" style={{ width: 18, height: 18, flex: "0 0 auto", borderRadius: 5, border: `1.5px solid ${r.include ? P.accent : P.inkFaint}`, background: r.include ? P.accent : "transparent", color: "#fff", fontSize: 11, cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>{r.include ? "✓" : ""}</button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...sans, fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.note}</div>
                  <div style={{ ...sans, fontSize: 10.5, color: P.inkFaint }}>{new Date(r.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
                </div>
                <select value={r.cat} onChange={(e) => setCat(i, e.target.value)} style={{ ...sans, fontSize: 11, padding: "5px 6px", border: `1px solid ${P.hairline}`, borderRadius: 8, background: P.surface, color: P.inkSoft, cursor: "pointer", maxWidth: 92 }}>
                  {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <span style={{ ...sans, ...tnum, fontSize: 12.5, fontWeight: 500, minWidth: 62, textAlign: "right" }}>{fmt(r.amount)}</span>
              </div>
            ))}
          </div>
          <button onClick={() => onImport(selected.map(({ include, ...r }) => r))} disabled={!selected.length} style={{ ...sans, width: "100%", marginTop: 18, padding: 15, borderRadius: 14, border: "none", fontSize: 15, fontWeight: 600, cursor: selected.length ? "pointer" : "not-allowed", background: selected.length ? P.accent : P.hairline, color: selected.length ? "#fff" : P.inkFaint }}>
            Import {selected.length} {selected.length === 1 ? "expense" : "expenses"}
          </button>
        </>
      )}
    </Sheet>
  );
}

// ── First-space / invite-to-join screen (shown when you have no spaces) ──
function FirstSpace({ invites, onApprove, onDecline, onCreate, S }) {
  const { serif, sans, eyebrow } = S;
  const [name, setName] = useState("");
  const [type, setType] = useState("family");
  const types = [
    { id: "family", title: "Family", desc: "One shared pool. Everyone adds to the same ledger, no debts." },
    { id: "roommates", title: "Roommates", desc: "Track who paid and settle up, Splitwise-style." },
  ];
  return (
    <div style={{ ...sans, background: P.paper, minHeight: 700, display: "flex", justifyContent: "center", color: P.ink, padding: "40px 18px" }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ ...serif, fontSize: 28, fontWeight: 500, marginBottom: 4 }}>Quiet Ledger</div>

        {invites && invites.length > 0 && (
          <div style={{ margin: "22px 0 30px" }}>
            <div style={{ ...eyebrow, marginBottom: 12 }}>You're invited</div>
            {invites.map((i) => (
              <div key={i.id} style={{ background: P.accentSoft, border: `1px solid ${P.hairline}`, borderRadius: 16, padding: 16, marginBottom: 10 }}>
                <div style={{ ...sans, fontSize: 14.5, fontWeight: 600, color: P.ink }}>Join <b>{i.space_name}</b></div>
                <div style={{ ...sans, fontSize: 12, color: P.inkSoft, margin: "4px 0 14px" }}>You've been invited as {i.role}.</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => onApprove(i.id)} style={{ ...sans, flex: 1, fontSize: 13.5, fontWeight: 600, color: "#fff", background: P.accent, border: "none", borderRadius: 12, padding: "11px 0", cursor: "pointer" }}>Join</button>
                  <button onClick={() => onDecline(i.id)} style={{ ...sans, fontSize: 13.5, color: P.inkSoft, background: "none", border: `1px solid ${P.hairline}`, borderRadius: 12, padding: "11px 18px", cursor: "pointer" }}>Decline</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ ...eyebrow, margin: "22px 0 6px" }}>{invites && invites.length ? "Or create your own" : "Create your first space"}</div>
        <div style={{ ...sans, fontSize: 13, color: P.inkSoft, marginBottom: 16, lineHeight: 1.5 }}>A space is a shared pot with its own budget and members — like a household, or just you.</div>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name it (e.g. Household)" style={{ ...serif, fontSize: 22, fontWeight: 500, border: "none", borderBottom: `1px solid ${P.hairline}`, background: "none", width: "100%", color: P.ink, padding: "10px 0", margin: "0 0 20px", boxSizing: "border-box" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
          {types.map((t) => (
            <button key={t.id} onClick={() => setType(t.id)} style={{ textAlign: "left", cursor: "pointer", padding: "14px 15px", borderRadius: 16, border: `1.5px solid ${type === t.id ? P.accent : P.hairline}`, background: type === t.id ? P.accentSoft : P.surface }}>
              <div style={{ ...sans, fontSize: 14, fontWeight: 600, color: type === t.id ? P.accent : P.ink }}>{t.title}</div>
              <div style={{ ...sans, fontSize: 12, color: P.inkSoft, marginTop: 3, lineHeight: 1.5 }}>{t.desc}</div>
            </button>
          ))}
        </div>
        <button onClick={() => name.trim() && onCreate(name.trim(), type)} disabled={!name.trim()} style={{ ...sans, width: "100%", padding: 15, borderRadius: 14, border: "none", fontSize: 15, fontWeight: 600, cursor: name.trim() ? "pointer" : "not-allowed", background: name.trim() ? P.accent : P.hairline, color: name.trim() ? "#fff" : P.inkFaint }}>Create space</button>
      </div>
    </div>
  );
}

// ── Invite banner (shown at top when you already have spaces) ──
function InviteBanner({ invites, onApprove, onDecline, S }) {
  const { sans } = S;
  return (
    <div style={{ padding: "12px 16px 0" }}>
      {invites.map((i) => (
        <div key={i.id} style={{ background: P.accentSoft, border: `1px solid ${P.accent}`, borderRadius: 14, padding: "12px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 140, ...sans, fontSize: 13, color: P.ink }}>Invited to <b>{i.space_name}</b></div>
          <button onClick={() => onApprove(i.id)} style={{ ...sans, fontSize: 12.5, fontWeight: 600, color: "#fff", background: P.accent, border: "none", borderRadius: 10, padding: "8px 16px", cursor: "pointer" }}>Join</button>
          <button onClick={() => onDecline(i.id)} style={{ ...sans, fontSize: 12.5, color: P.inkSoft, background: "none", border: `1px solid ${P.hairline}`, borderRadius: 10, padding: "8px 12px", cursor: "pointer" }}>Decline</button>
        </div>
      ))}
    </div>
  );
}

function Sheet({ children, onClose, S }) {
  const { sans } = S;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(28,27,25,0.32)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...sans, background: P.paper, width: "100%", maxWidth: 430, borderRadius: "26px 26px 0 0", padding: "14px 22px 30px", maxHeight: "88vh", overflowY: "auto", animation: "ql-up .28s ease" }}>
        <div style={{ width: 38, height: 4, background: P.hairline, borderRadius: 999, margin: "0 auto 18px" }} />
        {children}
      </div>
    </div>
  );
}

// ── icons ────────────────────────────────────────────────────────
const IconHome = ({ active }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /></svg>;
const IconChart = ({ active }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></svg>;
const IconTarget = ({ active }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.6" fill="currentColor" /></svg>;
