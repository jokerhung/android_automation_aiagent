import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const child = vi.hoisted(() => ({ execFileSync: vi.fn() }));
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: child.execFileSync };
});

import {
  protectWindowsPath,
  resetWindowsSecurityCacheForTests,
} from "@/lib/server/platform/windows/windows-security";

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
const originalSystemRoot = process.env.SystemRoot;

function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { configurable: true, value });
}

function response(allowSystem: boolean) {
  return JSON.stringify({
    ok: true,
    owner: "S-1-5-21-1",
    currentSid: "S-1-5-21-1",
    systemAllowed: allowSystem,
    ruleCount: allowSystem ? 2 : 1,
  });
}

afterEach(() => {
  resetWindowsSecurityCacheForTests();
  child.execFileSync.mockReset();
  if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  if (originalSystemRoot === undefined) delete process.env.SystemRoot;
  else process.env.SystemRoot = originalSystemRoot;
});

describe("Windows security wrapper", () => {
  it("uses fixed PowerShell helper arguments without interpolating target", () => {
    setPlatform("win32");
    process.env.SystemRoot = String.raw`C:\Windows`;
    const target = path.resolve("temp folder", "unicode-đ.txt");
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    child.execFileSync.mockImplementation((file: string, args: string[]) => {
      if (path.basename(file).toLowerCase() === "whoami.exe") return '"USER","S-1-5-21-1"';
      if (path.basename(file).toLowerCase() === "powershell.exe") return response(args[args.indexOf("-AllowSystem") + 1] === "True");
      throw new Error(`Unexpected executable: ${file}`);
    });
    protectWindowsPath(target, { allowSystem: false });
    const [file, args] = child.execFileSync.mock.calls[0];
    expect(file).toBe(path.join(String.raw`C:\Windows`, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
    expect(args).toEqual(expect.arrayContaining(["-File", expect.stringMatching(/set-protected-acl.ps1$/), "-Target", target, "-Kind", "File", "-AllowSystem", "False"]));
    expect(args).not.toContain("-Command");
    expect(args).not.toContain("-ExecutionPolicy");
    vi.restoreAllMocks();
  });

  it("caches directory protection but never caches replaced files", () => {
    setPlatform("win32");
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    child.execFileSync.mockImplementation((file: string, args: string[]) => {
      if (path.basename(file).toLowerCase() === "whoami.exe") return '"USER","S-1-5-21-1"';
      if (path.basename(file).toLowerCase() === "powershell.exe") return response(args[args.indexOf("-AllowSystem") + 1] === "True");
      throw new Error(`Unexpected executable: ${file}`);
    });
    const directory = path.resolve("private-dir"), file = path.join(directory, "metadata.json");
    protectWindowsPath(directory, { container: true });
    protectWindowsPath(directory, { container: true });
    protectWindowsPath(file);
    protectWindowsPath(file);
    const powershellCalls = child.execFileSync.mock.calls.filter(([file]) => path.basename(String(file)).toLowerCase() === "powershell.exe");
    expect(powershellCalls).toHaveLength(3); // directory once, replaced file twice
    const whoamiCalls = child.execFileSync.mock.calls.filter(([file]) => path.basename(String(file)).toLowerCase() === "whoami.exe");
    expect(whoamiCalls).toHaveLength(1);
    vi.restoreAllMocks();
  });
});

