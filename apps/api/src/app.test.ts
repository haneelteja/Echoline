import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("buildApp error handler", () => {
  it("the custom error handler runs for every route, not Fastify's own default", async () => {
    const app = await buildApp();
    // Malformed JSON fails during body parsing (Fastify's preParsing/
    // content-type-parser stage), which runs before the preHandler auth
    // hook — so this reaches our custom setErrorHandler without needing a
    // real session, on literally any registered POST route. The exact
    // bug this guards against: setErrorHandler was once registered *after*
    // every app.register() call in server.ts, which meant every route kept
    // resolving to Fastify's own default handler — this response's shape
    // ({error:"internal_error",...}) is only produced by *our* handler;
    // Fastify's own default produces {statusCode,error:"Internal Server
    // Error",message} instead, which is what regressing this would look like.
    const res = await app.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { "content-type": "application/json" },
      payload: "{not valid json",
    });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe("internal_error");
    expect(body.error).not.toBe("Internal Server Error");
    await app.close();
  });

  it("applies in the top-level (non-/v1-prefixed) plugin context too, not just the nested authenticated one", async () => {
    const app = await buildApp();
    // /webhooks/* routes are registered at the top level of buildApp(),
    // outside the {prefix:"/v1"} nested plugin the first test's /v1/orgs
    // lives in — Fastify's plugin encapsulation means these are genuinely
    // different registration contexts, both of which need the fix.
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/email/resend",
      headers: { "content-type": "application/json" },
      payload: "{not valid json",
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("internal_error");
    await app.close();
  });
});
