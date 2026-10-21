import { getEmailSender } from "@echoline/providers";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  viewer: "Viewer",
  project_viewer: "Project viewer",
};

const ROLE_BLURB: Record<string, string> = {
  admin: "Full access — manage connections, invite others, and edit everything in this organization.",
  viewer: "Can view everything in this organization, read-only.",
  project_viewer: "Can view the specific projects they're given access to, read-only.",
};

/**
 * The platform's own transactional email — distinct from every per-project
 * provider_connections row (Resend/SMTP/etc.), which send to *leads*, not
 * teammates. Needs its own credential since no org has a platform-wide one.
 */
function platformSender() {
  const apiKey = process.env.PLATFORM_RESEND_API_KEY;
  const from = process.env.PLATFORM_EMAIL_FROM;
  if (!apiKey || !from) return null;
  const sender = getEmailSender("resend");
  if (!sender) return null;
  return { send: (to: string, subject: string, html: string, text: string) => sender({ apiKey }, { from, to, subject, html, text }) };
}

export async function sendInviteEmail(opts: {
  to: string;
  orgName: string;
  inviterEmail: string;
  role: string;
  acceptUrl: string;
}): Promise<void> {
  const sender = platformSender();
  if (!sender) throw new Error("Platform email isn't configured (PLATFORM_RESEND_API_KEY/PLATFORM_EMAIL_FROM)");

  const roleLabel = ROLE_LABEL[opts.role] ?? opts.role;
  const roleBlurb = ROLE_BLURB[opts.role] ?? "";
  const subject = `${opts.inviterEmail} invited you to join ${opts.orgName} on Echoline`;

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#F3F5F8;font-family:'Segoe UI',Manrope,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F8;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:520px;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(23,32,51,0.08);">
            <tr>
              <td style="background:#172033;padding:28px 36px;">
                <span style="color:#FFFFFF;font-size:20px;font-weight:700;letter-spacing:-0.01em;">Echoline</span>
                <div style="color:#8C96AB;font-size:12px;margin-top:2px;">Email + WhatsApp outreach</div>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 36px 8px;">
                <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#172033;">You're invited to <span style="color:#4C5BD4;">${escapeHtml(opts.orgName)}</span></h1>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4A5468;">
                  <strong>${escapeHtml(opts.inviterEmail)}</strong> has invited you to join their organization on Echoline.
                </p>
                <table role="presentation" width="100%" style="background:#F3F5F8;border-radius:10px;margin:0 0 24px;">
                  <tr>
                    <td style="padding:16px 18px;">
                      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#7A8396;margin-bottom:4px;">Your role</div>
                      <div style="font-size:16px;font-weight:700;color:#172033;">${escapeHtml(roleLabel)}</div>
                      <div style="font-size:13px;color:#4A5468;margin-top:2px;">${escapeHtml(roleBlurb)}</div>
                    </td>
                  </tr>
                </table>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
                  <tr>
                    <td style="border-radius:999px;background:#4C5BD4;">
                      <a href="${opts.acceptUrl}" style="display:inline-block;padding:13px 30px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;">Accept invite</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 4px;font-size:13px;color:#7A8396;">Or paste this link into your browser:</p>
                <p style="margin:0 0 24px;font-size:12px;color:#8C96AB;word-break:break-all;">${opts.acceptUrl}</p>
                <p style="margin:0;font-size:12px;color:#8C96AB;">This invite expires in 7 days. If you weren't expecting this, you can safely ignore this email.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 36px 28px;border-top:1px solid #E6E3F0;">
                <p style="margin:0;font-size:12px;color:#8C96AB;">Sent by Echoline on behalf of ${escapeHtml(opts.orgName)}.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${opts.inviterEmail} invited you to join ${opts.orgName} on Echoline as ${roleLabel}.\n\nAccept the invite: ${opts.acceptUrl}\n\nThis invite expires in 7 days.`;

  await sender.send(opts.to, subject, html, text);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
