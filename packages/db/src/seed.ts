// Seeds the Elma Industries demo project from seed/elma-project.json.
//
// Usage:
//   SEED_OWNER_EMAIL=you@example.com pnpm --filter @echoline/db seed
//
// If SEED_OWNER_EMAIL is set and that user has already signed up via Supabase Auth
// (email OTP or Google), they're added as `owner` on the demo org so they see the
// Elma project immediately after logging in. Without it, the org/project are still
// created — grant yourself access afterwards from the organizations/memberships tables.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createAdminClient } from "./client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = resolve(__dirname, "../../../seed/elma-project.json");

interface SeedDoc {
  [key: string]: Record<string, unknown>;
}

async function main() {
  const raw = readFileSync(SEED_PATH, "utf-8");
  const doc: SeedDoc = JSON.parse(raw);
  const db = createAdminClient();

  const projectDoc = doc["projects/elma"] as {
    name: string;
    brand: string;
    senderName: string;
    website: string;
    waNumber: string;
    accent: string;
  };
  const sequenceDoc = doc["projects/elma/settings/sequence"] as any;
  const channelsDoc = doc["projects/elma/settings/channels"] as any;
  const brandDoc = doc["projects/elma/settings/brand"] as any;
  const sourceDoc = doc["projects/elma/sources/onedrive"] as any;
  const templateDocs = Object.entries(doc).filter(([k]) => k.startsWith("projects/elma/templates/"));

  console.log("Seeding Echoline demo org + Elma Industries project...");

  const { data: org, error: orgErr } = await db
    .from("organizations")
    .insert({ name: "Echoline Demo" })
    .select()
    .single();
  if (orgErr) throw orgErr;
  console.log(`  org: ${org.id}`);

  const { data: project, error: projErr } = await db
    .from("projects")
    .insert({
      org_id: org.id,
      name: projectDoc.name,
      brand: projectDoc.brand,
      sender_name: projectDoc.senderName,
      website: projectDoc.website,
      wa_number: projectDoc.waNumber,
      accent: projectDoc.accent,
    })
    .select()
    .single();
  if (projErr) throw projErr;
  console.log(`  project: ${project.id} (${project.name})`);

  const { error: seqErr } = await db.from("sequence_settings").insert({
    project_id: project.id,
    daily_cap: sequenceDoc.dailyCap,
    window_start: sequenceDoc.window.start,
    window_end: sequenceDoc.window.end,
    stop_on_reply: sequenceDoc.stopOnReply,
    em: sequenceDoc.em,
    wa: sequenceDoc.wa,
  });
  if (seqErr) throw seqErr;

  const { error: chanErr } = await db.from("channel_settings").insert({
    project_id: project.id,
    email: channelsDoc.email,
    wa: channelsDoc.wa,
  });
  if (chanErr) throw chanErr;

  const { error: brandErr } = await db.from("brand_kb").insert({
    project_id: project.id,
    about: brandDoc.about,
    offer: brandDoc.offer,
    pricing: brandDoc.pricing,
    tone: brandDoc.tone,
    cta: brandDoc.cta,
    skus: brandDoc.skus,
  });
  if (brandErr) throw brandErr;

  for (const [, t] of templateDocs) {
    const tpl = t as any;
    const { error } = await db.from("templates").insert({
      org_id: org.id,
      project_id: project.id,
      channel: tpl.channel,
      step: tpl.step,
      name: tpl.name,
      subject: tpl.subject ?? null,
      body: tpl.body,
      category_lines: tpl.categoryLines ?? {},
      meta_name: tpl.metaName ?? null,
      meta_status: tpl.metaStatus ?? null,
    });
    if (error) throw error;
  }
  console.log(`  templates: ${templateDocs.length}`);

  if (sourceDoc) {
    const { error } = await db.from("lead_sources").insert({
      org_id: org.id,
      project_id: project.id,
      type: sourceDoc.type,
      name: sourceDoc.name,
      detail: sourceDoc.detail,
      config: sourceDoc.config,
      mode: sourceDoc.mode,
      rows_added: sourceDoc.count ?? 0,
    });
    if (error) throw error;
    console.log("  lead source: onedrive");
  }

  const ownerEmail = process.env.SEED_OWNER_EMAIL;
  if (ownerEmail) {
    const { data: usersPage, error: listErr } = await db.auth.admin.listUsers();
    if (listErr) throw listErr;
    const user = usersPage.users.find((u) => u.email?.toLowerCase() === ownerEmail.toLowerCase());
    if (!user) {
      console.warn(
        `  No Supabase Auth user found for ${ownerEmail}. Sign up first, then re-run with SEED_OWNER_EMAIL set.`
      );
    } else {
      const { error: memErr } = await db
        .from("memberships")
        .insert({ org_id: org.id, user_id: user.id, role: "owner" });
      if (memErr) throw memErr;
      console.log(`  membership: ${ownerEmail} -> owner`);
    }
  } else {
    console.log("  No SEED_OWNER_EMAIL set — nobody has access to this org yet.");
  }

  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
