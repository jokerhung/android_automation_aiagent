import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  getAutostartStatus: vi.fn(),
  setAutostartEnabled: vi.fn(),
}));

vi.mock("@/lib/server/platform/windows/autostart", () => backend);
import type { AutostartStatus } from "@/lib/contracts/system";
import {
  SYSTEM_CSRF_HEADER,
  getLocalSessionCsrfToken,
  protectSystemApiPeerHeaders,
} from "@/lib/server/system-api-guard";
import { GET, PATCH } from "@/app/api/system/autostart/route";

const status: AutostartStatus = {
  supported: true,
  enabled: false,
  registration: "absent",
  backgroundReady: true,
};

function makeRequest(method: "GET" | "PATCH", body?: string, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string | string[] | undefined> = {
    host: "127.0.0.1:3000",
    ...extraHeaders,
  };
  protectSystemApiPeerHeaders(headers, "127.0.0.1");
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") normalized[key] = value;
  }
  return new Request("http://127.0.0.1:3000/api/system/autostart", {
    method,
    headers: normalized,
    body,
  });
}

function patch(body: string, extraHeaders: Record<string, string> = {}) {
  return makeRequest("PATCH", body, {
    origin: "http://127.0.0.1:3000",
    [SYSTEM_CSRF_HEADER]: getLocalSessionCsrfToken(),
    "content-type": "application/json",
    ...extraHeaders,
  });
}

describe("autostart API", () => {
  beforeEach(() => {
    backend.getAutostartStatus.mockReset().mockResolvedValue(status);
    backend.setAutostartEnabled.mockReset().mockResolvedValue({
      ...status,
      enabled: true,
      registration: "valid",
    });
  });

  it("GET returns status and a local session CSRF token", async () => {
    const response = await GET(makeRequest("GET"));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.data).toMatchObject(status);
    expect(json.data.csrfToken).toBe(getLocalSessionCsrfToken());
    expect(backend.getAutostartStatus).toHaveBeenCalledOnce();
  });

  it("PATCH accepts only a strict enabled boolean", async () => {
    const response = await PATCH(patch(JSON.stringify({ enabled: true })));
    expect(response.status).toBe(200);
    expect(backend.setAutostartEnabled).toHaveBeenCalledWith(
      true,
      process.cwd(),
      { signal: expect.any(AbortSignal) },
    );

    const extra = await PATCH(patch(JSON.stringify({ enabled: true, startupPath: "C:/evil" })));
    expect(extra.status).toBe(400);
    const wrongType = await PATCH(patch(JSON.stringify({ enabled: "true" })));
    expect(wrongType.status).toBe(400);
  });

  it("rejects malformed, missing, and unknown payloads", async () => {
    expect((await PATCH(patch("not-json"))).status).toBe(400);
    expect((await PATCH(makeRequest("PATCH", undefined, {
      origin: "http://127.0.0.1:3000",
      [SYSTEM_CSRF_HEADER]: getLocalSessionCsrfToken(),
    }))).status).toBe(400);
    expect((await PATCH(patch(JSON.stringify({ enabled: true, command: "evil" })))).status).toBe(400);
    expect(backend.setAutostartEnabled).not.toHaveBeenCalled();
  });

  it("times out a body that does not finish", async () => {
    vi.useFakeTimers();
    try {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"enabled":'));
        },
      });
      const headers: Record<string, string | string[] | undefined> = {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        [SYSTEM_CSRF_HEADER]: getLocalSessionCsrfToken(),
      };
      protectSystemApiPeerHeaders(headers, "127.0.0.1");
      const req = new Request("http://127.0.0.1:3000/api/system/autostart", {
        method: "PATCH",
        headers: headers as Record<string, string>,
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" });
      const pending = PATCH(req);
      await vi.advanceTimersByTimeAsync(2_001);
      expect((await pending).status).toBe(408);
      expect(backend.setAutostartEnabled).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects oversized bodies before invoking the adapter", async () => {
    const response = await PATCH(patch(JSON.stringify({ enabled: true }), { "content-length": "1025" }));
    expect(response.status).toBe(413);
    expect(backend.setAutostartEnabled).not.toHaveBeenCalled();
  });

  it("requires same-origin and CSRF before parsing", async () => {
    const noOrigin = makeRequest("PATCH", JSON.stringify({ enabled: true }), {
      [SYSTEM_CSRF_HEADER]: getLocalSessionCsrfToken(),
    });
    expect((await PATCH(noOrigin)).status).toBe(403);
    expect((await PATCH(makeRequest("PATCH", JSON.stringify({ enabled: true }), {
      origin: "http://127.0.0.1:3000",
      [SYSTEM_CSRF_HEADER]: "forged",
    }))).status).toBe(403);
    expect(backend.setAutostartEnabled).not.toHaveBeenCalled();
  });

  it("bounds backend execution time and aborts its signal", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      backend.setAutostartEnabled.mockImplementation((_enabled, _root, options) => {
        signal = options.signal;
        return new Promise(() => undefined);
      });
      const pending = PATCH(patch(JSON.stringify({ enabled: true })));
      await vi.advanceTimersByTimeAsync(10_001);
      const response = await pending;
      expect(response.status).toBe(504);
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
