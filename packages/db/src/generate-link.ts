// One-off helper: generates a magic-sign-in link via the Admin API, bypassing
// Supabase's email-sending rate limit entirely since no email is sent.
// Usage: EMAIL=you@example.com pnpm --filter @echoline/db exec tsx src/generate-link.ts
import { createAdminClient } from "./client.js";

const email = process.env.EMAIL;
if (!email) {
  console.error("Set EMAIL=you@example.com");
  process.exit(1);
}

const admin = createAdminClient();
const { data, error } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email,
  options: { redirectTo: "http://localhost:3000/auth/callback" },
});
if (error) {
  console.error(error);
  process.exit(1);
}
console.log(data.properties.action_link);
