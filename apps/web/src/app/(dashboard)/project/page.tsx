"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { createClient } from "@/lib/supabase/client";
import { TeamSettings } from "@/components/TeamSettings";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Mirrors the server-side check in apps/api/src/routes/projects.ts — hiding
// the control here is just so nobody else is confused by a toggle they can't
// use; the API independently refuses the write regardless of what the UI sends.
const TEST_SEND_MODE_OPERATOR_EMAIL = "pega2023test@gmail.com";

export default function ProjectSettingsPage() {
  const { pid, project, setPid, refreshProjects } = useWorkspace();
  const supabase = useMemo(() => createClient(), []);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [senderName, setSenderName] = useState("");
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");
  const [waNumber, setWaNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [testSendMode, setTestSendMode] = useState(true);
  const [savingTestSendMode, setSavingTestSendMode] = useState(false);
  const [testSendModeError, setTestSendModeError] = useState<string | null>(null);
  const [confirmGoLive, setConfirmGoLive] = useState(false);
  const [testSendEmailAddr, setTestSendEmailAddr] = useState("");
  const [testSendWhatsappNum, setTestSendWhatsappNum] = useState("");
  const [savingTestTargets, setSavingTestTargets] = useState(false);
  const [testTargetsError, setTestTargetsError] = useState<string | null>(null);
  const [testTargetsSaved, setTestTargetsSaved] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserEmail(data.user?.email ?? null));
  }, [supabase]);

  // project loads async (null on first render if this page loads directly,
  // e.g. a refresh) — useState's initial value only applies on the very
  // first render, so seeding it from project?.x there would silently leave
  // these fields blank forever once project actually arrives. This re-syncs
  // whenever project changes instead.
  useEffect(() => {
    if (!project) return;
    setName(project.name ?? "");
    setBrand(project.brand ?? "");
    setSenderName(project.sender_name ?? "");
    setWebsite(project.website ?? "");
    setEmail(project.email ?? "");
    setWaNumber(project.wa_number ?? "");
    setTestSendMode(project.test_send_mode);
    setTestSendEmailAddr(project.test_send_email ?? "");
    setTestSendWhatsappNum(project.test_send_whatsapp ?? "");
  }, [project]);

  if (!project) return <div className="empty">Loading…</div>;

  async function save() {
    if (!pid) return;
    setError(null);
    setSaved(false);
    try {
      await apiFetch(`/v1/projects/${pid}`, {
        method: "PATCH",
        body: JSON.stringify({ name, brand, senderName, website, email, waNumber }),
      });
      setSaved(true);
      await refreshProjects();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't edit project settings." : "Save failed.");
    }
  }

  // Turning test mode OFF means every subsequent send — automated sequence
  // steps and manual "Send now" alike — goes to the real lead's actual
  // email/WhatsApp number instead of the fixed test inbox. That's a real,
  // hard-to-take-back action (a lead who's already been messaged has been
  // messaged), so it goes through a confirm dialog; turning it back ON is
  // the safe direction and applies immediately.
  async function setLive(next: boolean) {
    if (!pid) return;
    setSavingTestSendMode(true);
    setTestSendModeError(null);
    try {
      await apiFetch(`/v1/projects/${pid}`, { method: "PATCH", body: JSON.stringify({ testSendMode: !next }) });
      setTestSendMode(!next);
      setConfirmGoLive(false);
      await refreshProjects();
    } catch (e) {
      setTestSendModeError(
        e instanceof ApiError && e.status === 403
          ? "Only the platform operator account can change this."
          : "Couldn't update test send mode."
      );
    } finally {
      setSavingTestSendMode(false);
    }
  }

  // Where test sends are redirected to while test send mode is on — defaults
  // to the hardcoded pega2023test@gmail.com / 9642917777 fallback (see
  // testSendMode.ts) when left blank.
  async function saveTestTargets() {
    if (!pid) return;
    setSavingTestTargets(true);
    setTestTargetsError(null);
    setTestTargetsSaved(false);
    try {
      await apiFetch(`/v1/projects/${pid}`, {
        method: "PATCH",
        body: JSON.stringify({ testSendEmail: testSendEmailAddr, testSendWhatsapp: testSendWhatsappNum }),
      });
      setTestTargetsSaved(true);
      await refreshProjects();
    } catch (e) {
      setTestTargetsError(
        e instanceof ApiError && e.status === 403
          ? "Only the platform operator account can change this."
          : "Couldn't save test send targets."
      );
    } finally {
      setSavingTestTargets(false);
    }
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Project settings</h1>
          <p>Identity used in templates and email branding.</p>
        </div>
        <Button variant="secondary" onClick={() => setCreatingProject(true)}>
          <Plus className="h-4 w-4" />
          New project
        </Button>
      </div>

      <CreateProjectDialog
        open={creatingProject}
        onOpenChange={setCreatingProject}
        currentOrgId={project.org_id}
        onCreated={async (created) => {
          await refreshProjects();
          setPid(created.id);
        }}
      />
      <section className="panel" style={{ maxWidth: 820 }}>
        <div className="grid g2">
          <div className="field">
            <label htmlFor="name">Project name</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="brand">Brand name in messages</label>
            <input id="brand" value={brand ?? ""} onChange={(e) => setBrand(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sender">Sender name</label>
            <input id="sender" value={senderName ?? ""} onChange={(e) => setSenderName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="website">Website</label>
            <input id="website" value={website ?? ""} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email ?? ""} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourcompany.com" />
            <p className="hint">Used to prefill the recipient when testing an email connection under Connections.</p>
          </div>
          <div className="field">
            <label htmlFor="wa">WhatsApp number for click-to-chat</label>
            <input id="wa" value={waNumber ?? ""} onChange={(e) => setWaNumber(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: 20 }}>
          <button className="btn primary" onClick={save}>
            Save project
          </button>
          {saved && <span className="small muted" style={{ marginLeft: 10 }}>Saved.</span>}
          {error && (
            <p className="small" style={{ color: "var(--bad)", marginTop: 10 }}>
              {error}
            </p>
          )}
        </div>
      </section>

      {currentUserEmail === TEST_SEND_MODE_OPERATOR_EMAIL && (
        <section className="panel" style={{ maxWidth: 820 }}>
          <h2>Sending</h2>
          <p className="hint" style={{ marginBottom: 14 }}>
            Visible only to the platform operator account.
          </p>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Test send mode</div>
              <p className="small muted" style={{ maxWidth: "48ch", marginTop: 2 }}>
                {testSendMode
                  ? "On — every email and WhatsApp send for this project (automated sequence and manual \"Send now\") is redirected to a fixed test inbox/number, never the real lead."
                  : "Off — this project sends for real. Leads in this project receive actual emails and WhatsApp messages."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!testSendMode}
              disabled={savingTestSendMode}
              onClick={() => (testSendMode ? setConfirmGoLive(true) : setLive(false))}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50",
                testSendMode ? "border-border bg-muted" : "border-transparent bg-primary"
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                  testSendMode ? "translate-x-1" : "translate-x-6"
                )}
              />
            </button>
          </div>
          {testSendModeError && (
            <p className="small" style={{ color: "var(--bad)", marginTop: 10 }}>
              {testSendModeError}
            </p>
          )}

          <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--line)" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Test send destination</div>
            <p className="small muted" style={{ maxWidth: "48ch", marginTop: 2, marginBottom: 14 }}>
              Where test sends for this project go while test send mode is on. Leave blank to use the default
              (pega2023test@gmail.com / 9642917777).
            </p>
            <div className="grid g2">
              <div className="field">
                <label htmlFor="testEmail">Test email address</label>
                <input
                  id="testEmail"
                  type="email"
                  value={testSendEmailAddr}
                  onChange={(e) => setTestSendEmailAddr(e.target.value)}
                  placeholder="pega2023test@gmail.com"
                />
              </div>
              <div className="field">
                <label htmlFor="testWhatsapp">Test WhatsApp number</label>
                <input
                  id="testWhatsapp"
                  value={testSendWhatsappNum}
                  onChange={(e) => setTestSendWhatsappNum(e.target.value)}
                  placeholder="9642917777"
                />
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <Button variant="outline" onClick={saveTestTargets} disabled={savingTestTargets}>
                {savingTestTargets ? "Saving…" : "Save test destination"}
              </Button>
              {testTargetsSaved && <span className="small muted" style={{ marginLeft: 10 }}>Saved.</span>}
              {testTargetsError && (
                <p className="small" style={{ color: "var(--bad)", marginTop: 10 }}>
                  {testTargetsError}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      <Dialog open={confirmGoLive} onOpenChange={(open) => !open && !savingTestSendMode && setConfirmGoLive(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Turn off test send mode?
            </DialogTitle>
            <DialogDescription>
              Every lead in <strong>{project.name}</strong> will start receiving real emails and WhatsApp messages —
              both the automated sequence and manual &quot;Send now&quot; sends. This can&apos;t be undone for
              messages already sent.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmGoLive(false)} disabled={savingTestSendMode}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => setLive(true)} disabled={savingTestSendMode}>
              Send for real
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TeamSettings orgId={project.org_id} />
    </>
  );
}
