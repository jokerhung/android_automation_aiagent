import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SYSTEM_CSRF_HEADER,
  SYSTEM_PEER_HEADER,
  SYSTEM_PEER_SIGNATURE_HEADER,
  getLocalSessionCsrfToken,
  protectSystemApiPeerHeaders,
  secureSystemApiRequest,
} from "@/lib/server/system-api-guard";

function request(options: {
  peer?: string;
  host?: string;
  method?: string;
  origin?: string;
  csrf?: string;
  spoof?: boolean;
} = {}): Request {
  const headers: Record<string, string | string[] | undefined> = {
    host: options.host ?? "127.0.0.1:3000",
  };
  if (options.spoof) {
    headers[SYSTEM_PEER_HEADER] = "127.0.0.1";
    headers[SYSTEM_PEER_SIGNATURE_HEADER] = "forged";
  }
  if (options.origin) headers.origin = options.origin;
  if (options.csrf) headers[SYSTEM_CSRF_HEADER] = options.csrf;
  if (options.peer) protectSystemApiPeerHeaders(headers, options.peer);
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") normalized[key] = value;
  }
  return new Request("http://127.0.0.1:3000/api/system/autostart", {
    method: options.method ?? "GET",
    headers: normalized,
  });
}

describe("system API guard", () => {
  afterEach(() => delete process.env.ALLOW_LAN);

  it("shares signing and CSRF state across separate module evaluations", async () => {
    const headers: Record<string, string | string[] | undefined> = {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      [SYSTEM_CSRF_HEADER]: getLocalSessionCsrfToken(),
    };
    protectSystemApiPeerHeaders(headers, "127.0.0.1");
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === "string") normalized[key] = value;
    }
    vi.resetModules();
    const reloaded = await import("@/lib/server/system-api-guard");
    const req = new Request("http://127.0.0.1:3000/api/system/autostart", {
      method: "PATCH",
      headers: normalized,
    });
    expect(reloaded.getLocalSessionCsrfToken()).toBe(getLocalSessionCsrfToken());
    expect(reloaded.secureSystemApiRequest(req)).toBeNull();
  });

  it("requires protected real peer context", async () => {
    const denied = secureSystemApiRequest(request({ spoof: true }));
    expect(denied?.status).toBe(403);
    expect((await denied!.json()).error.code).toBe("LOCAL_PEER_REQUIRED");
  });

  it("accepts IPv4, IPv6, and mapped loopback peers", () => {
    expect(secureSystemApiRequest(request({ peer: "127.22.3.4" }))).toBeNull();
    expect(secureSystemApiRequest(request({ peer: "::1" }))).toBeNull();
    expect(secureSystemApiRequest(request({ peer: "::ffff:127.0.0.1" }))).toBeNull();
  });

  it("rejects LAN host or peer even when ALLOW_LAN is true", () => {
    process.env.ALLOW_LAN = "true";
    expect(secureSystemApiRequest(request({ peer: "192.168.1.20" }))?.status).toBe(403);
    expect(secureSystemApiRequest(request({ peer: "127.0.0.1", host: "192.168.1.5:3000" }))?.status).toBe(403);
  });

  it("strips spoofed peer headers before signing the socket peer", () => {
    const headers: Record<string, string | string[] | undefined> = {
      [SYSTEM_PEER_HEADER]: "127.0.0.1",
      [SYSTEM_PEER_SIGNATURE_HEADER]: "forged",
    };
    protectSystemApiPeerHeaders(headers, "10.0.0.8");
    const req = new Request("http://localhost", { headers: headers as Record<string, string> });
    expect(secureSystemApiRequest(req)?.status).toBe(403);
  });

  it("requires exact same-origin and CSRF for mutation", () => {
    const base = { peer: "127.0.0.1", method: "PATCH", csrf: getLocalSessionCsrfToken() };
    expect(secureSystemApiRequest(request(base))?.status).toBe(403);
    expect(secureSystemApiRequest(request({ ...base, origin: "http://evil.test" }))?.status).toBe(403);
    expect(secureSystemApiRequest(request({ ...base, origin: "http://127.0.0.1:3000", csrf: "bad" }))?.status).toBe(403);
    expect(secureSystemApiRequest(request({ ...base, origin: "http://127.0.0.1:3000" }))).toBeNull();
  });
});
