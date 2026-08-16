import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const supabase = createClient(url, anon);

// keep the realtime socket signed in as the current user
supabase.auth.getSession().then(({ data }) => {
  supabase.realtime.setAuth(data.session?.access_token ?? null);
});
supabase.auth.onAuthStateChange((_e, session) => {
  supabase.realtime.setAuth(session?.access_token ?? null);
});
