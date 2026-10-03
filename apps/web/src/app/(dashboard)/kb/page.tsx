"use client";
import { useWorkspace } from "@/components/WorkspaceProvider";

export default function KbPage() {
  const { brand } = useWorkspace();
  return (
    <>
      <div className="top">
        <div>
          <h1>Knowledge base</h1>
          <p>What the AI and your templates know about this project.</p>
        </div>
      </div>
      <section className="panel" style={{ maxWidth: 680 }}>
        <h2 style={{ marginBottom: 12 }}>Brand facts</h2>
        {[
          ["About", brand?.about],
          ["Offer / USP", brand?.offer],
          ["Pricing notes", brand?.pricing],
          ["Tone", brand?.tone],
          ["Call to action", brand?.cta],
        ].map(([label, value]) => (
          <div key={label} style={{ marginBottom: 14 }}>
            <div className="small" style={{ fontWeight: 600, color: "var(--ink2)" }}>
              {label}
            </div>
            <p className="small">{value || "—"}</p>
          </div>
        ))}
      </section>
      <p className="hint" style={{ marginTop: 16 }}>
        Editing, SKU management, and image uploads are on the backlog, planned alongside real pgvector
        retrieval for AI context (see docs/ROADMAP.md). AI template generation already reads these
        brand facts as plain text.
      </p>
    </>
  );
}
