"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { LogoMark } from "@/components/LogoMark";

interface InvitePreview {
  orgName: string;
  email: string;
  role: string;
  valid: boolean;
  status: "pending" | "accepted" | "revoked" | "expired";
}

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  viewer: "Viewer",
  project_viewer: "Project viewer",
};

type State = "loading" | "invalid" | "needs_login" | "email_mismatch" | "accepting" | "accepted" | "error";

function AcceptInviteInner() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<State>("loading");
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }
    (async () => {
      let invite: InvitePreview;
      try {
        invite = await apiFetch<InvitePreview>(`/invites/preview?token=${encodeURIComponent(token)}`);
      } catch {
        setState("invalid");
        return;
      }
      setPreview(invite);
      if (!invite.valid) {
        setState("invalid");
        return;
      }
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      const email = data.user?.email ?? null;
      setSignedInEmail(email);
      if (!email) {
        setState("needs_login");
        return;
      }
      if (email.toLowerCase() !== invite.email.toLowerCase()) {
        setState("email_mismatch");
        return;
      }
      setState("accepting");
      try {
        await apiFetch("/v1/invites/accept", { method: "POST", body: JSON.stringify({ token }) });
        setState("accepted");
        window.location.href = "/dashboard";
      } catch (e) {
        setState("error");
        setError(e instanceof ApiError ? e.message : "Couldn't accept the invite.");
      }
    })();
  }, [token]);

  function signInToAccept() {
    window.location.href = `/login?next=${encodeURIComponent(`/accept-invite?token=${token}`)}`;
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

        {state === "loading" && <p className="hint" style={{ marginTop: 16 }}>Checking your invite…</p>}

        {state === "invalid" && (
          <>
            <p className="sub" style={{ marginTop: 4 }}>
              {preview?.status === "accepted"
                ? "This invite was already accepted."
                : preview?.status === "revoked"
                  ? "This invite was revoked."
                  : preview?.status === "expired"
                    ? "This invite has expired — ask whoever invited you to send a new one."
                    : "This invite link isn't valid."}
            </p>
          </>
        )}

        {state === "needs_login" && preview && (
          <>
            <p className="sub" style={{ marginTop: 4 }}>
              <strong>{preview.email}</strong> has been invited to join <strong>{preview.orgName}</strong> as{" "}
              <strong>{ROLE_LABEL[preview.role] ?? preview.role}</strong>.
            </p>
            <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 12 }} onClick={signInToAccept}>
              Sign in with {preview.email} to accept
            </button>
          </>
        )}

        {state === "email_mismatch" && preview && (
          <p className="sub" style={{ marginTop: 4, color: "var(--bad)" }}>
            This invite was sent to <strong>{preview.email}</strong>, but you&apos;re signed in as <strong>{signedInEmail}</strong>. Sign out and
            sign in with {preview.email} to accept it.
          </p>
        )}

        {state === "accepting" && <p className="hint" style={{ marginTop: 16 }}>Joining…</p>}

        {state === "accepted" && <p className="hint" style={{ marginTop: 16 }}>You&apos;re in — redirecting…</p>}

        {state === "error" && <p className="sub" style={{ marginTop: 4, color: "var(--bad)" }}>{error}</p>}
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteInner />
    </Suspense>
  );
}
