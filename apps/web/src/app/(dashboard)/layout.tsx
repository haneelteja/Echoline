"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle,
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
  RefreshCw,
} from "lucide-react";
import { WorkspaceProvider, useWorkspace } from "@/components/WorkspaceProvider";
import { LogoMark } from "@/components/LogoMark";
import { Select } from "@/components/ui/select";
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

function Shell({ children }: { children: React.ReactNode }) {
  const { projects, pid, setPid, loadingProjects, projectsError, projectDataError, refreshProjects, refreshProjectData } = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
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
          <Select id="projSel" value={pid ?? ""} onChange={(e) => setPid(e.target.value)} disabled={loadingProjects || projects.length === 0}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
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
          <NoProjects />
        ) : (
          <>
            {projectDataError && <ProjectDataErrorBanner message={projectDataError} onRetry={refreshProjectData} />}
            {children}
          </>
        )}
      </main>
    </div>
  );
}

function WorkspaceLoading() {
  return (
    <div className="flex flex-col items-center gap-3 p-12 text-center">
      <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Loading your workspace… the server can take up to a minute to wake up if it&apos;s been idle.</p>
    </div>
  );
}

function NoProjects() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-background p-12 text-center">
      <h1 className="font-display text-2xl font-bold text-foreground">No projects yet</h1>
      <p className="text-sm text-muted-foreground">Ask an admin to add you to an organization, or create your first project.</p>
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
