"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { dueList, upcomingList, validEmail, normPhone } from "@echoline/core";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { toCoreContact, toCoreSequence } from "@/lib/adapt";
import { apiFetch, ApiError } from "@/lib/apiClient";
import type { ContactRow, MessageEventRow } from "@/lib/types";

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const pctS = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const NOT_LISTED = "Not Publicly Listed";

const isReplied = (c: ContactRow) => c.em_status === "replied" || c.wa_status === "replied";
const isEngaged = (c: ContactRow) => isReplied(c) || ["opened", "clicked"].includes(c.em_track ?? "") || c.wa_track === "read";
const isReached = (c: ContactRow) => c.em_stage > 0 || c.wa_stage > 0;

export default function DashboardPage() {
  const { pid, project, seq, contacts, loadingProject, refreshProjectData } = useWorkspace();
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [events, setEvents] = useState<MessageEventRow[]>([]);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    if (!pid) return;
    apiFetch<MessageEventRow[]>(`/v1/projects/${pid}/activity`)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [pid]);

  async function runDueNow() {
    if (!pid) return;
    setRunning(true);
    setRunMessage(null);
    try {
      await apiFetch(`/v1/projects/${pid}/run-due`, { method: "POST" });
      setRunMessage("Queued — due steps will send within a minute or two.");
      setTimeout(() => refreshProjectData(), 5000);
    } catch (e) {
      setRunMessage(
        e instanceof ApiError && e.status === 403 ? "You need operator access or above to run due steps." : "Couldn't trigger the run."
      );
    } finally {
      setRunning(false);
    }
  }

  async function askAi() {
    if (!pid || !stats) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const sentE = contacts.filter((c) => c.em_stage > 0).length;
      const sentW = contacts.filter((c) => c.wa_stage > 0).length;
      const oE = pct(contacts.filter((c) => ["opened", "clicked"].includes(c.em_track ?? "")).length, sentE);
      const rW = pct(contacts.filter((c) => c.wa_track === "read").length, sentW);
      const statsPayload = {
        leads: stats.n,
        reached: stats.reached,
        engaged: stats.engaged,
        replied: stats.replied,
        due: stats.due,
        email: { sent: sentE, openRate: oE },
        whatsapp: { sent: sentW, readRate: rW },
        categories: Object.fromEntries(categories),
        areas: Object.fromEntries(areas),
        unreachable: health.none,
      };
      const { text } = await apiFetch<{ text: string }>(`/v1/projects/${pid}/insights/ai`, {
        method: "POST",
        body: JSON.stringify({ stats: statsPayload }),
      });
      setAiInsight(text);
    } catch (e) {
      setAiError(
        e instanceof ApiError && e.body && typeof e.body === "object" && "error" in e.body && (e.body as { error?: string }).error === "no_connection"
          ? "Connect an AI provider under Email & WhatsApp → AI first."
          : "AI analysis isn't available right now."
      );
    } finally {
      setAiLoading(false);
    }
  }

  const stats = useMemo(() => {
    if (!seq) return null;
    const n = contacts.length;
    const reached = contacts.filter(isReached).length;
    const engaged = contacts.filter(isEngaged).length;
    const replied = contacts.filter(isReplied).length;
    const coreSeq = toCoreSequence(seq);
    const coreContacts = contacts.map(toCoreContact);
    const due = dueList(coreContacts, coreSeq);
    const dueE = due.filter((d) => d.channel === "em").length;
    const dueW = due.length - dueE;
    const weekAgo = Date.now() - 7 * 864e5;
    const repWeek = events.filter((e) => e.event_type === "replied" && new Date(e.occurred_at).getTime() > weekAgo).length;
    return { n, reached, engaged, replied, dueE, dueW, due: due.length, repWeek, coreContacts, coreSeq };
  }, [seq, contacts, events]);

  const categories = useMemo(() => {
    const cats: Record<string, { n: number; r: number; e: number; re: number }> = {};
    for (const c of contacts) {
      const k = c.category || "Uncategorised";
      const o = (cats[k] ??= { n: 0, r: 0, e: 0, re: 0 });
      o.n++;
      if (isReached(c)) o.r++;
      if (isEngaged(c)) o.e++;
      if (isReplied(c)) o.re++;
    }
    return Object.entries(cats).sort((a, b) => b[1].n - a[1].n);
  }, [contacts]);

  const areas = useMemo(() => {
    const byArea: Record<string, { n: number; r: number; re: number }> = {};
    for (const c of contacts) {
      const k = c.area && c.area !== NOT_LISTED ? c.area : "Unknown";
      const o = (byArea[k] ??= { n: 0, r: 0, re: 0 });
      o.n++;
      if (isReached(c)) o.r++;
      if (isReplied(c)) o.re++;
    }
    return Object.entries(byArea)
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 7);
  }, [contacts]);

  const health = useMemo(() => {
    const n = contacts.length;
    const vE = contacts.filter((c) => validEmail(c.email)).length;
    const vP = contacts.filter((c) => normPhone(c.phone)).length;
    const none = contacts.filter((c) => !validEmail(c.email) && !normPhone(c.phone)).length;
    const noCat = contacts.filter((c) => !c.category).length;
    return { n, vE, vP, none, noCat };
  }, [contacts]);

  const insights = useMemo(() => {
    if (!stats) return [];
    const out: [string, string, ReactNode][] = [];
    const sentE = contacts.filter((c) => c.em_stage > 0).length;
    const sentW = contacts.filter((c) => c.wa_stage > 0).length;
    const oE = pct(contacts.filter((c) => ["opened", "clicked"].includes(c.em_track ?? "")).length, sentE);
    const rW = pct(contacts.filter((c) => c.wa_track === "read").length, sentW);
    if (stats.due)
      out.push([
        "e",
        "→",
        <>
          <b>{stats.due} steps are waiting.</b> Running them now keeps the 2-day and 5-day gaps on schedule.
        </>,
      ]);
    if (sentE >= 3 && sentW >= 3)
      out.push(
        oE >= rW
          ? [
              "e",
              "✉",
              <>
                Email is pulling harder: <b>{oE}% opened</b> vs {rW}% of WhatsApp read.
              </>,
            ]
          : [
              "g",
              "◎",
              <>
                WhatsApp gets seen: <b>{rW}% read</b> vs {oE}% of emails opened. Lead with WhatsApp for new segments.
              </>,
            ]
      );
    const best = [...categories].filter(([, v]) => v.r >= 3).sort((a, b) => b[1].re / b[1].r - a[1].re / a[1].r)[0];
    if (best && best[1].re)
      out.push([
        "g",
        "★",
        <>
          <b>{best[0]}</b> replies most: {pctS(best[1].re, best[1].r)} of those reached. Worth sourcing more leads like these.
        </>,
      ]);
    const cold = categories.find(([, v]) => v.r >= 4 && !v.re);
    if (cold)
      out.push([
        "w",
        "!",
        <>
          <b>{cold[0]}</b>: {cold[1].r} reached, no replies yet. Try an AI rewrite of the opening line for this category.
        </>,
      ]);
    if (health.none)
      out.push([
        "b",
        "×",
        <>
          <b>
            {health.none} lead{health.none > 1 ? "s have" : " has"} no usable email or phone
          </b>{" "}
          and can&apos;t be contacted. Enrich them or remove them.
        </>,
      ]);
    const bounced = contacts.filter((c) => c.em_status === "bounced").length;
    if (sentE && bounced / sentE > 0.05)
      out.push([
        "b",
        "↯",
        <>
          Bounce rate is <b>{pctS(bounced, sentE)}</b>. Above 5% hurts deliverability; verify emails before sending.
        </>,
      ]);
    const optedOut = contacts.filter((c) => c.em_status === "opted_out" || c.wa_status === "opted_out").length;
    if (stats.reached && optedOut / stats.reached > 0.08)
      out.push([
        "w",
        "↓",
        <>
          {pctS(optedOut, stats.reached)} of reached leads opted out. Check targeting and message frequency.
        </>,
      ]);
    if (!out.length)
      out.push(["e", "i", stats.n ? "Not enough activity yet for patterns. Insights appear as sends and replies build up." : "Import leads to start seeing insights."]);
    return out.slice(0, 5);
  }, [stats, contacts, categories, health]);

  if (loadingProject || !stats) {
    return (
      <div className="empty">
        <h2>Loading {project?.name ?? "project"}…</h2>
      </div>
    );
  }

  const { n, reached, engaged, replied, dueE, dueW } = stats;
  const headline = !n
    ? "Import your first leads"
    : stats.due
      ? `${stats.due} follow-up${stats.due > 1 ? "s" : ""} ready to go`
      : replied
        ? `${replied} conversation${replied > 1 ? "s" : ""} started`
        : "Sequences are running";
  const subline = !n
    ? "Upload an Excel sheet or connect a source, then generate templates with AI."
    : `${dueE} email and ${dueW} WhatsApp steps are due now. ${stats.repWeek} repl${stats.repWeek === 1 ? "y" : "ies"} in the last 7 days. Sequences ${seq?.stop_on_reply ? "stop automatically when someone replies" : "keep running after replies"}.`;

  const rings: [number, string, string][] = [
    [n, "Leads", "rgba(255,255,255,.35)"],
    [reached, "Reached", "var(--email)"],
    [engaged, "Engaged", "#8B7CFF"],
    [replied, "Replied", "var(--ok)"],
  ];

  const amx = Math.max(1, ...areas.map(([, v]) => v.n));

  return (
    <>
      <div className="dash">
        <section className="hero c12">
          <div>
            <RingsChart n={n} reached={reached} engaged={engaged} replied={replied} />
          </div>
          <div>
            <h1>{headline}</h1>
            <p className="sub">{subline}</p>
            <div className="row" style={{ marginBottom: 22 }}>
              <button className="btn primary" onClick={runDueNow} disabled={running || stats.due === 0}>
                {running ? "Queuing…" : `Run ${stats.due} due step${stats.due === 1 ? "" : "s"}`}
              </button>
              <a className="btn" href="/contacts">
                Add leads
              </a>
              <a className="btn" href="/sequence">
                Templates
              </a>
            </div>
            {runMessage && (
              <p className="small" style={{ color: "#D8D2F5", marginBottom: 10 }}>
                {runMessage}
              </p>
            )}
            <div className="ring-legend">
              {rings.map(([v, k, col], i) => (
                <div className="rl" key={k}>
                  <div className="v">{v}</div>
                  <div className="k">
                    <i style={{ background: col }} />
                    {k}
                  </div>
                  <div className="p">
                    {i ? `${pctS(v, i === 1 ? rings[0][0] : rings[i - 1][0])} of ${i === 1 ? "leads" : rings[i - 1][1].toLowerCase()}` : `in ${project?.name}`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel c7">
          <div className="card-h">
            <div>
              <h2>Channel funnels</h2>
              <p>How far leads get through each sequence</p>
            </div>
          </div>
          <ChannelFunnel ch="em" label="Email" contacts={contacts} color="var(--email)" />
          <ChannelFunnel ch="wa" label="WhatsApp" contacts={contacts} color="var(--wa)" />
        </section>

        <section className="panel c5">
          <div className="card-h">
            <div>
              <h2>Insights</h2>
              <p>What the numbers are telling you</p>
            </div>
            <button className="btn small" onClick={askAi} disabled={aiLoading}>
              {aiLoading ? "Thinking…" : "✦ Ask AI"}
            </button>
          </div>
          <ul className="insights">
            {insights.map(([t, ic, tx], i) => (
              <li key={i}>
                <span className={`ic ${t}`}>{ic}</span>
                <span>{tx}</span>
              </li>
            ))}
          </ul>
          {aiInsight && <div className="ai-box">{aiInsight}</div>}
          {aiError && (
            <p className="small" style={{ color: "var(--bad)", marginTop: 10 }}>
              {aiError}
            </p>
          )}
        </section>

        <section className="panel c8">
          <TrendChart events={events} />
        </section>
        <section className="panel c4">
          <div className="card-h">
            <div>
              <h2>Coming up</h2>
              <p>Scheduled steps, next 7 days</p>
            </div>
          </div>
          <ComingUp contacts={stats.coreContacts} coreSeq={stats.coreSeq} dueE={dueE} dueW={dueW} />
        </section>

        <section className="panel c7">
          <div className="card-h">
            <div>
              <h2>Segments</h2>
              <p>Performance by lead category</p>
            </div>
          </div>
          {categories.length ? (
            <div className="tbl-wrap heat" style={{ border: "none" }}>
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th style={{ textAlign: "right" }}>Leads</th>
                    <th style={{ textAlign: "right" }}>Reached</th>
                    <th style={{ textAlign: "right" }}>Engaged</th>
                    <th style={{ textAlign: "right" }}>Replied</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.slice(0, 8).map(([k, v]) => (
                    <tr key={k}>
                      <td>
                        <b>{k}</b>
                      </td>
                      <td style={{ textAlign: "right" }}>{v.n}</td>
                      <td style={{ textAlign: "right" }}>{heatCell(pct(v.r, v.n), "var(--email)")}</td>
                      <td style={{ textAlign: "right" }}>{heatCell(pct(v.e, v.r || 1), "#8B7CFF")}</td>
                      <td style={{ textAlign: "right" }}>{heatCell(pct(v.re, v.r || 1), "var(--ok)")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small">Segments appear once leads have categories.</p>
          )}
        </section>
        <section className="panel c5">
          <div className="card-h">
            <div>
              <h2>Data health</h2>
              <p>Can every lead actually be reached?</p>
            </div>
          </div>
          <div className="health">
            <HealthBar label="Valid email" v={health.vE} tot={health.n} note={`${health.n - health.vE} missing or "${NOT_LISTED}"`} />
            <HealthBar label="Valid WhatsApp number" v={health.vP} tot={health.n} note={`${health.n - health.vP} missing or malformed`} />
            <HealthBar label="Has a category" v={health.n - health.noCat} tot={health.n} note="Needed for personalised opening lines" />
          </div>
        </section>

        <section className="panel c12">
          <div className="card-h">
            <div>
              <h2>Areas</h2>
              <p>Where your leads are, and how many you&apos;ve reached</p>
            </div>
            <div className="legend">
              <span>
                <i style={{ background: "var(--ok)" }} />
                Replied
              </span>
              <span>
                <i style={{ background: "var(--email)" }} />
                Reached
              </span>
              <span>
                <i style={{ background: "var(--line)" }} />
                Not yet
              </span>
            </div>
          </div>
          {areas.length ? (
            <div className="bars">
              {areas.map(([k, v]) => (
                <div className="b" key={k}>
                  <span>{k}</span>
                  <span className="bt">
                    <i style={{ width: `${(v.re / amx) * 100}%`, background: "var(--ok)" }} />
                    <i style={{ width: `${((v.r - v.re) / amx) * 100}%`, background: "var(--email)" }} />
                    <i style={{ width: `${((v.n - v.r) / amx) * 100}%`, background: "var(--line)" }} />
                  </span>
                  <span className="small muted">{v.n} leads</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">No areas yet.</p>
          )}
        </section>
      </div>
    </>
  );
}

function RingsChart({ n, reached, engaged, replied }: { n: number; reached: number; engaged: number; replied: number }) {
  const R = 120;
  const rings: [number, string][] = [
    [n, "rgba(255,255,255,.10)"],
    [reached, "var(--email)"],
    [engaged, "#8B7CFF"],
    [replied, "var(--ok)"],
  ];
  const rr = (v: number) => (n ? Math.max(v ? 10 : 0, Math.sqrt(v / n) * R) : 0);
  return (
    <svg className="rings" viewBox="0 0 280 280" role="img" aria-label={`Leads ${n}, reached ${reached}, engaged ${engaged}, replied ${replied}`}>
      {[1, 2, 3].map((i) => (
        <circle key={i} cx={140} cy={140} r={R + i * 12} fill="none" stroke={`rgba(255,255,255,${0.09 - i * 0.025})`} strokeWidth={1} />
      ))}
      {rings.map(([v, col], i) => (
        <circle
          key={i}
          cx={140}
          cy={140}
          r={n ? rr(v) : R * (1 - i * 0.25)}
          fill={col}
          fillOpacity={i === 0 ? 1 : 0.9}
          stroke={i === 0 ? "rgba(255,255,255,.18)" : undefined}
        />
      ))}
      <text x={140} y={146} textAnchor="middle" fill="#fff" fontSize={replied ? 22 : 16} fontWeight={800}>
        {n ? pctS(replied, n) : "No leads"}
      </text>
      {n ? (
        <text x={140} y={164} textAnchor="middle" fill="rgba(255,255,255,.75)" fontSize={11}>
          reply rate
        </text>
      ) : null}
    </svg>
  );
}

function ChannelFunnel({ ch, label, contacts, color }: { ch: "em" | "wa"; label: string; contacts: ContactRow[]; color: string }) {
  const n = contacts.length;
  const stageOf = (c: ContactRow) => (ch === "em" ? c.em_stage : c.wa_stage);
  const statusOf = (c: ContactRow) => (ch === "em" ? c.em_status : c.wa_status);
  const counts = [n, ...[1, 2, 3].map((s) => contacts.filter((c) => (stageOf(c) || 0) >= s).length), contacts.filter((c) => statusOf(c) === "replied").length];
  const lbls = ["Leads", "Initial", "Follow-up 1", "Follow-up 2", "Replied"];
  const mx = Math.max(1, counts[0]);
  const sent = counts[1];
  const eng = ch === "em" ? contacts.filter((c) => ["opened", "clicked"].includes(c.em_track ?? "")).length : contacts.filter((c) => c.wa_track === "read").length;
  const inval = contacts.filter((c) => statusOf(c) === "invalid").length;
  return (
    <div className="chrow">
      <div className="chname">
        <b>{label}</b>
        <span>{inval} invalid</span>
        <div className="rate">
          <b style={{ color }}>{pctS(eng, sent)}</b>
          <span className="small muted">{ch === "em" ? "open rate" : "read rate"}</span>
        </div>
      </div>
      <div className="chan">
        {counts.map((v, i) => (
          <div className="col" key={i}>
            <span className="num">{v}</span>
            <div className="barbox">
              <div className="bar" style={{ height: `${(v / mx) * 100}%`, background: i === 4 ? "var(--ok)" : color, opacity: i === 0 ? 0.25 : 1 }} />
            </div>
            <span className="lbl">{lbls[i]}</span>
            <span className="drop">{i ? pctS(v, counts[i === 4 ? 1 : i - 1]) + (i === 4 ? " of sent" : "") : " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendChart({ events }: { events: MessageEventRow[] }) {
  const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10));
  const byDay: Record<string, { em: number; wa: number; rep: number }> = {};
  for (const d of days) byDay[d] = { em: 0, wa: 0, rep: 0 };
  for (const e of events) {
    const day = e.occurred_at.slice(0, 10);
    if (!(day in byDay)) continue;
    if (e.event_type === "sent" && (e.channel === "em" || e.channel === "wa")) byDay[day][e.channel]++;
    if (e.event_type === "replied") byDay[day].rep++;
  }
  const tr = days.map((d) => byDay[d]);
  const tmx = Math.max(1, ...tr.map((t) => t.em + t.wa));
  const W = 560,
    H = 150,
    bw = W / 14;
  const sentTotal = tr.reduce((a, t) => a + t.em + t.wa, 0);

  return (
    <>
      <div className="card-h">
        <div>
          <h2>Messages sent</h2>
          <p>Last 14 days · {sentTotal} sent</p>
        </div>
        <div className="legend">
          <span>
            <i style={{ background: "var(--email)" }} />
            Email
          </span>
          <span>
            <i style={{ background: "var(--wa)" }} />
            WhatsApp
          </span>
          <span>
            <i style={{ background: "var(--warn)", borderRadius: "50%" }} />
            Replies
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 22}`} width="100%" role="img" aria-label="Messages sent per day, last 14 days">
        {[0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={H - H * f} y2={H - H * f} stroke="var(--line)" strokeDasharray="3 4" />
        ))}
        {tr.map((t, i) => {
          const he = (t.em / tmx) * (H - 26);
          const hw = (t.wa / tmx) * (H - 26);
          const x = i * bw + bw * 0.18;
          const w = bw * 0.64;
          return (
            <g key={i}>
              <rect x={x} y={H - he} width={w} height={he} rx={3} fill="var(--email)">
                <title>
                  {days[i]}: {t.em} email
                </title>
              </rect>
              <rect x={x} y={H - he - hw} width={w} height={hw} rx={3} fill="var(--wa)">
                <title>
                  {days[i]}: {t.wa} WhatsApp
                </title>
              </rect>
              {t.rep ? (
                <circle cx={x + w / 2} cy={H - he - hw - 9} r={4} fill="var(--warn)">
                  <title>{t.rep} replies</title>
                </circle>
              ) : null}
              <text x={x + w / 2} y={H + 16} textAnchor="middle" fontSize={10} fill="var(--muted)">
                {i % 2 ? "" : new Date(days[i]).getDate()}
              </text>
            </g>
          );
        })}
      </svg>
    </>
  );
}

function ComingUp({ contacts, coreSeq, dueE, dueW }: { contacts: ReturnType<typeof toCoreContact>[]; coreSeq: ReturnType<typeof toCoreSequence>; dueE: number; dueW: number }) {
  const up = upcomingList(contacts, coreSeq);
  const wk = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + i + 1);
    return d;
  });
  const sched = [
    { l: "Now", em: dueE, wa: dueW },
    ...wk.map((d) => {
      const e = d.getTime();
      const s = e - 864e5;
      const xs = up.filter((u) => {
        const t = new Date(u.at).getTime();
        return t > s && t <= e;
      });
      return { l: d.toLocaleDateString(undefined, { weekday: "short" }), em: xs.filter((x) => x.channel === "em").length, wa: xs.filter((x) => x.channel === "wa").length };
    }),
  ];
  const smx = Math.max(1, ...sched.map((s) => s.em + s.wa));
  return (
    <div className="week">
      {sched.map((s, i) => (
        <div className="d" key={i}>
          <span className="n">{s.em + s.wa || ""}</span>
          <div className="stack" title={`${s.em} email, ${s.wa} WhatsApp`}>
            <i style={{ height: `${(s.em / smx) * 100}%`, background: "var(--email)" }} />
            <i style={{ height: `${(s.wa / smx) * 100}%`, background: "var(--wa)" }} />
          </div>
          <span>{s.l}</span>
        </div>
      ))}
    </div>
  );
}

function HealthBar({ label, v, tot, note }: { label: string; v: number; tot: number; note?: string }) {
  return (
    <div className="hb">
      <div className="t">
        <span>{label}</span>
        <b>{pctS(v, tot)}</b>
      </div>
      <div className="meter">
        <i style={{ width: `${pct(v, tot)}%` }} />
      </div>
      {note && (
        <div className="hint" style={{ marginTop: 4 }}>
          {note}
        </div>
      )}
    </div>
  );
}

function heatCell(v: number, col: string) {
  return (
    <span className="cell" style={{ background: `color-mix(in srgb, ${col} ${Math.round(8 + v * 0.6)}%, transparent)`, color: v > 55 ? "#fff" : "var(--ink)" }}>
      {v}%
    </span>
  );
}
