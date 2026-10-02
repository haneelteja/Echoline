// One-off Phase 1 acceptance check: creates a viewer and a client_viewer test
// user, signs them in programmatically (via generateLink + verifyOtp, no email
// needed), and asserts against the live API that:
//   - a viewer can read but cannot write
//   - a client_viewer only sees projects they're explicitly assigned to
// Run: pnpm --filter @echoline/db exec tsx src/verify-phase1.ts

import { createAdminClient, createAnonClient } from "./client.js";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

async function sessionFor(email: string): Promise<string> {
  const admin = createAdminClient();
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr) throw linkErr;
  const tokenHash = linkData.properties.hashed_token;
  const anon = createAnonClient();
  const { data, error } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (error) throw error;
  return data.session!.access_token;
}

async function api(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => undefined);
  return { status: res.status, body };
}

function assert(cond: boolean, msg: string) {
  console.log(`${cond ? "PASS" : "FAIL"} - ${msg}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const admin = createAdminClient();

  const { data: orgs } = await admin.from("organizations").select("id").eq("name", "Echoline Demo").single();
  const orgId = orgs!.id as string;
  const { data: elma } = await admin.from("projects").select("id").eq("org_id", orgId).eq("name", "Elma Industries").single();
  const elmaId = elma!.id as string;

  // second project, NOT assigned to the client_viewer, to prove scoping
  const { data: otherProject } = await admin
    .from("projects")
    .insert({ org_id: orgId, name: "Other Co (not assigned)" })
    .select()
    .single();

  async function ensureUser(email: string) {
    const { data: list } = await admin.auth.admin.listUsers();
    const existing = list.users.find((u) => u.email === email);
    if (existing) return existing.id;
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    return data.user.id;
  }

  const viewerEmail = "phase1-viewer@echoline.test";
  const clientViewerEmail = "phase1-client-viewer@echoline.test";
  const viewerId = await ensureUser(viewerEmail);
  const clientViewerId = await ensureUser(clientViewerEmail);

  async function upsertMembership(userId: string, role: string) {
    const { data: existing } = await admin.from("memberships").select("id").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
    if (existing) {
      await admin.from("memberships").update({ role }).eq("id", existing.id);
      return existing.id as string;
    }
    const { data } = await admin.from("memberships").insert({ org_id: orgId, user_id: userId, role }).select().single();
    return data!.id as string;
  }

  const viewerMembershipId = await upsertMembership(viewerId, "viewer");
  const clientViewerMembershipId = await upsertMembership(clientViewerId, "client_viewer");

  // scope the client_viewer to Elma only
  await admin.from("project_client_access").delete().eq("membership_id", clientViewerMembershipId);
  await admin.from("project_client_access").insert({ membership_id: clientViewerMembershipId, project_id: elmaId });

  const ownerEmail = process.env.SEED_OWNER_EMAIL;
  if (ownerEmail) {
    console.log("--- owner (positive case) ---");
    const ownerToken = await sessionFor(ownerEmail);
    const ownerWrite = await api(`/v1/projects/${elmaId}`, ownerToken, { method: "PATCH", body: JSON.stringify({ name: "Elma Industries" }) });
    assert(ownerWrite.status === 200, `owner CAN write (got ${ownerWrite.status})`);
  }

  const viewerToken = await sessionFor(viewerEmail);
  const clientViewerToken = await sessionFor(clientViewerEmail);

  console.log("\n--- viewer ---");
  const viewerList = await api("/v1/projects", viewerToken);
  assert(viewerList.status === 200 && Array.isArray(viewerList.body) && viewerList.body.length >= 2, "viewer can read projects (sees both org projects)");

  // RLS silently excludes the row from the UPDATE's affected set (no Postgres
  // error) rather than raising 42501, so PostgREST reports 0 rows matched —
  // our route surfaces that as 404, not 403. Either way, no write happens.
  const viewerWrite = await api(`/v1/projects/${elmaId}`, viewerToken, { method: "PATCH", body: JSON.stringify({ name: "Hacked" }) });
  assert([403, 404].includes(viewerWrite.status), `viewer write is blocked by RLS (got ${viewerWrite.status})`);

  console.log("\n--- client_viewer ---");
  const cvList = await api("/v1/projects", clientViewerToken);
  const cvIds = Array.isArray(cvList.body) ? cvList.body.map((p: any) => p.id) : [];
  assert(cvList.status === 200 && cvIds.includes(elmaId) && !cvIds.includes(otherProject!.id), "client_viewer sees only the assigned project (Elma), not Other Co");

  const cvWrite = await api(`/v1/projects/${elmaId}`, clientViewerToken, { method: "PATCH", body: JSON.stringify({ name: "Hacked" }) });
  assert([403, 404].includes(cvWrite.status), `client_viewer write is blocked by RLS (got ${cvWrite.status})`);

  const { data: finalElma } = await admin.from("projects").select("name").eq("id", elmaId).single();
  assert(finalElma?.name === "Elma Industries", `neither blocked write actually changed the row (name is "${finalElma?.name}")`);

  // cleanup: leave memberships (reusable for future runs) but remove the scratch project
  await admin.from("projects").delete().eq("id", otherProject!.id);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
