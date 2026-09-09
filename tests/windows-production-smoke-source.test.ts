import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve("scripts/verify-windows-production-smoke.ts"), "utf8");

describe("production smoke source invariants", () => {
  it("runs actual production entries with an isolated absolute database", () => {
    expect(source).toContain('NODE_ENV: "production"');
    expect(source).toContain('ANDROID_AGENT_DATABASE_PATH: databasePath');
    expect(source).toContain('path.resolve(fixture, "data", "app.db")');
    expect(source).toContain('path.join(appRoot, "server.ts")');
    expect(source).toContain('["--import", "tsx", entry, ...extraArgs]');
    expect(source).toContain('SCRCPY_INTEGRATION: "snapshot"');
  });

  it("uses authenticated tray shutdown and owned-process cleanup", () => {
    expect(source).toContain('path.join(appRoot, "scripts", "start-background.ts")');
    expect(source).toContain('trayMode ? ["--host"] : []');
    expect(source).toContain("await stopBackground(metadata!)");
    expect(source).toContain('owned.child.kill("SIGTERM")');
    expect(source).toContain("await assertPortReleased(port)");
    expect(source).toContain("assertSnapshotUnchanged(workspaceDatabase, workspaceBefore)");
    expect(source).not.toMatch(/taskkill|Stop-Process|pkill|killall/i);
  });

  it("provides runtime occupied-port proof before SQLite initialization", () => {
    expect(source).toContain('args.includes("--occupied-port")');
    expect(source).toContain("occupiedPortMode ? await listenOnSelectedPort() : null");
    expect(source).toContain('spawnHost(appRoot, entry, trayMode ? ["--host"] : [], env)');
    expect(source).toContain("await awaitExit(owned, START_TIMEOUT_MS)");
    expect(source).toContain("result.code === null || result.code === 0");
    expect(source).toContain('const sqliteArtifacts = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]');
    expect(source).toContain("fs.watch(path.dirname(databasePath)");
    expect(source).toContain("observedSqliteArtifacts.has(candidate) || fs.existsSync(candidate)");
    expect(source).toContain("sqliteWatcher?.close()");
    expect(source).toContain("await assertListenerAccepting(port)");
    expect(source).toContain("await closeListener(occupiedListener.server)");
  });

  it("does not launch browsers or modify Startup", () => {
    expect(source).not.toMatch(/startup|start-process|cmd.exe|explorer.exe|open-home/i);
  });
});
