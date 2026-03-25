import { createHmac, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_AGE_MS = 60_000; // reject signatures older than 60 seconds

// ---------------------------------------------------------------------------
// HTTP request verification
// ---------------------------------------------------------------------------

/**
 * Verify an HMAC-SHA256 signature on an HTTP API request.
 *
 * Signed payload: `METHOD\nPATH_AND_QUERY\nTIMESTAMP_MS\nBODY`
 *
 * The client sends two headers:
 *   X-KaiBot-Timestamp: <unix-ms as decimal string>
 *   X-KaiBot-Signature: sha256=<lowercase hex>
 *
 * Returns true when:
 *   - secret is empty string (test / no-auth mode)
 *   - signature is present, matches, and timestamp is within MAX_AGE_MS
 */
export function verifyRequestHmac(
  secret: string,
  method: string,
  pathWithSearch: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  if (!secret) return true;

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() - ts) > MAX_AGE_MS) return false;

  const dataToSign = `${method}\n${pathWithSearch}\n${timestamp}\n${body}`;
  const expected = `sha256=${createHmac("sha256", secret).update(dataToSign).digest("hex")}`;

  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// WebSocket message verification
// ---------------------------------------------------------------------------

/**
 * Verify an HMAC-SHA256 signature on a WebSocket message.
 *
 * The client adds `ts` (unix-ms string) and `sig` (hex HMAC) to each message.
 * Signed payload: `TIMESTAMP_MS\nJSON_OF_MESSAGE_WITHOUT_TS_AND_SIG`
 *
 * Returns true when:
 *   - secret is empty string (test / no-auth mode)
 *   - sig is present, matches, and ts is within MAX_AGE_MS
 */
export function verifyWsHmac(
  secret: string,
  msg: Record<string, unknown>,
): boolean {
  if (!secret) return true;

  const ts = String(msg["ts"] ?? "");
  const sig = String(msg["sig"] ?? "");
  if (!ts || !sig) return false;

  const tsNum = parseInt(ts, 10);
  if (isNaN(tsNum) || Math.abs(Date.now() - tsNum) > MAX_AGE_MS) return false;

  // Reconstruct original message (without ts and sig) for verification
  const { ts: _ts, sig: _sig, ...rest } = msg;
  void _ts; void _sig;
  const dataToSign = `${ts}\n${JSON.stringify(rest)}`;
  const expected = createHmac("sha256", secret).update(dataToSign).digest("hex");

  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(sig, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
