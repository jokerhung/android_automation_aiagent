import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Execute only the pure status function with fake registry reads.
// Never call the real enable/disable helpers or modify OS Startup.
const source = fs.readFileSync("scripts/windows/autostart.ps1", "utf8");
const start = source.indexOf("function EffectiveStatus");
const end = source.indexOf("if($Action-eq 'status')", start);
const statusFunction = source.slice(start, end);
describe.skipIf(process.platform !== "win32")("Startup approval states (isolated PowerShell)", () => {
  it.each([
    ["missing-key", true, undefined],
    ["missing-value", true, undefined],
    ["enabled", true, undefined],
    ["disabled", false, "Disabled in Windows Startup settings"],
    ["unknown", null, "Unknown Windows Startup approval state"],
    ["denied", null, "could not be read"],
  ])("%s", (scenario, enabled, reason) => {
    const code = `
      $ErrorActionPreference='Stop'
      $name='test-app.lnk'
      function Result($enabled,$registration,$reason=$null){@{enabled=$enabled;registration=$registration;reason=$reason}|ConvertTo-Json -Compress}
      function Test-Path {return ${scenario === "missing-key" ? "$false" : "$true"}}
      function Get-ItemProperty {
        ${scenario === "denied" ? "throw 'access denied'" : ""}
        $obj=[pscustomobject]@{}
        ${["enabled","disabled","unknown"].includes(String(scenario)) ? `$obj|Add-Member -NotePropertyName $name -NotePropertyValue ([byte[]]@(${scenario === "enabled" ? 2 : scenario === "disabled" ? 3 : 99},0,0,0))` : ""}
        return $obj
      }
      ${statusFunction}
      EffectiveStatus
    `;
    const output = execFileSync(path.join(process.env.SystemRoot!, "System32/WindowsPowerShell/v1.0/powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-Command", code], { windowsHide: true, encoding: "utf8", timeout: 10000 });
    const result = JSON.parse(output.trim());
    expect(result.enabled).toBe(enabled);
    expect(result.registration).toBe("valid");
    if (reason) expect(result.reason).toContain(reason);
    else expect(result.reason).toBeNull();
  });
});
