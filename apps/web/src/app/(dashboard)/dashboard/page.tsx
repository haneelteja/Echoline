"use client";
import { useMemo } from "react";
import { dueList } from "@echoline/core";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { toCoreContact, toCoreSequence } from "@/lib/adapt";

export default function DashboardPage() {
  const { project, seq, contacts, loadingProject } = useWorkspace();

  const stats = useMemo(() => {
    if (!seq) return null;
    const coreSeq = toCoreSequence(seq);
    const coreContacts = contacts.map(toCoreContact);
    const due = dueList(coreContacts, coreSeq);
    const n = contacts.length;
    const isReached = (c: (typeof contacts)[number]) => c.em_stage > 0 || c.wa_stage > 0;
    const isReplied = (c: (typeof contacts)[number]) => c.em_status === "replied" || c.wa_status === "replied";
    const isEngaged = (c: (typeof contacts)[number]) =>
      isReplied(c) || ["opened", "clicked"].includes(c.em_track ?? "") || c.wa_track === "read";
    const reached = contacts.filter(isReached).length;
    const engaged = contacts.filter(isEngaged).length;
    const replied = contacts.filter(isReplied).length;
    const dueE = due.filter((d) => d.channel === "em").length;
    const dueW = due.length - dueE;
    return { n, reached, engaged, replied, dueE, dueW, due: due.length };
  }, [seq, contacts]);

  if (loadingProject || !stats) {
    return (
      <div className="empty">
        <h2>Loading {project?.name ?? "project"}…</h2>
      </div>
    );
  }

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + "%" : "—");

  return (
    <>
      <div className="top">
        <div>
          <h1>{project?.name}</h1>
          <p>
            {stats.n} leads · {stats.due} step{stats.due === 1 ? "" : "s"} due now
          </p>
        </div>
      </div>
      <div className="dash">
        <section className="panel c12">
          <div className="kpis" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
            <Kpi label="Leads" value={stats.n} />
            <Kpi label="Reached" value={stats.reached} sub={pct(stats.reached, stats.n)} />
            <Kpi label="Engaged" value={stats.engaged} sub={pct(stats.engaged, stats.reached || 1)} />
            <Kpi label="Replied" value={stats.replied} sub={pct(stats.replied, stats.n)} />
            <Kpi label="Email due" value={stats.dueE} />
            <Kpi label="WhatsApp due" value={stats.dueW} />
          </div>
        </section>
        <section className="panel c12">
          <div className="card-h">
            <div>
              <h2>Sequence</h2>
              <p>{seq?.em.enabled ? "Email active" : "Email off"} · {seq?.wa.enabled ? "WhatsApp active" : "WhatsApp off"}</p>
            </div>
          </div>
          <p className="small muted">
            Sends go out {seq?.window_start.slice(0, 5)}–{seq?.window_end.slice(0, 5)} ({project?.timezone}), capped at{" "}
            {seq?.daily_cap}/day per channel. Actual sending (Phase 3) and live provider/webhook tracking (Phase 4) land in
            upcoming phases — numbers above reflect lead data already in the system.
          </p>
        </section>
      </div>
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="kpi">
      <div className="v">
        {value}
        {sub ? <span className="small muted" style={{ marginLeft: 8, fontWeight: 500 }}>{sub}</span> : null}
      </div>
      <div className="k">{label}</div>
    </div>
  );
}
