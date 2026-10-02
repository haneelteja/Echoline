"use client";
import { useWorkspace } from "@/components/WorkspaceProvider";

export default function ChannelsPage() {
  const { channels } = useWorkspace();
  const email = (channels?.email ?? {}) as Record<string, unknown>;
  const wa = (channels?.wa ?? {}) as Record<string, unknown>;
  return (
    <>
      <div className="top">
        <div>
          <h1>Email &amp; WhatsApp</h1>
          <p>Provider connection (OAuth + API keys, encrypted vault) ships in Phase 2.</p>
        </div>
      </div>
      <div className="grid g2">
        <section className="panel">
          <h2>Email</h2>
          <p className="small muted">Provider: {(email.provider as string) || "not set"}</p>
          <span className="pill warn">
            <span className="dot" />
            Not connected
          </span>
        </section>
        <section className="panel">
          <h2>WhatsApp</h2>
          <p className="small muted">Provider: {(wa.provider as string) || "not set"}</p>
          <span className="pill warn">
            <span className="dot" />
            Not connected
          </span>
        </section>
      </div>
    </>
  );
}
