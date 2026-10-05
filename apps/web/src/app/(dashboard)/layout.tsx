"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  SendHorizontal,
  FileEdit,
  BookOpen,
  Share2,
  Download,
  History,
  Settings,
  LogOut,
  Menu,
} from "lucide-react";
import { WorkspaceProvider, useWorkspace } from "@/components/WorkspaceProvider";
import { LogoMark } from "@/components/LogoMark";
import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Leads & status", icon: Users },
  { href: "/sequence", label: "Sequence", icon: SendHorizontal },
  { href: "/templates", label: "Templates & AI", icon: FileEdit },
  { href: "/kb", label: "Knowledge base", icon: BookOpen },
  { href: "/channels", label: "Email & WhatsApp", icon: Share2 },
  { href: "/sources", label: "Lead sources", icon: Download },
  { href: "/activity", label: "Activity log", icon: History },
  { href: "/project", label: "Project settings", icon: Settings },
] as const;

function Shell({ children }: { children: React.ReactNode }) {
  const { projects, pid, setPid, loadingProjects } = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const supabase = createClient();

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

        <button
          onClick={signOut}
          className="flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}

      <main className="min-w-0 flex-1 bg-muted/30 p-5 lg:p-8">{!loadingProjects && projects.length === 0 ? <NoProjects /> : children}</main>
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

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <Shell>{children}</Shell>
    </WorkspaceProvider>
  );
}
