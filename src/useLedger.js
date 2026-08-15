import { useEffect, useState, useRef } from "react";
import {
  getSpaces, createSpace, updatePlan,
  getTransactions, addTransaction, importTransactions, deleteTransaction,
  getFixed, upsertFixed, deleteFixed,
  getBudgets, setBudget, clearBudget,
  getMembers, inviteToSpace, myPendingInvites, acceptInvite,
  subscribeToSpace,
} from "./lib/ledgerApi";

// Loads all of the user's spaces into the exact shape the UI expects,
// then persists every change to Supabase and refetches so all phones
// stay in sync. This is the only file that knows about the database.
export function useLedger() {
  const [ready, setReady] = useState(false);
  const [data, setData] = useState(null);
  const curRef = useRef((typeof localStorage !== "undefined" && localStorage.getItem("ql-cur")) || "\u20B9");

  const loadSpace = async (row) => {
    const [tx, fx, bg, mem] = await Promise.all([
      getTransactions(row.id), getFixed(row.id), getBudgets(row.id), getMembers(row.id),
    ]);
    return {
      id: row.id, name: row.name, type: row.type,
      income: Number(row.income) || 0, savingsPct: Number(row.savings_pct) || 0,
      members: (mem || []).map((m) => (m.profiles && m.profiles.display_name) || "Member"),
      fixed: ((fx && fx.data) || []).map((f) => ({ id: f.id, name: f.name, amount: Number(f.amount), cat: f.category })),
      overrides: Object.fromEntries(((bg && bg.data) || []).map((b) => [b.category, Number(b.amount)])),
      expenses: (tx || []).map((t) => ({ id: t.id, date: t.occurred_on, cat: t.category, amount: Number(t.amount), note: t.note, fixed: t.is_fixed })),
    };
  };

  const loadAll = async () => {
    // accept any pending invites first so shared spaces show up
    try { const inv = await myPendingInvites(); for (const i of inv) await acceptInvite(i.id); } catch {}
    let spaces = await getSpaces();
    if (!spaces.length) {                       // first sign-in: create starters
      await createSpace("Household", "family");
      await createSpace("Personal", "family");
      spaces = await getSpaces();
    }
    const built = await Promise.all(spaces.map(loadSpace));
    setData((d) => ({ activeSpace: (d && d.activeSpace) || built[0].id, cur: curRef.current, spaces: built }));
    setReady(true);
  };

  useEffect(() => { loadAll(); }, []);

  const refetchSpace = async (sid) => {
    const spaces = await getSpaces();
    const row = spaces.find((s) => s.id === sid);
    if (!row) return loadAll();
    const built = await loadSpace(row);
    setData((d) => (d ? { ...d, spaces: d.spaces.map((s) => (s.id === sid ? built : s)) } : d));
  };

  // live updates: when the open space changes anywhere, refetch it
  const activeSpace = data && data.activeSpace;
  useEffect(() => {
    if (!activeSpace || activeSpace === "all") return;
    const unsub = subscribeToSpace(activeSpace, () => refetchSpace(activeSpace));
    return unsub;
  }, [activeSpace]);

  const actions = {
    setActive: (id) => setData((d) => ({ ...d, activeSpace: id })),
    setCur: (c) => { try { localStorage.setItem("ql-cur", c); } catch {} curRef.current = c; setData((d) => ({ ...d, cur: c })); },
    addTransaction: async (sid, e) => { await addTransaction(sid, e); await refetchSpace(sid); },
    importMany: async (sid, rows) => { await importTransactions(sid, rows); await refetchSpace(sid); },
    removeTransaction: async (sid, id) => { await deleteTransaction(id); await refetchSpace(sid); },
    createSpaceAction: async (name, type) => { const s = await createSpace(name, type); await loadAll(); setData((d) => ({ ...d, activeSpace: s.id })); },
    invite: async (sid, email) => { await inviteToSpace(sid, email); },
    persistPatch: async (sid, patch, prev) => {
      if ("income" in patch || "savingsPct" in patch)
        await updatePlan(sid, { income: patch.income != null ? patch.income : prev.income, savings_pct: patch.savingsPct != null ? patch.savingsPct : prev.savingsPct });
      if ("overrides" in patch) {
        const nv = patch.overrides, ov = prev.overrides;
        for (const cat of Object.keys(nv)) if (nv[cat] !== ov[cat]) await setBudget(sid, cat, nv[cat]);
        for (const cat of Object.keys(ov)) if (!(cat in nv)) await clearBudget(sid, cat);
        await refetchSpace(sid);
      }
      if ("fixed" in patch) {
        const nf = patch.fixed, of = prev.fixed, byId = Object.fromEntries(of.map((f) => [f.id, f]));
        for (const f of nf) { const p = byId[f.id]; if (!p || p.name !== f.name || p.amount !== f.amount || p.cat !== f.cat) await upsertFixed({ id: f.id, space_id: sid, name: f.name, amount: f.amount, category: f.cat }); }
        const ids = new Set(nf.map((f) => f.id)); for (const f of of) if (!ids.has(f.id)) await deleteFixed(f.id);
        await refetchSpace(sid);
      }
    },
  };

  return { ready, data, setData, actions };
}
