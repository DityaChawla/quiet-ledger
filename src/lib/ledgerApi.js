// Data layer. Swap the app's window.storage calls for these.
// Every call is scoped by RLS on the server, so you never pass a
// user id — the database knows who you are from the session.
import { supabase } from "./supabaseClient";

// ── auth ───────────────────────────────────────────────────────
export const signInWithEmail = (email) =>
  supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });

export const signInWithGoogle = () =>
  supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });

export const signOut = () => supabase.auth.signOut();
export const getSession = () => supabase.auth.getSession();
export const onAuth = (cb) => supabase.auth.onAuthStateChange((_e, s) => cb(s));

// ── spaces ─────────────────────────────────────────────────────
export async function getSpaces() {
  const { data, error } = await supabase.from("spaces").select("*").order("created_at");
  if (error) throw error;
  return data;
}
export async function createSpace(name, type) {
  const { data, error } = await supabase.from("spaces").insert({ name, type }).select().single();
  if (error) throw error;                 // trigger auto-adds you as owner
  return data;
}
export async function updatePlan(spaceId, { income, savings_pct }) {
  const { error } = await supabase.from("spaces").update({ income, savings_pct }).eq("id", spaceId);
  if (error) throw error;
}

// ── transactions ───────────────────────────────────────────────
export async function getTransactions(spaceId) {
  const { data, error } = await supabase.from("transactions")
    .select("*").eq("space_id", spaceId).order("occurred_on", { ascending: false });
  if (error) throw error;
  return data;
}
export async function addTransaction(spaceId, t) {
  const { data, error } = await supabase.from("transactions").insert({
    space_id: spaceId, amount: t.amount, category: t.cat, note: t.note,
    occurred_on: t.date, is_fixed: !!t.fixed, paid_by: t.paidBy ?? null,
  }).select().single();
  if (error) throw error;
  return data;
}
export async function importTransactions(spaceId, rows) {
  const payload = rows.map((r) => ({
    space_id: spaceId, amount: r.amount, category: r.cat, note: r.note,
    occurred_on: r.date, is_fixed: !!r.fixed,
  }));
  const { error } = await supabase.from("transactions").insert(payload);
  if (error) throw error;
}
export async function deleteTransaction(id) {
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) throw error;
}

// ── fixed expenses & budgets ───────────────────────────────────
export const getFixed = (spaceId) => supabase.from("space_fixed").select("*").eq("space_id", spaceId);
export const upsertFixed = (row) => supabase.from("space_fixed").upsert(row);
export const deleteFixed = (id) => supabase.from("space_fixed").delete().eq("id", id);

export const getBudgets = (spaceId) => supabase.from("space_budgets").select("*").eq("space_id", spaceId);
export const setBudget = (spaceId, category, amount) =>
  supabase.from("space_budgets").upsert({ space_id: spaceId, category, amount });
export const clearBudget = (spaceId, category) =>
  supabase.from("space_budgets").delete().eq("space_id", spaceId).eq("category", category);

// ── sharing ────────────────────────────────────────────────────
export async function inviteToSpace(spaceId, email, role = "member") {
  const { error } = await supabase.from("space_invites").insert({ space_id: spaceId, email, role });
  if (error) throw error;
}
export async function myPendingInvites() {
  const { data } = await supabase.from("space_invites").select("id, space_id, role").eq("accepted", false);
  return data ?? [];
}
export async function acceptInvite(inviteId) {
  const { data, error } = await supabase.rpc("accept_invite", { p_invite: inviteId });
  if (error) throw error;
  return data;                            // returns the space id
}
export async function getMembers(spaceId) {
  const { data } = await supabase.from("space_members")
    .select("role, profiles(display_name)").eq("space_id", spaceId);
  return data ?? [];
}

// ── live updates ───────────────────────────────────────────────
// Call this when a space is open; runs cb whenever anyone in the
// space adds/edits/deletes, so all phones stay in sync.
export function subscribeToSpace(spaceId, cb) {
  const ch = supabase.channel(`space:${spaceId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "transactions", filter: `space_id=eq.${spaceId}` }, cb)
    .subscribe();
  return () => supabase.removeChannel(ch);
}
