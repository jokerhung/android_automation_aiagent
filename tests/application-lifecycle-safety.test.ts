import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";
import {isSafeHomeUrl} from "@/lib/server/application-lifecycle";

const root=process.cwd();
const lifecyclePath=path.join(root,"lib","server","application-lifecycle.ts");
const lifecycle=fs.readFileSync(lifecyclePath,"utf8");

describe("application lifecycle safety",()=>{
 it("does not statically import persistence or runtime services",()=>{
  const staticImports=[...lifecycle.matchAll(/^import[^;]+from\s+["']([^"']+)["'];/gm)].map(match=>match[1]);
  expect(staticImports).not.toEqual(expect.arrayContaining([
   "./persistence/session-repository","./schedule/schedule-repository","./schedule/schedule-service","./agent/agent-runner","./device-monitor","./scrcpy/stream-session-manager","./scrcpy/gpl-scrcpy-bridge","./runtime-settings"
  ]));
 });
 it("binds HTTP before dynamically importing runtime services",()=>{
  const bind = lifecycle.indexOf("await listen(http, port, host)");
  const runtimeImport = lifecycle.indexOf("runtime = await importRuntimeServices()");
  expect(bind).toBeGreaterThan(-1);
  expect(bind).toBeLessThan(runtimeImport);
  expect(runtimeImport).toBeLessThan(lifecycle.indexOf("pruneRunEvents"));
 });
 it("strips spoofed peer headers on every request and upgrade, including startup",()=>{
  expect(lifecycle).toMatch(/createServer\(\(request, response\) => \{[\s\S]*?protectSystemApiPeerHeaders\(/);
  expect(lifecycle).toMatch(/http\.on\(\"upgrade\", \(request, socket, head\) => \{[\s\S]*?protectSystemApiPeerHeaders\(/);
  expect(lifecycle).toContain("requestHandler = (request, response) => handle(request, response)");
 });
 it("accepts only plain loopback HTTP home URLs",()=>{
  expect(isSafeHomeUrl("http://127.0.0.1:3000/")).toBe(true);
  expect(isSafeHomeUrl("http://localhost:3000/")).toBe(false);
  expect(isSafeHomeUrl("https://127.0.0.1:3000/")).toBe(false);
  expect(isSafeHomeUrl("http://127.0.0.1:3000/&calc.exe")).toBe(false);
  expect(isSafeHomeUrl("http://user@127.0.0.1:3000/")).toBe(false);
 });
 it("uses the shared total-deadline shutdown sequence and makes scheduler drain critical before database",()=>{const drain=lifecycle.indexOf('name: "scheduler/event/log drain"'),database=lifecycle.indexOf('name: "database"');expect(lifecycle).toContain("createShutdownSequence({");expect(lifecycle).toContain("deadlineMs: 10_000");expect(lifecycle.slice(drain,database)).toContain("critical: true");expect(drain).toBeGreaterThan(-1);expect(database).toBeGreaterThan(drain)});
 it("cancels startup and retains exclusion ownership after incomplete shutdown",()=>{expect(lifecycle).toContain("assertStartupActive();");expect(lifecycle).toContain("startupSettledPromise");expect(lifecycle).toContain("if (cleanupSafe)");expect(lifecycle).toContain("retaining instance lock until process termination");expect(lifecycle).toContain("options.onShutdownFailure?.(error)")});
 it("uses a fixed PowerShell script without cmd or execution-policy bypass",()=>{
  const opener=fs.readFileSync(path.join(root,"lib/server/platform/windows/open-home.ts"),"utf8");
  expect(opener).not.toContain("cmd.exe");
  expect(opener).not.toContain("ExecutionPolicy");
  expect(opener).toContain('"open-home.ps1"');
  expect(opener).toContain('"-HomeUrl", homeUrl');
  expect(lifecycle).toContain('void openHomePage(');
  expect(lifecycle).toContain('command: "open-home-failed"');
 });
});
