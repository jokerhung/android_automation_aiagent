import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const childProcess = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: childProcess.execFile }));

import {
  getAutostartStatus,
  setAutostartEnabled,
} from "@/lib/server/platform/windows/autostart";

const validStatus = JSON.stringify({
  supported: true,
  enabled: false,
  registration: "absent",
  backgroundReady: true,
});

let originalPlatform: PropertyDescriptor | undefined;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { configurable: true, value });
}

function completeCall(index: number, error: Error | null = null): void {
  const callback = childProcess.execFile.mock.calls[index]?.at(-1) as
    | ((error: Error | null, stdout: string, stderr: string) => void)
    | undefined;
  if (!callback) throw new Error("Missing execFile callback");
  callback(error, validStatus, "");
}

describe("Windows autostart cancellation", () => {
  beforeEach(() => {
    originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    setPlatform("win32");
    childProcess.execFile.mockReset().mockImplementation(() => ({ kill: vi.fn() }));
  });

  afterEach(() => {
    if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  });

  it("passes AbortSignal to execFile and rejects an in-flight abort", async () => {
    const controller = new AbortController();
    const pending = getAutostartStatus("C:\app", { signal: controller.signal });
    await vi.waitFor(() => expect(childProcess.execFile).toHaveBeenCalledOnce());
    const options = childProcess.execFile.mock.calls[0][2];
    expect(options.signal).toBe(controller.signal);
    controller.abort();
    completeCall(0, Object.assign(new Error("aborted"), { name: "AbortError" }));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("uses a correctly escaped fallback Windows root without policy overrides", async () => {
    const pending = getAutostartStatus("C:\app");
    await vi.waitFor(() => expect(childProcess.execFile).toHaveBeenCalledOnce());
    expect(childProcess.execFile.mock.calls[0][0]).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(childProcess.execFile.mock.calls[0][1].join(" ")).not.toMatch(/ExecutionPolicy|Bypass/i);
    completeCall(0);
    await expect(pending).resolves.toMatchObject({ registration: "absent" });
  });

  it("reports a blocked user policy without trying to bypass it", async () => {
    const pending = setAutostartEnabled(true, "C:\app");
    await vi.waitFor(() => expect(childProcess.execFile).toHaveBeenCalledOnce());
    const callback = childProcess.execFile.mock.calls[0].at(-1) as (error: Error | null, stdout: string, stderr: string) => void;
    callback(Object.assign(new Error("cannot be loaded because running scripts is disabled"), { code: 1 }), "", "PSSecurityException execution policies");
    await expect(pending).rejects.toMatchObject({ code: "STARTUP_BLOCKED" });
    expect(childProcess.execFile).toHaveBeenCalledOnce();
  });

  it("never starts a queued operation aborted before its turn", async () => {
    const first = getAutostartStatus("C:\app");
    await vi.waitFor(() => expect(childProcess.execFile).toHaveBeenCalledOnce());

    const controller = new AbortController();
    const queued = setAutostartEnabled(true, "C:\app", { signal: controller.signal });
    controller.abort();
    completeCall(0);

    await expect(first).resolves.toMatchObject({ registration: "absent" });
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(childProcess.execFile).toHaveBeenCalledOnce();
  });
});
