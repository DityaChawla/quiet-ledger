import { useEffect, useState, useRef, useCallback } from "react";
import {
  getSpaces, createSpace, updatePlan, leaveOrDeleteSpace,
  getTransactions, addTransaction, importTransactions, updateTransaction, deleteTransaction,
  getFixed, upsertFixed, deleteFixed,
  getBudgets, setBudget, clearBudget,
  getMembers, inviteToSpace,
  myInvites, approveInvite, declineInvite,
  subscribeToSpace,
} from "./lib/ledgerApi";

// Loads the user's spaces into the shape the UI expects, persists every
// change to Supabase, keeps things fresh, and manages pending invites.
// No auto-creation of spaces: a new user with none sees the create screen,
// an invited user sees a Join prompt.
export function useLedger() {
  const [ready, setReady] = useState(false);
  const [data, setData] = useState(null);
  const [invites, setInvites] = useState([]);
  const loadedOnce = useRef(false);   // React StrictMode double-invokes effects; run once
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

  const refreshInvites = useCallback(async () => {
    try { setInvites(await myInvites()); } catch { setInvites([]); }
  }, []);

  const loadAll = useCallback(async () => {
    const spaces = await getSpaces();               // no auto-create
    const built = await Promise.all(spaces.map(loadSpace));
    setData((d) => ({
      activeSpace: (d && d.activeSpace && built.some((b) => b.id === d.activeSpace)) ? d.activeSpace : (built[0] && built[0].id) || null,
      cur: curRef.current,
      spaces: built,
    }));
    await refreshInvites();
    setReady(true);
  }, [refreshInvites]);

  useEffect(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    loadAll();
  }, [loadAll]);

  const refetchSpace = useCallback(async (sid) => {
    const spaces = await getSpaces();
    const row = spaces.find((s) => s.id === sid);
    if (!row) return loadAll();
    const built = await loadSpace(row);
    setData((d) => (d ? { ...d, spaces: d.spaces.map((s) => (s.id === sid ? built : s)) } : d));
  }, [loadAll]);

  const activeSpace = data && data.activeSpace;

  // live sync while a space is open
  useEffect(() => {
    if (!activeSpace || activeSpace === "all") return;
    const unsub = subscribeToSpace(activeSpace, () => refetchSpace(activeSpace));
    return unsub;
  }, [activeSpace, refetchSpace]);

  // refetch open space + invites whenever the app/tab regains focus
  useEffect(() => {
    const onFocus = () => {
      if (activeSpace && activeSpace !== "all") refetchSpace(activeSpace);
      refreshInvites();
    };
    window.addEventListener("focus", onFocus);
    const onVis = () => { if (!document.hidden) onFocus(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVis); };
  }, [activeSpace, refetchSpace, refreshInvites]);

  // slow poll while the app is open, as a backstop for a dropped realtime socket
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return;
      if (activeSpace && activeSpace !== "all") refetchSpace(activeSpace);
      refreshInvites();
    }, 20000);
    return () => clearInterval(t);
  }, [activeSpace, refetchSpace, refreshInvites]);

  const actions = {
    setActive: (id) => setData((d) => ({ ...d, activeSpace: id })),
    setCur: (c) => { try { localStorage.setItem("ql-cur", c); } catch {} curRef.current = c; setData((d) => ({ ...d, cur: c })); },
    addTransaction: async (sid, e) => { await addTransaction(sid, e); await refetchSpace(sid); },
    importMany: async (sid, rows) => { await importTransactions(sid, rows); await refetchSpace(sid); },
    editTransaction: async (sid, id, patch) => { await updateTransaction(id, patch); await refetchSpace(sid); },
    removeTransaction: async (sid, id) => { await deleteTransaction(id); await refetchSpace(sid); },
    createSpaceAction: async (name, type) => { const s = await createSpace(name, type); await loadAll(); setData((d) => ({ ...d, activeSpace: s && s.id ? s.id : (d && d.activeSpace) })); },
    // loadAll re-points activeSpace at a surviving space (or null) on its own
    deleteSpace: async (sid) => { await leaveOrDeleteSpace(sid); await loadAll(); },
    invite: async (sid, email) => { await inviteToSpace(sid, email); },
    approveInvite: async (id) => { const sid = await approveInvite(id); await loadAll(); if (sid) setData((d) => ({ ...d, activeSpace: sid })); },
    declineInvite: async (id) => { await declineInvite(id); await refreshInvites(); },
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

  return { ready, data, setData, invites, actions };
}
