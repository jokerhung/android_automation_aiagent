import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { protectWindowsPath, resetWindowsSecurityCacheForTests } from "@/lib/server/platform/windows/windows-security";

const powershell = path.join(process.env.SystemRoot || "C:\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
function ps(script: string, target: string): string {
  return execFileSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 10_000, env: { ...process.env, ACL_TEST_TARGET: target } }).trim();
}

describe.runIf(process.platform === "win32")("exact real Windows ACL", () => {
  it("removes foreign ACEs and leaves the parent ACL unchanged", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "android-agent-acl-"));
    const target = path.join(root, "private đ folder");
    fs.mkdirSync(target);
    const before = ps("(Get-Acl -LiteralPath $env:ACL_TEST_TARGET).Sddl", root);
    ps("$acl=Get-Acl -LiteralPath $env:ACL_TEST_TARGET;$sid=New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0');$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'Read','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule);Set-Acl -LiteralPath $env:ACL_TEST_TARGET -AclObject $acl", target);
    try {
      resetWindowsSecurityCacheForTests();
      protectWindowsPath(target, { container: true, allowSystem: true });
      const value = JSON.parse(ps("$acl=Get-Acl -LiteralPath $env:ACL_TEST_TARGET;[pscustomobject]@{protected=$acl.AreAccessRulesProtected;rules=@($acl.Access|%{$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value})}|ConvertTo-Json -Compress", target)) as { protected: boolean; rules: string[] };
      expect(value.protected).toBe(true);
      expect(value.rules).not.toContain("S-1-1-0");
      expect(value.rules).toContain("S-1-5-18");
      expect(ps("(Get-Acl -LiteralPath $env:ACL_TEST_TARGET).Sddl", root)).toBe(before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("supports a current-user-only file DACL", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "android-agent-acl-file-"));
    const target = path.join(root, "token ü.json");
    fs.writeFileSync(target, "secret");
    try {
      resetWindowsSecurityCacheForTests();
      protectWindowsPath(target, { allowSystem: false });
      const value = JSON.parse(ps("$acl=Get-Acl -LiteralPath $env:ACL_TEST_TARGET;[pscustomobject]@{protected=$acl.AreAccessRulesProtected;rules=@($acl.Access|%{$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value})}|ConvertTo-Json -Compress", target)) as { protected: boolean; rules: string[] };
      expect(value.protected).toBe(true);
      expect(value.rules).toHaveLength(1);
      expect(value.rules).not.toContain("S-1-5-18");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
