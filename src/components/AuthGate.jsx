import React, { useEffect, useState } from "react";
import { getSession, onAuth, sendEmailCode, verifyEmailCode } from "../lib/ledgerApi";

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState("email");
  const [err, setErr] = useState("");

  useEffect(() => {
    getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = onAuth((s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return null;
  if (session) return children;

  const send = async (e) => {
    e.preventDefault();
    if (!email) return;
    setErr("");
    const { error } = await sendEmailCode(email.trim());
    if (error) setErr(error.message); else setStep("code");
  };

  const verify = async (e) => {
    e.preventDefault();
    if (!code) return;
    setErr("");
    const { error } = await verifyEmailCode(email.trim(), code.trim());
    if (error) setErr("That code didn't work — check it and try again.");
  };

  const input = { width: "100%", boxSizing: "border-box", padding: "12px 14px", border: "1px solid #E7E3DC", borderRadius: 12, fontSize: 15, marginBottom: 10 };
  const btn = { width: "100%", padding: 13, borderRadius: 12, border: "none", background: "#2E5A47", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F4F3F0", fontFamily: "Inter, system-ui, sans-serif", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 360, textAlign: "center" }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 30, fontWeight: 500, color: "#1C1B19" }}>Quiet Ledger</div>
        {step === "email" ? (
          <>
            <p style={{ color: "#77736C", fontSize: 14, margin: "8px 0 26px" }}>Enter your email to get a sign-in code.</p>
            <form onSubmit={send}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" style={input} />
              <button type="submit" style={btn}>Send me a code</button>
            </form>
          </>
        ) : (
          <>
            <p style={{ color: "#77736C", fontSize: 14, margin: "8px 0 26px" }}>Enter the code sent to<br /><b>{email}</b></p>
            <form onSubmit={verify}>
              <input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="12345678" maxLength={8} style={{ ...input, textAlign: "center", letterSpacing: "0.3em", fontSize: 22 }} />
              <button type="submit" style={btn}>Verify & sign in</button>
            </form>
            <button onClick={send} style={{ background: "none", border: "none", color: "#2E5A47", fontSize: 13, fontWeight: 600, marginTop: 12, cursor: "pointer", display: "block", width: "100%" }}>Resend code</button>
            <button onClick={() => { setStep("email"); setCode(""); setErr(""); }} style={{ background: "none", border: "none", color: "#77736C", fontSize: 13, marginTop: 10, cursor: "pointer" }}>Use a different email</button>
          </>
        )}
        {err && <p style={{ color: "#A5453A", fontSize: 13, marginTop: 14 }}>{err}</p>}
      </div>
    </div>
  );
}
