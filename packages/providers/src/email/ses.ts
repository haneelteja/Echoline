import { SESv2Client, GetAccountCommand, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { ConnectionTester, EmailSender } from "../types";
import { buildRawMime } from "./mime";

export const testSes: ConnectionTester = async (credentials) => {
  const { accessKeyId, secretAccessKey, region } = credentials;
  if (!accessKeyId || !secretAccessKey || !region) {
    return { ok: false, error: "accessKeyId, secretAccessKey and region are required" };
  }
  const client = new SESv2Client({ region, credentials: { accessKeyId, secretAccessKey } });
  try {
    await client.send(new GetAccountCommand({}));
    return { ok: true, accountLabel: `SES (${region})` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "SES verification failed" };
  }
};

export const sendSes: EmailSender = async (credentials, message) => {
  const { accessKeyId, secretAccessKey, region } = credentials;
  if (!accessKeyId || !secretAccessKey || !region) throw new Error("accessKeyId, secretAccessKey and region are required");
  const client = new SESv2Client({ region, credentials: { accessKeyId, secretAccessKey } });
  // Raw send (not Simple) is the only SESv2 route that supports custom headers
  // like List-Unsubscribe.
  const raw = buildRawMime(message);
  const result = await client.send(
    new SendEmailCommand({
      FromEmailAddress: message.from,
      Destination: { ToAddresses: [message.to] },
      Content: { Raw: { Data: Buffer.from(raw, "utf8") } },
    })
  );
  return { providerMessageId: result.MessageId ?? `ses-${Date.now()}` };
};
