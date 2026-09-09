import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";

const root=process.cwd();
const autostart=fs.readFileSync(path.join(root,"scripts/windows/autostart.ps1"),"utf8");
const launcher=fs.readFileSync(path.join(root,"scripts/windows/launch-background.ps1"),"utf8");

describe("Windows autostart helper contract",()=>{
 it("creates a temporary COM shortcut whose filename still ends in .lnk",()=>{expect(autostart).toContain('"Android Agent - $InstallationId.$PID.tmp.lnk"');expect(autostart).not.toContain('.lnk.$PID.tmp')});
 it("omits an absent reason from the strict status contract",()=>{expect(autostart).toContain('if($null -ne $reason){$result.reason=[string]$reason}');expect(autostart).not.toContain('reason=$reason')});
 it("reports Windows StartupApproved enabled disabled and unknown states",()=>{expect(autostart).toContain(String.raw`StartupApproved\StartupFolder`);expect(autostart).toContain("if($value[0] -eq 2){Result $true 'valid'");expect(autostart).toContain("if($value[0] -eq 3){Result $false 'valid'");expect(autostart).toContain("Result $null 'valid' 'Unknown Windows Startup approval state'")});
 it("refuses foreign overwrite and restores a previous owned shortcut",()=>{expect(autostart).toContain("REGISTRATION_INVALID: refusing to overwrite an unverified shortcut");expect(autostart).toContain("[IO.File]::ReadAllBytes($shortcutPath)");expect(autostart).toContain("[IO.File]::WriteAllBytes($shortcutPath,$backup)")});
 it("preflights production dependencies interactive desktop and writable local state",()=>{for(const required of [".next/BUILD_ID","node_modules/tsx/dist/loader.mjs","node_modules/next/package.json","node_modules/better-sqlite3/package.json","scripts/windows/tray.ps1","scripts/start-background.ts"])expect(autostart).toContain(required);expect(autostart).toContain("[Environment]::UserInteractive");expect(autostart).toContain("SessionId -ne 0");expect(autostart).toContain("[IO.File]::WriteAllText($probe,'preflight')")});
 it("converts the absolute tsx loader path to a file URI",()=>{expect(launcher).toContain("$tsxUri=([System.Uri]::new($tsx)).AbsoluteUri");expect(launcher).toContain("--import");expect(launcher).not.toMatch(/ExecutionPolicy|Bypass/i)});
});
