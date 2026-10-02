// Signed open-pixel and click-redirect URL builders, shared between whatever
// signs them (the worker, when rendering an email to send) and whatever
// verifies them (apps/api's tracking endpoints — Phase 4 builds out full
// event recording there; Phase 3 only needs the signing half to exist so
// the links in a sent email aren't broken, and a minimal receiving stub).
import { createHmac, timingSafeEqual } from "node:crypto";

export interface TrackingConfig {
  secret: string;
  baseUrl: string; // API_PUBLIC_URL
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function buildOpenPixelUrl(config: TrackingConfig, messageId: string): string {
  const sig = sign(messageId, config.secret);
  return `${config.baseUrl}/t/o/${messageId}?s=${sig}`;
}

export function buildClickRedirectUrl(config: TrackingConfig, messageId: string, targetUrl: string): string {
  const sig = sign(`${messageId}:${targetUrl}`, config.secret);
  const params = new URLSearchParams({ u: targetUrl, s: sig });
  return `${config.baseUrl}/t/c/${messageId}?${params.toString()}`;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function verifyOpenPixelSignature(config: TrackingConfig, messageId: string, signature: string): boolean {
  return timingSafeStringEqual(sign(messageId, config.secret), signature);
}

export function verifyClickSignature(config: TrackingConfig, messageId: string, targetUrl: string, signature: string): boolean {
  return timingSafeStringEqual(sign(`${messageId}:${targetUrl}`, config.secret), signature);
}

export function buildUnsubscribeUrl(config: TrackingConfig, messageId: string): string {
  const sig = sign(`unsub:${messageId}`, config.secret);
  return `${config.baseUrl}/u/${messageId}?s=${sig}`;
}

export function verifyUnsubscribeSignature(config: TrackingConfig, messageId: string, signature: string): boolean {
  return timingSafeStringEqual(sign(`unsub:${messageId}`, config.secret), signature);
}

/** Wraps a rewriteLink closure for packages/core's emailHTML — only rewrites
 * our own domain's links never gets double-wrapped (e.g. an unsubscribe link
 * that already points at API_PUBLIC_URL). */
export function makeRewriteLink(config: TrackingConfig, messageId: string): (url: string) => string {
  return (url: string) => (url.startsWith(config.baseUrl) ? url : buildClickRedirectUrl(config, messageId, url));
}
