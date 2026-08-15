// Wrap the whole app in <AuthGate>. It shows a sign-in screen until
// there's a session, then renders your app. Magic link = no passwords,
// easiest for parents.
import React, { useEffect, useState } from "react";
import { getSession, onAuth, signInWithEmail, signInWithGoogle } from "../lib/ledgerApi";

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = onAuth((s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return null;
  if (session) return children;

  const send = async (e) => { e.preventDefault(); if (!email) return; await signInWithEmail(email); setSent(true); };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F4F3F0", fontFamily: "Inter, system-ui, sans-serif", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 360, textAlign: "center" }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 30, fontWeight: 500, color: "#1C1B19" }}>Quiet Ledger</div>
        <p style={{ color: "#77736C", fontSize: 14, margin: "8px 0 26px" }}>Sign in to open your spaces.</p>
        {sent ? (
          <p style={{ color: "#2E5A47", fontSize: 14 }}>Check your email for the sign-in link.</p>
        ) : (
          <>
            <form onSubmit={send}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com"
                style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", border: "1px solid #E7E3DC", borderRadius: 12, fontSize: 15, marginBottom: 10 }} />
              <button type="submit" style={{ width: "100%", padding: 13, borderRadius: 12, border: "none", background: "#2E5A47", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Email me a link</button>
            </form>
            <button onClick={signInWithGoogle} style={{ width: "100%", padding: 13, marginTop: 10, borderRadius: 12, border: "1px solid #E7E3DC", background: "#fff", fontSize: 15, fontWeight: 500, cursor: "pointer" }}>Continue with Google</button>
          </>
        )}
      </div>
    </div>
  );
}
