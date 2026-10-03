"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { WorkspaceProvider, useWorkspace } from "@/components/WorkspaceProvider";
import { LogoMark } from "@/components/LogoMark";
import { createClient } from "@/lib/supabase/client";

const NAV: [string, string, string][] = [
  ["/dashboard", "Dashboard", "◧"],
  ["/contacts", "Leads & status", "☰"],
  ["/sequence", "Sequence", "↧"],
  ["/templates", "Templates & AI", "✎"],
  ["/kb", "Knowledge base", "▣"],
  ["/channels", "Email & WhatsApp", "⇄"],
  ["/sources", "Lead sources", "⇣"],
  ["/activity", "Activity log", "⋯"],
  ["/project", "Project settings", "⚙"],
];

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
    <>
      <div className="mobile-top">
        <button className="btn small" aria-label="Open menu" onClick={() => setOpen((v) => !v)}>
          ☰
        </button>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "'Bricolage Grotesque'", fontWeight: 700, color: "#fff" }}>
          <LogoMark size={22} />
          Echoline
        </span>
        <span />
      </div>
      <div className="app">
        <aside className={open ? "open" : ""}>
          <div className="logo">
            <LogoMark />
            <div>
              Echoline
              <small>Email + WhatsApp outreach</small>
            </div>
          </div>
          <div className="projpick">
            <label htmlFor="projSel">Project</label>
            <select
              id="projSel"
              value={pid ?? ""}
              onChange={(e) => setPid(e.target.value)}
              disabled={loadingProjects || projects.length === 0}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <nav>
            {NAV.map(([href, label, icon]) => (
              <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} onClick={() => setOpen(false)}>
                <span aria-hidden="true">{icon}</span>
                {label}
              </Link>
            ))}
          </nav>
          <div className="side-foot">
            <button className="btn small" style={{ width: "100%", justifyContent: "center" }} onClick={signOut}>
              Sign out
            </button>
          </div>
        </aside>
        <main>{!loadingProjects && projects.length === 0 ? <NoProjects /> : children}</main>
      </div>
    </>
  );
}

function NoProjects() {
  return (
    <div className="empty">
      <h1>No projects yet</h1>
      <p>Ask an admin to add you to an organization, or create your first project.</p>
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
