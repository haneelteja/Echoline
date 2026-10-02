import { SESv2Client, GetAccountCommand } from "@aws-sdk/client-sesv2";
import type { ConnectionTester } from "../types";

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
