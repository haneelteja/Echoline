"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  LayoutDashboard,
  Users,
  SendHorizontal,
  BookOpen,
  Share2,
  Download,
  History,
  Settings,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { WorkspaceProvider, useWorkspace } from "@/components/WorkspaceProvider";
import { LogoMark } from "@/components/LogoMark";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Leads & status", icon: Users },
  { href: "/sequence", label: "Sequence & Templates", icon: SendHorizontal },
  { href: "/kb", label: "Knowledge base", icon: BookOpen },
  { href: "/channels", label: "Email & WhatsApp", icon: Share2 },
  { href: "/sources", label: "Lead sources", icon: Download },
  { href: "/activity", label: "Activity log", icon: History },
  { href: "/project", label: "Project settings", icon: Settings },
] as const;

const NEW_PROJECT_OPTION = "__new_project__";

function Shell({ children }: { children: React.ReactNode }) {
  const { projects, pid, setPid, project, loadingProjects, projectsError, projectDataError, refreshProjects, refreshProjectData } = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [hasPassword, setHasPassword] = useState(true); // assume set until we know otherwise, avoids a flash of the prompt
  const [promptDismissed, setPromptDismissed] = useState(false);
  const [settingPassword, setSettingPassword] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  async function onProjectCreated(created: { id: string }) {
    await refreshProjects();
    setPid(created.id);
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setHasPassword(Boolean(data.user?.user_metadata?.has_password));
    });
  }, [supabase]);

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <div className="flex items-center justify-between border-b border-border bg-background px-4 py-3 lg:hidden">
        <button
          aria-label="Open menu"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="flex items-center gap-2 font-display text-base font-bold text-foreground">
          <LogoMark size={22} dotColor="#0F1115" />
          Echoline
        </span>
        <span className="w-8" />
      </div>

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col gap-1 border-r border-border bg-background p-4 transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="mb-5 flex items-center gap-2 px-1 font-display text-lg font-bold text-foreground">
          <LogoMark size={28} dotColor="#0F1115" />
          <div className="flex flex-col leading-tight">
            Echoline
            <span className="font-sans text-[11px] font-normal text-muted-foreground">Email + WhatsApp outreach</span>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-1.5 px-1">
          <label htmlFor="projSel" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Project
          </label>
          <Select
            id="projSel"
            value={pid ?? ""}
            onChange={(e) => {
              if (e.target.value === NEW_PROJECT_OPTION) setCreatingProject(true);
              else setPid(e.target.value);
            }}
            disabled={loadingProjects}
          >
            {projects.length === 0 && (
              <option value="" disabled>
                No projects yet
              </option>
            )}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value={NEW_PROJECT_OPTION}>+ New project…</option>
          </Select>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5">
          <span className="mb-1 px-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Main navigation</span>
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                  active ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-accent hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>

        {email && <p className="mb-2 truncate px-1 text-xs text-muted-foreground" title={email}>{email}</p>}
        <button
          onClick={signOut}
          className="flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}

      <main className="min-w-0 flex-1 bg-gradient-to-br from-slate-50 via-blue-50/60 to-indigo-50/60 p-5 lg:p-8">
        {loadingProjects ? (
          // Without this branch, children rendered immediately on first
          // mount with pid/projects still empty — e.g. the Leads page would
          // show a confident "0 of 0 leads" / "No leads in this project"
          // during the gap before the first /v1/projects response landed
          // (worse, longer, during a Render cold start), indistinguishable
          // from a genuinely empty project.
          <WorkspaceLoading />
        ) : projectsError ? (
          <ProjectsLoadError message={projectsError} onRetry={refreshProjects} />
        ) : projects.length === 0 ? (
          <NoProjects onCreateProject={() => setCreatingProject(true)} />
        ) : (
          <>
            {!hasPassword && !promptDismissed && (
              <SetPasswordBanner onSetPassword={() => setSettingPassword(true)} onDismiss={() => setPromptDismissed(true)} />
            )}
            {projectDataError && <ProjectDataErrorBanner message={projectDataError} onRetry={refreshProjectData} />}
            {children}
          </>
        )}
      </main>

      <SetPasswordDialog
        open={settingPassword}
        onClose={() => setSettingPassword(false)}
        onSet={() => {
          setHasPassword(true);
          setSettingPassword(false);
        }}
      />

      <CreateProjectDialog
        open={creatingProject}
        onOpenChange={setCreatingProject}
        currentOrgId={project?.org_id ?? null}
        onCreated={onProjectCreated}
      />
    </div>
  );
}

function SetPasswordBanner({ onSetPassword, onDismiss }: { onSetPassword: () => void; onDismiss: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
      <div className="flex items-center gap-2 text-sm text-foreground">
        <KeyRound className="h-4 w-4 shrink-0 text-primary" />
        Set a password so you can sign in without waiting for an email link next time.
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <button onClick={onSetPassword} className="text-sm font-medium text-primary hover:underline">
          Set password
        </button>
        <button onClick={onDismiss} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

const PASSWORD_MIN_LENGTH = 5;

/** Returns the first unmet rule's message, or null if the password satisfies
 * all of them. Checked client-side before ever calling Supabase, so the
 * error shows up immediately rather than as a round-trip failure. */
function passwordError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (!/[A-Z]/.test(password)) return "Password must include at least one uppercase letter.";
  if (!/[a-z]/.test(password)) return "Password must include at least one lowercase letter.";
  if (!/[0-9]/.test(password)) return "Password must include at least one number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Password must include at least one special character.";
  return null;
}

function PasswordField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input id={id} type={visible ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} className="pr-9" />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function SetPasswordDialog({ open, onClose, onSet }: { open: boolean; onClose: () => void; onSet: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const complexityError = passwordError(password);
    if (complexityError) return setError(complexityError);
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    setError(null);
    // The password only ever leaves the browser as part of this direct
    // Supabase Auth call — it's never emailed or passed through our own API.
    const { error: err } = await supabase.auth.updateUser({ password, data: { has_password: true } });
    setBusy(false);
    if (err) return setError(err.message);
    setPassword("");
    setConfirm("");
    onSet();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Set a password</DialogTitle>
          <DialogDescription>Lets you sign in with email + password, in addition to the sign-in link.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <PasswordField id="newPw" label="New password" value={password} onChange={setPassword} />
          <PasswordField id="confirmPw" label="Confirm password" value={confirm} onChange={setConfirm} />
          <p className="text-xs text-muted-foreground">
            At least {PASSWORD_MIN_LENGTH} characters, with an uppercase letter, a lowercase letter, a number, and a
            special character.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !password || !confirm}>
            {busy ? "Saving…" : "Set password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// The "server waking up" caveat only earns its place on screen once the load
// has actually run long enough to need explaining — on a warm server (the
// common case) this resolves in well under a second, and showing a "may take
// up to a minute" warning on every single page load regardless would read as
// alarming and unpolished for something that's normally instant.
const SLOW_LOAD_THRESHOLD_MS = 4000;

function WorkspaceLoading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_LOAD_THRESHOLD_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="flex flex-col items-center gap-3 p-12 text-center">
      <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        {slow ? "Still loading… the server is waking up after being idle, this can take up to a minute." : "Loading your workspace…"}
      </p>
    </div>
  );
}

function NoProjects({ onCreateProject }: { onCreateProject: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-background p-12 text-center">
      <h1 className="font-display text-2xl font-bold text-foreground">No projects yet</h1>
      <p className="text-sm text-muted-foreground">Ask an admin to add you to an organization, or create your first project to get started.</p>
      <Button onClick={onCreateProject}>
        <Plus className="h-4 w-4" />
        Create a project
      </Button>
    </div>
  );
}

function ProjectsLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-background p-12 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" />
      <h1 className="font-display text-2xl font-bold text-foreground">Couldn&apos;t load your projects</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <button
        onClick={onRetry}
        className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        <RefreshCw className="h-4 w-4" />
        Retry
      </button>
    </div>
  );
}

function ProjectDataErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5">
      <div className="flex items-center gap-2 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {message}
      </div>
      <button onClick={onRetry} className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-destructive hover:underline">
        <RefreshCw className="h-3.5 w-3.5" />
        Retry
      </button>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <Shell>{children}</Shell>
    </WorkspaceProvider>
  );
}
