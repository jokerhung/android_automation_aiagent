import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runBackgroundCommand, type BackgroundCliDependencies } from "@/scripts/start-background";
import type { BackgroundMetadata } from "@/lib/server/platform/windows/background-status";

const root = path.resolve("C:/test app");
const paths = {
  appRoot: root,
  databasePath: path.join(root,"data","app.db"),
  installationId: "installation",
  stateDirectory: path.join(root, "state"),
  lockPath: path.join(root, "lock"),
  metadataPath: path.join(root, "metadata"),
  logPath: path.join(root, "log"),
  pipeName: "pipe-name",
};
const metadata = (overrides: Partial<BackgroundMetadata> = {}): BackgroundMetadata => ({
  version: 1,
  appRoot: root,
  installationId: paths.installationId,
  instanceId: "instance-1",
  pid: 42,
  startedAt: new Date(10_000).toISOString(),
  mode: "background",
  pipeName: paths.pipeName,
  token: "a".repeat(64),
  port: 3000,
  ready: true,
  trayReady: true,
  ...overrides,
});

function setup(overrides: Partial<BackgroundCliDependencies> = {}) {
  const output = vi.fn();
  let now = 10_000;
  const deps: Partial<BackgroundCliDependencies> = {
    platform: "win32",
    env: { SystemRoot: "C:\Windows", NODE_ENV: "test" },
    chdir: vi.fn(),
    loadEnv: vi.fn(),
    exists: vi.fn(() => true),
    spawnDetached: vi.fn(async () => undefined),
    acquireLock: vi.fn(),
    loadStartApplication: vi.fn(),
    paths: vi.fn(() => paths),
    readMetadata: vi.fn(() => null),
    probe: vi.fn(async () => false),
    stop: vi.fn(async metadata => ({ ok: true, instanceId: metadata.instanceId, status: "stopping" })),
    now: () => now,
    delay: vi.fn(async milliseconds => { now += milliseconds; }),
    output,
    ...overrides,
  };
  return { deps, output };
}

describe("background CLI", () => {
  it("loads env and sets cwd before acquiring the host lock", async () => {
    const calls: string[] = [];
    const lock = { paths, record: metadata(), token: "a".repeat(64), release: vi.fn() };
    const { deps } = setup({
      chdir: vi.fn(() => calls.push("cwd")),
      loadEnv: vi.fn(() => calls.push("env")),
      acquireLock: vi.fn(async () => { calls.push("lock"); return lock; }),
      loadStartApplication: vi.fn(async () => async () => ({
        homeUrl: "http://localhost",
        ready: Promise.resolve(),
        shutdown: vi.fn(async () => undefined),
      })),
    });
    await runBackgroundCommand("--host", { appRoot: root, dependencies: deps });
    expect(calls).toEqual(["cwd", "env", "lock"]);
  });

  it("releases a newly owned host lock when lifecycle loading fails", async () => {
    const lock = { paths, record: metadata(), token: "a".repeat(64), release: vi.fn() };
    const { deps } = setup({
      acquireLock: vi.fn(async () => lock),
      loadStartApplication: vi.fn(async () => { throw new Error("loader failed"); }),
    });
    await expect(runBackgroundCommand("--host", { appRoot: root, dependencies: deps }))
      .rejects.toThrow("loader failed");
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it("surfaces detached spawn errors and uses absolute cwd/arguments", async () => {
    const spawnDetached = vi.fn(async () => { throw new Error("spawn failed"); });
    const { deps } = setup({ spawnDetached });
    await expect(runBackgroundCommand("start", { appRoot: root, dependencies: deps }))
      .rejects.toThrow("spawn failed");
    expect(spawnDetached).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(["--import", expect.stringContaining("file:///"), path.join(root,"scripts","start-background.ts"), "--host"]),
      root,
    );
  });

  it("rejects live foreground conflicts instead of reporting background success", async () => {
    const existing = metadata({ mode: "foreground", trayReady: false });
    const { deps } = setup({
      readMetadata: vi.fn(() => existing),
      probe: vi.fn(async () => true),
    });
    await expect(runBackgroundCommand("start", { appRoot: root, dependencies: deps }))
      .rejects.toMatchObject({ name: "AlreadyRunningError" });
  });

  it("validates metadata identity for status", async () => {
    const { deps, output } = setup({
      readMetadata: vi.fn(() => metadata({ installationId: "foreign" })),
    });
    await runBackgroundCommand("status", { appRoot: root, dependencies: deps });
    expect(output).toHaveBeenCalledWith({ status: "stopped", reason: "metadata-invalid" });
  });

  it("rolls back only a newly owned live instance after readiness timeout", async () => {
    const created = metadata({ ready: false, trayReady: false, startedAt: new Date(10_000).toISOString() });
    const readMetadata = vi.fn().mockReturnValueOnce(null).mockReturnValue(created);
    let stopped = false;
    const stop = vi.fn(async (value: BackgroundMetadata) => {
      stopped = true;
      return { ok: true, instanceId: value.instanceId, status: "stopping" };
    });
    let time = 10_000;
    const { deps } = setup({
      readMetadata,
      probe: vi.fn(async () => !stopped),
      stop,
      delay: vi.fn(async milliseconds => { time += milliseconds; }),
      now: () => time,
    });
    await expect(runBackgroundCommand("start", { appRoot: root, dependencies: deps }))
      .rejects.toThrow("TRAY_START_FAILED");
    expect(stop).toHaveBeenCalledWith(created);
  });

  it("waits for finite stop completion and reports stopped", async () => {
    const existing = metadata();
    const probe = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { deps, output } = setup({ readMetadata: vi.fn(() => existing), probe });
    await runBackgroundCommand("stop", { appRoot: root, dependencies: deps });
    expect(output).toHaveBeenCalledWith({ status: "stopped", pid: existing.pid });
  });

  it("does not stop a foreground instance", async () => {
    const existing = metadata({ mode: "development", trayReady: false });
    const stop = vi.fn();
    const { deps } = setup({ readMetadata: vi.fn(() => existing), probe: vi.fn(async () => true), stop });
    await expect(runBackgroundCommand("stop", { appRoot: root, dependencies: deps }))
      .rejects.toMatchObject({ name: "AlreadyRunningError" });
    expect(stop).not.toHaveBeenCalled();
  });
});
