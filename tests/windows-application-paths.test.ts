import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getApplicationDatabasePath } from "@/lib/server/application-paths";
import { getWindowsInstallationPaths } from "@/lib/server/platform/windows/paths";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "android-agent-paths-"));
  roots.push(root);
  return root;
}

describe("database-backed installation identity", () => {
  it("uses a portable non-Windows fallback without LOCALAPPDATA or a named pipe", () => {
    const root = temporaryRoot();
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    vi.stubEnv("LOCALAPPDATA", "");
    const paths = getWindowsInstallationPaths(root);
    expect(paths.pipeName).toBe(path.join(os.tmpdir(), `android-agent-${paths.installationId}.sock`));
    expect(paths.pipeName).not.toContain("\\.\pipe");
    expect(paths.stateDirectory).toBe(path.join(path.dirname(paths.databasePath), ".android-agent-state", paths.installationId));
  });

  it("canonicalizes symlinked app roots to the same database identity", () => {
    const root = temporaryRoot();
    const actual = path.join(root, "actual");
    const alias = path.join(root, "alias");
    fs.mkdirSync(path.join(actual, "data"), { recursive: true });
    fs.symlinkSync(actual, alias, process.platform === "win32" ? "junction" : "dir");
    const fromActual = getWindowsInstallationPaths(actual);
    const fromAlias = getWindowsInstallationPaths(alias);
    expect(fromAlias.databasePath).toBe(fromActual.databasePath);
    expect(fromAlias.installationId).toBe(fromActual.installationId);
    expect(fromAlias.lockPath).toBe(fromActual.lockPath);
  });

  it("uses shared absolute database identity and rejects relative configuration", () => {
    const root = temporaryRoot();
    const firstRoot = path.join(root, "first");
    const secondRoot = path.join(root, "second");
    fs.mkdirSync(firstRoot, { recursive: true });
    fs.mkdirSync(secondRoot, { recursive: true });
    vi.stubEnv("ANDROID_AGENT_DATABASE_PATH", "storage/custom.db");
    expect(() => getWindowsInstallationPaths(firstRoot)).toThrow("must be an absolute path");

    const shared = path.join(root, "shared", "agent.db");
    vi.stubEnv("ANDROID_AGENT_DATABASE_PATH", shared);
    const sharedFirst = getWindowsInstallationPaths(firstRoot);
    const sharedSecond = getWindowsInstallationPaths(secondRoot);
    expect(sharedFirst.installationId).toBe(sharedSecond.installationId);
    expect(sharedFirst.lockPath).toBe(path.join(path.dirname(shared), ".android-agent.lock"));
    expect(getApplicationDatabasePath(secondRoot)).toBe(sharedSecond.databasePath);
  });
});
