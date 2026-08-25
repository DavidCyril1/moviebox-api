/**
 * MovieBox x-tr-signature HMAC-MD5 signing
 *
 * Reverse-engineered from com.cloud.hisavana.sdk.C8160h0 (classes3.dex).
 * Verified against APK v4.0.01.0813.03 — signing logic and primary key unchanged.
 *
 * Signature format:  {timestamp_ms}|2|{base64(HMAC-MD5(key, message))}
 *
 * Message format:
 *   METHOD\n
 *   accept\n           (empty if absent)
 *   content-type\n     (empty if absent)
 *   body_byte_len\n    (empty if no body)
 *   timestamp_ms\n
 *   body_md5_hex\n     (empty if no body)
 *   normalized_path    (path?alphabetically_sorted_query)
 *
 * The key string is base64-decoded before use as HMAC key bytes.
 *
 * Two keys exist in APK (C8160h0.m38328a()):
 *   default (f28603b == false):  76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O  ← used in production
 *   alternate (f28603b == true): Xqn2nnO41/L92o1iuXhSLHTbXvY4Z5ZZ62m8mSLA
 */

import { createHmac, createHash } from "node:crypto";

// Key from C8160h0.m38328a() — default branch (f28603b == false)
// Unchanged from v3.0.16.0727.03 → v4.0.01.0813.03
const KEY_B64 = "76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O";
const KEY = Buffer.from(KEY_B64, "base64");

/** Alphabetically sort query params (mirrors C8160h0.m38335h() / HttpSigner.f()) */
function normalizeUrl(url: string): string {
  const u = new URL(url);
  const path = u.pathname;
  const params = u.searchParams;

  if (![...params.keys()].length) return path;

  const sorted = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  return `${path}?${sorted}`;
}

export interface SignOptions {
  method?: string;
  accept?: string;
  contentType?: string;
  body?: string;
  timestampMs?: string;
}

/**
 * Generate the x-tr-signature header value for a MovieBox API request.
 */
export function sign(url: string, opts: SignOptions = {}): string {
  const {
    method = "GET",
    accept = "",
    contentType = "",
    body,
    timestampMs = String(Date.now()),
  } = opts;

  let bodyLen = "";
  let bodyMd5 = "";
  if (body) {
    const bytes = Buffer.from(body, "utf-8");
    bodyLen = String(bytes.length);
    bodyMd5 = createHash("md5").update(bytes).digest("hex");
  }

  const norm = normalizeUrl(url);

  const message = [
    method.toUpperCase(),
    accept,
    contentType,
    bodyLen,
    timestampMs,
    bodyMd5,
    norm,
  ].join("\n");

  const mac = createHmac("md5", KEY).update(message, "utf-8").digest("base64");
  return `${timestampMs}|2|${mac}`;
}
