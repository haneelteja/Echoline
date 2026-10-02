// Mirrors packages/providers' provider IDs and credential shapes — duplicated
// (not imported) because that package depends on nodemailer/@aws-sdk, which
// must never reach the browser bundle.

export interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "password";
}

export interface ProviderInfo {
  id: string;
  label: string;
  kind: "email" | "whatsapp";
  auth: "oauth" | "apikey";
  fields: CredentialField[];
}

export const PROVIDERS: ProviderInfo[] = [
  { id: "gmail", label: "Gmail / Google Workspace", kind: "email", auth: "oauth", fields: [] },
  { id: "outlook", label: "Microsoft 365 / Outlook", kind: "email", auth: "oauth", fields: [] },
  {
    id: "ses",
    label: "Amazon SES",
    kind: "email",
    auth: "apikey",
    fields: [
      { key: "accessKeyId", label: "Access key ID" },
      { key: "secretAccessKey", label: "Secret access key", type: "password" },
      { key: "region", label: "Region", placeholder: "ap-south-1" },
      { key: "fromEmail", label: "Send from (verified sender)", placeholder: "you@yourdomain.com" },
    ],
  },
  {
    id: "sendgrid",
    label: "SendGrid",
    kind: "email",
    auth: "apikey",
    fields: [
      { key: "apiKey", label: "API key", type: "password" },
      { key: "fromEmail", label: "Send from (verified sender)", placeholder: "you@yourdomain.com" },
    ],
  },
  {
    id: "brevo",
    label: "Brevo",
    kind: "email",
    auth: "apikey",
    fields: [
      { key: "apiKey", label: "API key", type: "password" },
      { key: "fromEmail", label: "Send from (verified sender)", placeholder: "you@yourdomain.com" },
    ],
  },
  {
    id: "smtp",
    label: "Custom SMTP",
    kind: "email",
    auth: "apikey",
    fields: [
      { key: "host", label: "Host", placeholder: "smtp.yourdomain.com" },
      { key: "port", label: "Port", placeholder: "587" },
      { key: "user", label: "Username" },
      { key: "pass", label: "Password", type: "password" },
      { key: "secure", label: "Secure (true/false)", placeholder: "false" },
      { key: "fromEmail", label: "Send from (optional, defaults to username)", placeholder: "you@yourdomain.com" },
    ],
  },
  {
    id: "meta",
    label: "Meta WhatsApp Cloud API",
    kind: "whatsapp",
    auth: "apikey",
    fields: [
      { key: "accessToken", label: "Access token", type: "password" },
      { key: "phoneNumberId", label: "Phone number ID" },
    ],
  },
  {
    id: "360dialog",
    label: "360dialog",
    kind: "whatsapp",
    auth: "apikey",
    fields: [{ key: "apiKey", label: "API key", type: "password" }],
  },
  {
    id: "gupshup",
    label: "Gupshup",
    kind: "whatsapp",
    auth: "apikey",
    fields: [
      { key: "apiKey", label: "API key", type: "password" },
      { key: "appId", label: "App ID" },
    ],
  },
  {
    id: "interakt",
    label: "Interakt",
    kind: "whatsapp",
    auth: "apikey",
    fields: [{ key: "apiKey", label: "API key", type: "password" }],
  },
  {
    id: "aisensy",
    label: "AiSensy",
    kind: "whatsapp",
    auth: "apikey",
    fields: [{ key: "apiKey", label: "API key", type: "password" }],
  },
  {
    id: "twilio",
    label: "Twilio",
    kind: "whatsapp",
    auth: "apikey",
    fields: [
      { key: "accountSid", label: "Account SID" },
      { key: "authToken", label: "Auth token", type: "password" },
    ],
  },
];

export function providerInfo(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
