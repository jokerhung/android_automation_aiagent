import "@/lib/server/server-guard";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const SYSTEM_PEER_HEADER = "x-android-agent-peer";
export const SYSTEM_PEER_SIGNATURE_HEADER = "x-android-agent-peer-signature";
export const SYSTEM_CSRF_HEADER = "x-autostart-token";

type SecurityState = { peerContextKey: Buffer; csrfToken: string };
const securityStateSymbol = Symbol.for("android-automation-aiagent.system-api-security.v1");
const processGlobal = globalThis as Record<PropertyKey, unknown>;
const existingSecurityState = processGlobal[securityStateSymbol] as SecurityState | undefined;
const securityState = existingSecurityState ?? {
  peerContextKey: randomBytes(32),
  csrfToken: randomBytes(32).toString("base64url"),
};
processGlobal[securityStateSymbol] = securityState;
const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type MutableNodeHeaders = Record<string, string | string[] | undefined>;

function normalizeAddress(value: string): string {
  const zoneIndex = value.indexOf("%");
  const withoutZone = zoneIndex === -1 ? value : value.slice(0, zoneIndex);
  return withoutZone.toLowerCase().startsWith("::ffff:")
    ? withoutZone.slice(7)
    : withoutZone;
}

export function isLoopbackAddress(value: string): boolean {
  const address = normalizeAddress(value);
  if (address === "::1") return true;
  if (isIP(address) !== 4) return false;
  const firstOctet = Number(address.split(".", 1)[0]);
  return firstOctet === 127;
}

function signPeer(peer: string): string {
  return createHmac("sha256", securityState.peerContextKey).update(peer).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Custom-server bridge. Call this with req.headers and req.socket.remoteAddress
 * immediately before handing the request to Next. Client values are always removed.
 */
export function protectSystemApiPeerHeaders(
  headers: MutableNodeHeaders,
  remoteAddress: string | undefined,
): void {
  delete headers[SYSTEM_PEER_HEADER];
  delete headers[SYSTEM_PEER_SIGNATURE_HEADER];
  if (!remoteAddress) return;
  const peer = normalizeAddress(remoteAddress);
  headers[SYSTEM_PEER_HEADER] = peer;
  headers[SYSTEM_PEER_SIGNATURE_HEADER] = signPeer(peer);
}

export function getVerifiedSystemApiPeer(request: Request): string | null {
  const peer = request.headers.get(SYSTEM_PEER_HEADER);
  const signature = request.headers.get(SYSTEM_PEER_SIGNATURE_HEADER);
  if (!peer || !signature || !safeEqual(signPeer(peer), signature)) return null;
  return peer;
}

function response(code: string, message: string, status: number): Response {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

function loopbackHost(request: Request): boolean {
  const rawHost = request.headers.get("host");
  if (!rawHost) return false;
  try {
    const hostname = new URL(`http://${rawHost}`).hostname;
    return hostname === "localhost" || isLoopbackAddress(hostname.replace(/^\[|\]$/g, ""));
  } catch {
    return false;
  }
}

function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    const target = new URL(request.url);
    // Next may construct request.url using its bound hostname rather than the browser Host.
    // Compare the browser origin to the actual Host; never trust forwarded host/proto.
    const expected = new URL(`${target.protocol}//${host}`);
    return origin === parsed.origin && parsed.origin === expected.origin && parsed.host === host;
  } catch {
    return false;
  }
}

export function getLocalSessionCsrfToken(): string {
  return securityState.csrfToken;
}

export function secureSystemApiRequest(
  request: Request,
  options: { mutation?: boolean } = {},
): Response | null {
  if (!loopbackHost(request)) {
    return response("LOCAL_ONLY", "System management is restricted to a loopback host", 403);
  }
  const peer = getVerifiedSystemApiPeer(request);
  if (!peer || !isLoopbackAddress(peer)) {
    return response("LOCAL_PEER_REQUIRED", "A verified loopback peer is required", 403);
  }
  const mutation = options.mutation ?? mutationMethods.has(request.method.toUpperCase());
  if (!mutation) return null;
  if (!hasSameOrigin(request)) {
    return response("ORIGIN_REJECTED", "Mutation origin must exactly match the request host", 403);
  }
  const suppliedToken = request.headers.get(SYSTEM_CSRF_HEADER);
  if (!suppliedToken || !safeEqual(suppliedToken, securityState.csrfToken)) {
    return response("CSRF_REJECTED", "A valid local session CSRF token is required", 403);
  }
  return null;
}
