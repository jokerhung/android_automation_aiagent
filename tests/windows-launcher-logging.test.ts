import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const source = fs.readFileSync("scripts/windows/launch-background.ps1", "utf8");
const ps = path.join(process.env.SystemRoot || "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";

function fixture(code: string, nodePath = process.execPath) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-log-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "scripts"));
  fs.symlinkSync(path.resolve("node_modules"), path.join(root, "node_modules"), "junction");
  fs.writeFileSync(path.join(root, "scripts/start-background.ts"), code);
  // Redirect only the log location to the fixture; all launcher code runs unchanged.
  const script = source.replace("[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)", quote(root));
  const command = "& { " + script + " } -AppRoot " + quote(root) + " -NodePath " + quote(nodePath);
  const result = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")],
    { windowsHide: true, encoding: "utf8", timeout: 15000 });
  if (result.error) throw result.error;
  const base = path.join(root, "AndroidAgent/launcher");
  const dir = path.join(base, fs.readdirSync(base)[0]);
  return { result, log: fs.readFileSync(path.join(dir, "launcher.log"), "utf8"), dir };
}

describe.skipIf(process.platform !== "win32")("launcher diagnostics with real Windows pipes", () => {
  it("captures both streams, redacts credentials, and preserves failure exit", () => {
    const { result, log } = fixture(`
      console.log("mock stdout ready");
      process.stderr.write("SMTP_PASSWORD=private-value\\nBearer private-bearer\\n");
      process.stderr.write("api_key=sk-12345678901234567890\\n");
      process.stderr.write('{"password":"secret with spaces"}\\n');
      process.exitCode=7;
    `);
    expect(result.status).toBe(7);
    for (const part of ["launch_begin", "node_spawned", "stdout: mock stdout ready", "node_exit", "code=7", "[REDACTED]"]) expect(log).toContain(part);
    for (const secret of ["private-value", "private-bearer", "sk-12345678901234567890", "secret with spaces"]) expect(log).not.toContain(secret);
  }, 20000);
  it("records preflight errors before Node starts", () => {
    const { result, log } = fixture("", "C:/missing-android-test-node.exe");
    expect(result.status).toBe(1);
    expect(log).toContain("launcher_error NODE_MISSING");
    expect(log).not.toContain("node_spawned");
  }, 20000);
  it("handles output larger than pipe buffers and bounds long lines", () => {
    const { result, log } = fixture(`
      process.stdout.write("x".repeat(180000)+"\\n");
      process.stderr.write("y".repeat(180000)+"\\n");
      console.log("AFTER_LARGE_OUTPUT");
    `);
    expect(result.status).toBe(0);
    expect(log).toContain("AFTER_LARGE_OUTPUT");
    expect(log).toContain("[truncated]");
    expect(Buffer.byteLength(log)).toBeLessThan(30000);
  }, 20000);
  it("rotates only the owned fixed log filenames", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-rotate-")); roots.push(root);
    const file = path.join(root,"launcher.log");
    fs.writeFileSync(file,"x".repeat(5242880));
    fs.writeFileSync(file+".1","previous"); fs.writeFileSync(file+".2","oldest");
    fs.writeFileSync(path.join(root,"unrelated.txt"),"keep");
    const functions = source.slice(source.indexOf("function Scrub"), source.indexOf("function New-PipeReader"));
    const command = `$ErrorActionPreference='Stop';$script:logFile=${quote(file)};$script:logMutex=[Threading.Mutex]::new();${functions};Write-LauncherLog 'ROTATED';$script:logMutex.Dispose()`;
    execFileSync(ps,["-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(command,"utf16le").toString("base64")],{windowsHide:true,timeout:10000});
    expect(fs.readFileSync(file,"utf8")).toContain("ROTATED");
    expect(fs.readFileSync(file+".2","utf8")).toBe("previous");
    expect(fs.readFileSync(path.join(root,"unrelated.txt"),"utf8")).toBe("keep");
  });
});
