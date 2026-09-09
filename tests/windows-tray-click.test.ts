import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe.skipIf(process.platform !== "win32")("real Windows tray click protocol", () => {
  it("emits open-home when the enabled menu item is clicked", () => {
    // Isolated helper, auto-disposed. No server, browser or Startup changes.
    const script = fs.readFileSync("scripts/windows/tray.ps1", "utf8").replace(/^\uFEFF/, "").replace(
      "Emit 'ready'",
      `Emit 'ready'
      $script:homeEnabled=$true
      $open.Enabled=$true
      $open.PerformClick()
      $queue.Enqueue('{"command":"dispose"}')`,
    );
    const result = execFileSync(path.join(process.env.SystemRoot!, "System32/WindowsPowerShell/v1.0/powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-Command", script],
      { windowsHide: true, timeout: 15000, encoding: "utf8",
        input: JSON.stringify({ command: "initialize", homeUrl: "http://127.0.0.1:4001/", status: "Test" }) + "\n" });
    const events = result.trim().split(/\r?\n/).map(line => JSON.parse(line).event);
    expect(events).toContain("ready");
    expect(events).toContain("open-home");
    expect(events).toContain("disposed");
    expect(events).not.toContain("error");
  }, 20000);
});
