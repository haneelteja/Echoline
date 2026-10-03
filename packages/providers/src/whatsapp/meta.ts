import type { ConnectionTester, WhatsAppTemplateSender, WhatsAppTextSender } from "../types";

function toMetaComponents(message: Parameters<WhatsAppTemplateSender>[1]) {
  const components = (message.components ?? []).map((c) => ({
    type: c.type,
    parameters: c.parameters.map((p) =>
      p.type === "text" ? { type: "text", text: p.text } : { type: p.type, [p.type]: { link: p.link } }
    ),
  }));
  if (message.mediaUrls?.length && !components.some((c) => c.type === "header")) {
    components.unshift({ type: "header", parameters: [{ type: "image", image: { link: message.mediaUrls[0] } } as any] });
  }
  return components;
}

export const testMeta: ConnectionTester = async (credentials) => {
  const { accessToken, phoneNumberId } = credentials;
  if (!accessToken || !phoneNumberId) return { ok: false, error: "accessToken and phoneNumberId are required" };
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}?fields=verified_name,display_phone_number&access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  if (!res.ok) return { ok: false, error: `Meta Graph API responded ${res.status}` };
  const data = (await res.json()) as { display_phone_number?: string; verified_name?: string };
  return { ok: true, accountLabel: data.display_phone_number ?? data.verified_name ?? "WhatsApp number" };
};

async function metaSend(credentials: Record<string, string>, body: Record<string, unknown>) {
  const { accessToken, phoneNumberId } = credentials;
  if (!accessToken || !phoneNumberId) throw new Error("accessToken and phoneNumberId are required");
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Meta WhatsApp send failed (${res.status}): ${errBody}`);
  }
  const data = (await res.json()) as { messages?: { id: string }[] };
  return { providerMessageId: data.messages?.[0]?.id ?? `meta-${Date.now()}` };
}

export const sendMetaTemplate: WhatsAppTemplateSender = (credentials, message) =>
  metaSend(credentials, {
    to: message.to,
    type: "template",
    template: { name: message.templateName, language: { code: message.language }, components: toMetaComponents(message) },
  });

export interface MetaTemplateSubmission {
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  bodyText: string;
}

export interface MetaTemplateSubmissionResult {
  metaTemplateId: string;
  status: string;
}

/** Template management happens at the WhatsApp Business Account level, not
 * the phone-number level — needs wabaId, which plain sending doesn't. */
export async function submitMetaTemplate(
  credentials: Record<string, string>,
  submission: MetaTemplateSubmission
): Promise<MetaTemplateSubmissionResult> {
  const { accessToken, wabaId } = credentials;
  if (!accessToken || !wabaId) throw new Error("accessToken and wabaId are required to submit a template");
  const res = await fetch(`https://graph.facebook.com/v19.0/${wabaId}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: submission.name,
      language: submission.language,
      category: submission.category,
      components: [{ type: "BODY", text: submission.bodyText }],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Meta template submission failed (${res.status}): ${errBody}`);
  }
  const data = (await res.json()) as { id?: string; status?: string };
  return { metaTemplateId: data.id ?? "", status: data.status ?? "PENDING" };
}

/** Only valid inside the 24-hour customer-service window — enforced by the caller. */
export const sendMetaText: WhatsAppTextSender = (credentials, message) =>
  metaSend(credentials, { to: message.to, type: "text", text: { body: message.text } });
