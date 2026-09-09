import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const childProcess = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: childProcess.execFile }));

import { PATCH } from "@/app/api/system/autostart/route";
import { getAutostartStatus } from "@/lib/server/platform/windows/autostart";
import {
  SYSTEM_CSRF_HEADER,
  getLocalSessionCsrfToken,
  protectSystemApiPeerHeaders,
} from "@/lib/server/system-api-guard";

const status = JSON.stringify({
  supported: true,
  enabled: false,
  registration: "absent",
  backgroundReady: true,
});

let originalPlatform: PropertyDescriptor | undefined;

function makePatch(): Request {
  const headers: Record<string, string | string[] | undefined> = {
    host: "127.0.0.1:3000",
    origin: "http://127.0.0.1:3000",
    [SYSTEM_CSRF_HEADER]: getLocalSessionCsrfToken(),
    "content-type": "application/json",
  };
  protectSystemApiPeerHeaders(headers, "127.0.0.1");
  return new Request("http://127.0.0.1:3000/api/system/autostart", {
    method: "PATCH",
    headers: headers as Record<string, string>,
    body: JSON.stringify({ enabled: true }),
  });
}

describe("autostart route queued cancellation", () => {
  beforeEach(() => {
    originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
    childProcess.execFile.mockReset().mockImplementation(() => ({ kill: vi.fn() }));
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  });

  it("deadline abort prevents its queued mutation from starting later", async () => {
    const blocker = getAutostartStatus("C:\app");
    await vi.waitFor(() => expect(childProcess.execFile).toHaveBeenCalledOnce());

    vi.useFakeTimers();
    const responsePromise = PATCH(makePatch());
    await vi.advanceTimersByTimeAsync(10_001);
    expect((await responsePromise).status).toBe(504);

    const callback = childProcess.execFile.mock.calls[0].at(-1) as
      (error: Error | null, stdout: string, stderr: string) => void;
    callback(null, status, "");
    await expect(blocker).resolves.toMatchObject({ registration: "absent" });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(childProcess.execFile).toHaveBeenCalledOnce();
  });
});
