import type { ConnectionTester, WhatsAppTemplateSender, WhatsAppTextSender } from "../types";

function toMetaComponents(message: Parameters<WhatsAppTemplateSender>[1]) {
  const components = (message.components ?? []).map((c) => ({
    type: c.type,
    parameters: c.parameters.map((p) =>
      p.type === "text" ? { type: "text", text: p.text } : { type: p.type, [p.type]: { link: p.link } }
    ),
  }));
  if (message.mediaUrls?.length && !components.some((c) => c.type === "header")) {
    const kind = message.mediaKind ?? "image";
    const media: Record<string, unknown> = { link: message.mediaUrls[0] };
    if (kind === "document" && message.mediaFilename) media.filename = message.mediaFilename;
    components.unshift({ type: "header", parameters: [{ type: kind, [kind]: media }] as any });
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
  /** One example value per {{n}} variable, in order — Meta requires this
   * (example.body_text) for any template with variables, or review can
   * reject or indefinitely hold the submission. */
  bodyExamples?: string[];
  /** Attaches a HEADER component — handle comes from uploadMetaMedia(). */
  header?: { format: "IMAGE" | "DOCUMENT"; handle: string };
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
  const bodyComponent: Record<string, unknown> = { type: "BODY", text: submission.bodyText };
  if (submission.bodyExamples?.length) bodyComponent.example = { body_text: [submission.bodyExamples] };
  const components: Record<string, unknown>[] = [];
  if (submission.header) {
    components.push({ type: "HEADER", format: submission.header.format, example: { header_handle: [submission.header.handle] } });
  }
  components.push(bodyComponent);
  const res = await fetch(`https://graph.facebook.com/v19.0/${wabaId}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: submission.name,
      language: submission.language,
      category: submission.category,
      components,
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Meta template submission failed (${res.status}): ${errBody}`);
  }
  const data = (await res.json()) as { id?: string; status?: string };
  return { metaTemplateId: data.id ?? "", status: data.status ?? "PENDING" };
}

export interface MetaMediaUpload {
  handle: string;
}

/**
 * Meta's resumable upload API — required to get a `header_handle` for a
 * WhatsApp template's HEADER media at submission time (unlike a *send*-time
 * header, which can just be a URL Meta fetches per message, template
 * registration needs the file re-hosted on Meta's side first). Fetches the
 * asset's bytes from its own (public) URL, then does Meta's two-step
 * session+upload flow. Needs an `appId` credential, distinct from wabaId/
 * phoneNumberId — the Facebook App ID the access token belongs to.
 */
export async function uploadMetaMedia(
  credentials: Record<string, string>,
  file: { url: string; mimeType: string; sizeBytes: number }
): Promise<MetaMediaUpload> {
  const { accessToken, appId } = credentials;
  if (!accessToken || !appId) throw new Error("accessToken and appId are required to upload template header media");

  const sessionRes = await fetch(
    `https://graph.facebook.com/v21.0/${appId}/uploads?file_length=${file.sizeBytes}&file_type=${encodeURIComponent(file.mimeType)}&access_token=${encodeURIComponent(accessToken)}`,
    { method: "POST" }
  );
  if (!sessionRes.ok) throw new Error(`Meta upload session failed (${sessionRes.status}): ${await sessionRes.text().catch(() => "")}`);
  const session = (await sessionRes.json()) as { id?: string };
  if (!session.id) throw new Error("Meta upload session did not return an id");

  const fileRes = await fetch(file.url);
  if (!fileRes.ok) throw new Error(`Couldn't fetch asset bytes to upload (${fileRes.status})`);
  const bytes = await fileRes.arrayBuffer();

  const uploadRes = await fetch(`https://graph.facebook.com/v21.0/${session.id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${accessToken}`, file_offset: "0" },
    body: Buffer.from(bytes),
  });
  if (!uploadRes.ok) throw new Error(`Meta media upload failed (${uploadRes.status}): ${await uploadRes.text().catch(() => "")}`);
  const result = (await uploadRes.json()) as { h?: string };
  if (!result.h) throw new Error("Meta media upload did not return a handle");
  return { handle: result.h };
}

/** Only valid inside the 24-hour customer-service window — enforced by the caller. */
export const sendMetaText: WhatsAppTextSender = (credentials, message) =>
  metaSend(credentials, { to: message.to, type: "text", text: { body: message.text } });
