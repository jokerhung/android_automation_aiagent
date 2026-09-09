import "@/lib/server/server-guard";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ProtectWindowsPathOptions = { container?: boolean; allowSystem?: boolean };
type AclResult = { ok: true; owner: string; currentSid: string; systemAllowed: boolean; ruleCount: number };
let cachedSid: string | undefined;
const protectedPaths = new Map<string, { container: boolean; allowSystem: boolean }>();

function windowsTool(name: string) {
  return path.join(process.env.SystemRoot || String.raw`C:\Windows`, "System32", name);
}
function aclHelperPath() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../scripts/windows/set-protected-acl.ps1");
}
function cacheKey(target: string) { return path.resolve(target).toLowerCase(); }

export function getCurrentWindowsSid(): string | null {
  if (process.platform !== "win32") return null;
  if (cachedSid) return cachedSid;
  const output = execFileSync(windowsTool("whoami.exe"), ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  const match = output.match(/"(S-1-[0-9-]+)"/i);
  if (!match) throw new Error("Unable to resolve the current Windows SID");
  cachedSid = match[1];
  return cachedSid;
}

export function protectWindowsPath(target: string, containerOrOptions: boolean | ProtectWindowsPathOptions = false): void {
  if (process.platform !== "win32") return;
  if (!fs.existsSync(target)) throw new Error(`Cannot protect missing path: ${target}`);
  const options = typeof containerOrOptions === "boolean"
    ? { container: containerOrOptions, allowSystem: true }
    : { container: containerOrOptions.container ?? false, allowSystem: containerOrOptions.allowSystem ?? true };
  const key = cacheKey(target), cached = protectedPaths.get(key);
  // Cache only directories. Files such as background.json are atomically replaced,
  // so caching a file path could accidentally trust a new inode with inherited ACLs.
  if (options.container && cached?.container === true && cached.allowSystem === options.allowSystem) return;
  const helper = aclHelperPath();
  if (!fs.existsSync(helper)) throw new Error(`ACL helper is missing: ${helper}`);
  const output = execFileSync(path.join(windowsTool("WindowsPowerShell"), "v1.0", "powershell.exe"), [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-File", helper,
    "-Target", path.resolve(target), "-Kind", options.container ? "Directory" : "File",
    "-AllowSystem", options.allowSystem ? "True" : "False",
  ], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  let result: AclResult;
  try { result = JSON.parse(output.trim()) as AclResult; } catch { throw new Error("ACL helper returned an invalid response"); }
  const expectedRules = options.allowSystem ? 2 : 1;
  if (result.ok !== true || result.currentSid !== getCurrentWindowsSid() || result.owner !== result.currentSid || result.systemAllowed !== options.allowSystem || result.ruleCount !== expectedRules) {
    throw new Error("ACL helper verification failed");
  }
  if (options.container) protectedPaths.set(key, options);
}

export function ensureProtectedDirectory(target: string, options: Omit<ProtectWindowsPathOptions, "container"> = {}): void {
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  protectWindowsPath(target, { container: true, allowSystem: options.allowSystem ?? true });
}

export function resetWindowsSecurityCacheForTests(): void {
  cachedSid = undefined;
  protectedPaths.clear();
}
