// Supabase client. Reads keys from env (Vite: import.meta.env.VITE_*).
// Only the PUBLIC anon key ever ships to the browser — RLS does the
// protecting, so this key being visible is expected and safe.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, anon);
