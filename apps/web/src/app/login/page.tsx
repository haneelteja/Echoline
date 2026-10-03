"use client";
import { useEffect, useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { LogoMark } from "@/components/LogoMark";

type Step = "email" | "sent" | "otp" | "completing";

export default function LoginPage() {
  const supabase = createClient();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Supabase's Site URL / Redirect URL allow-list controls where the email link
  // actually lands — until those are configured in the dashboard it may land
  // here on /login (with ?code=... or ?token_hash=...&type=...) instead of
  // /auth/callback. Handle both so sign-in completes either way.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const tokenHash = params.get("token_hash");
    const type = params.get("type") as EmailOtpType | null;
    if (!code && !(tokenHash && type)) return;

    setStep("completing");
    (async () => {
      const result = code
        ? await supabase.auth.exchangeCodeForSession(code)
        : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: type! });
      if (result.error) {
        setError(result.error.message);
        setStep("email");
        return;
      }
      window.location.href = "/dashboard";
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendCode() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) return setError(error.message);
    setStep("sent");
  }

  async function verifyCode() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    setBusy(false);
    if (error) return setError(error.message);
    window.location.href = "/dashboard";
  }

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setBusy(false);
      setError(error.message);
    }
  }

  if (step === "completing") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1>Signing you in…</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
          <span style={{ display: "inline-flex", background: "var(--side, #16112B)", borderRadius: 10, padding: 6 }}>
            <LogoMark size={22} />
          </span>
          <h1 style={{ margin: 0 }}>Echoline</h1>
        </div>
        <p className="sub">Email + WhatsApp outreach, one workspace per brand.</p>

        <button className="btn" style={{ width: "100%", justifyContent: "center" }} onClick={signInWithGoogle} disabled={busy}>
          Continue with Google
        </button>
        <p className="hint" style={{ marginTop: 6 }}>
          Needs Google enabled under Authentication → Providers in Supabase first.
        </p>
        <div className="divider">or</div>

        {step === "email" ? (
          <>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            </div>
            <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} onClick={sendCode} disabled={busy || !email}>
              Send sign-in link
            </button>
          </>
        ) : step === "sent" ? (
          <>
            <p className="hint" style={{ marginBottom: 10 }}>
              We sent a sign-in link to <b>{email}</b>. Open it on this device to finish signing in.
            </p>
            <button className="btn small" onClick={() => setStep("otp")}>
              I have a code instead
            </button>
          </>
        ) : (
          <>
            <p className="hint" style={{ marginBottom: 10 }}>
              Enter the 6-digit code sent to {email}, if your project's email template includes one.
            </p>
            <div className="field">
              <label htmlFor="code">Code</label>
              <input id="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
            </div>
            <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} onClick={verifyCode} disabled={busy || code.length < 6}>
              Verify &amp; sign in
            </button>
          </>
        )}
        {error && (
          <p className="small" style={{ color: "var(--bad)", marginTop: 12 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
