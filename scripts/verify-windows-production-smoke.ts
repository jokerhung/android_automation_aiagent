import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getWindowsInstallationPaths } from "../lib/server/platform/windows/paths";
import { readBackgroundMetadata, type BackgroundMetadata } from "../lib/server/platform/windows/background-status";
import { probeBackground, stopBackground } from "../lib/server/platform/windows/control-pipe";

const HOST = "127.0.0.1";
const START_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 15_000;
const POLL_MS = 200;
const OUTPUT_LIMIT = 32 * 1024;

type FileSnapshot = { exists: false } | { exists: true; size: number; mtimeMs: number };
type CapturedChild = {
  child: ChildProcess;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stdout: () => string;
  stderr: () => string;
};

const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

function snapshot(file: string): FileSnapshot {
  try {
    const stat = fs.statSync(file);
    return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
    throw error;
  }
}

function assertSnapshotUnchanged(file: string, before: FileSnapshot) {
  const after = snapshot(file);
  const unchanged = before.exists
    ? after.exists && after.size === before.size && after.mtimeMs === before.mtimeMs
    : !after.exists;
  if (!unchanged) throw new Error(`Workspace database changed during smoke: ${file}`);
}

async function listenOnSelectedPort() {
  const server = net.createServer(socket => socket.end("occupied-port-smoke\n"));
  await new Promise<void>((resolve, reject) => server.listen({ host: HOST, port: 0, exclusive: true }, resolve).once("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not select a loopback port");
  }
  return { server, port: address.port };
}

async function selectFreePort() {
  const { server, port } = await listenOnSelectedPort();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function assertListenerAccepting(port: number) {
  await new Promise<void>((resolve, reject) => {
    const socket = net.connect({ host: HOST, port });
    const timeout = setTimeout(() => socket.destroy(new Error("Timed out connecting to occupied-port listener")), 2_000);
    socket.once("data", () => { clearTimeout(timeout); socket.destroy(); resolve(); });
    socket.once("error", error => { clearTimeout(timeout); reject(error); });
  });
}

async function closeListener(server: net.Server) {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

function boundedCollector(stream: NodeJS.ReadableStream | null) {
  let value = "";
  stream?.setEncoding("utf8");
  stream?.on("data", chunk => {
    value += String(chunk);
    while (Buffer.byteLength(value, "utf8") > OUTPUT_LIMIT) value = value.slice(Math.ceil(value.length / 8));
  });
  return () => value;
}

function spawnHost(appRoot: string, entry: string, extraArgs: string[], env: NodeJS.ProcessEnv): CapturedChild {
  const child = spawn(process.execPath, ["--import", "tsx", entry, ...extraArgs], {
    cwd: appRoot,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = boundedCollector(child.stdout);
  const stderr = boundedCollector(child.stderr);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return { child, exited, stdout, stderr };
}

async function waitUntil<T>(description: string, timeoutMs: number, operation: () => Promise<T | null>) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await operation();
      if (result !== null) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(POLL_MS);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${String(lastError)}` : ""}`);
}

async function waitForHealth(port: number, owned: CapturedChild) {
  return waitUntil("successful /api/health", START_TIMEOUT_MS, async () => {
    if (owned.child.exitCode !== null || owned.child.signalCode !== null) {
      throw new Error(`Host exited early (code=${owned.child.exitCode}, signal=${owned.child.signalCode})`);
    }
    const response = await fetch(`http://${HOST}:${port}/api/health`, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return null;
    const body = await response.json() as { ok?: boolean };
    return body.ok === true ? body : null;
  });
}

async function awaitExit(owned: CapturedChild, timeoutMs: number) {
  return Promise.race([
    owned.exited,
    delay(timeoutMs).then(() => { throw new Error("Timed out waiting for owned child to exit"); }),
  ]);
}

async function terminateOwnedChild(owned: CapturedChild) {
  if (owned.child.exitCode !== null || owned.child.signalCode !== null) return;
  owned.child.kill("SIGTERM");
  try {
    await awaitExit(owned, STOP_TIMEOUT_MS);
  } catch {
    if (owned.child.exitCode === null && owned.child.signalCode === null) owned.child.kill("SIGKILL");
    await awaitExit(owned, 5_000);
  }
}

async function assertPortReleased(port: number) {
  await waitUntil("loopback port release", STOP_TIMEOUT_MS, async () => {
    const server = net.createServer();
    try {
      await new Promise<void>((resolve, reject) => server.listen({ host: HOST, port, exclusive: true }, resolve).once("error", reject));
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      return true;
    } catch {
      server.close();
      return null;
    }
  });
}

async function waitForTrayMetadata(metadataPath: string, owned: CapturedChild) {
  return waitUntil("ready tray metadata", START_TIMEOUT_MS, async () => {
    if (owned.child.exitCode !== null || owned.child.signalCode !== null) {
      throw new Error(`Tray host exited early (code=${owned.child.exitCode}, signal=${owned.child.signalCode})`);
    }
    const metadata = readBackgroundMetadata({ metadataPath } as ReturnType<typeof getWindowsInstallationPaths>);
    return metadata?.ready && metadata.trayReady && metadata.port > 0 ? metadata : null;
  });
}

async function main() {
  const args = process.argv.slice(2);
  const trayMode = args.includes("--tray");
  const occupiedPortMode = args.includes("--occupied-port");
  const startupStopMode = args.includes("--stop-during-startup");
  if ([trayMode, occupiedPortMode, startupStopMode].filter(Boolean).length > 1) {
    throw new Error("--tray, --occupied-port, and --stop-during-startup cannot be combined");
  }
  if (trayMode && process.platform !== "win32") throw new Error("--tray production smoke is supported only on Windows");

  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (!fs.existsSync(path.join(appRoot, ".next", "BUILD_ID"))) throw new Error("BUILD_MISSING: run a production build first");

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "android-agent-production-smoke-"));
  const databasePath = path.resolve(fixture, "data", "app.db");
  const sqliteArtifacts = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
  const observedSqliteArtifacts = new Set<string>();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqliteWatcher = occupiedPortMode ? fs.watch(path.dirname(databasePath), (_event, filename) => {
    if (!filename) return;
    const changed = path.join(path.dirname(databasePath), filename.toString());
    if (sqliteArtifacts.includes(changed)) observedSqliteArtifacts.add(changed);
  }) : null;
  const workspaceDatabase = path.join(appRoot, "data", "app.db");
  const workspaceBefore = snapshot(workspaceDatabase);
  const occupiedListener = occupiedPortMode ? await listenOnSelectedPort() : null;
  const port = occupiedListener?.port ?? await selectFreePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    ANDROID_AGENT_DATABASE_PATH: databasePath,
    LOCALAPPDATA: path.join(fixture, "local-app-data"),
    PORT: String(port),
    HOST,
    SCRCPY_INTEGRATION: "snapshot",
  };
  Object.assign(process.env, {
    ANDROID_AGENT_DATABASE_PATH: env.ANDROID_AGENT_DATABASE_PATH,
    LOCALAPPDATA: env.LOCALAPPDATA,
  });
  const paths = getWindowsInstallationPaths(appRoot);
  const entry = trayMode ? path.join(appRoot, "scripts", "start-background.ts") : path.join(appRoot, "server.ts");
  let owned: CapturedChild | null = null;
  let metadata: BackgroundMetadata | null = null;
  let failure: unknown;

  try {
    owned = spawnHost(appRoot, entry, trayMode ? ["--host"] : [], env);
    if (occupiedPortMode) {
      const result = await awaitExit(owned, START_TIMEOUT_MS);
      if (result.code === null || result.code === 0) {
        throw new Error(`Occupied-port host did not exit nonzero (code=${result.code}, signal=${result.signal})`);
      }
      await delay(50); // Allow fs.watch notifications from the child to drain before asserting.
      for (const candidate of sqliteArtifacts) {
        if (observedSqliteArtifacts.has(candidate) || fs.existsSync(candidate)) {
          throw new Error(`SQLite artifact was created before bind failure: ${candidate}`);
        }
      }
      assertSnapshotUnchanged(workspaceDatabase, workspaceBefore);
      await assertListenerAccepting(port);
    } else if (startupStopMode) {
      metadata = await waitUntil("starting authenticated metadata", START_TIMEOUT_MS, async () => {
        if (owned!.child.exitCode !== null || owned!.child.signalCode !== null) {
          throw new Error(`Host exited before startup stop (code=${owned!.child.exitCode}, signal=${owned!.child.signalCode})`);
        }
        const current = readBackgroundMetadata(paths);
        return current && !current.ready && await probeBackground(current) ? current : null;
      });
      await stopBackground(metadata);
      const result = await awaitExit(owned, STOP_TIMEOUT_MS);
      if (result.code !== 0) throw new Error(`Startup-stop host exited unsuccessfully (code=${result.code}, signal=${result.signal})`);
      if (fs.existsSync(paths.lockPath) || fs.existsSync(paths.metadataPath)) {
        throw new Error("Owned lock or metadata remained after authenticated startup cancellation");
      }
    } else {
      if (trayMode) metadata = await waitForTrayMetadata(paths.metadataPath, owned);
      await waitForHealth(port, owned);
      if (!fs.existsSync(databasePath)) throw new Error(`Temporary database was not created: ${databasePath}`);
      assertSnapshotUnchanged(workspaceDatabase, workspaceBefore);

      if (trayMode) {
        await stopBackground(metadata!);
      } else {
        owned.child.kill("SIGTERM");
      }
      const result = await awaitExit(owned, STOP_TIMEOUT_MS);
      const expectedSigterm = !trayMode && result.code === null && result.signal === "SIGTERM";
      if (result.code !== 0 && !expectedSigterm) throw new Error(`Host exited unsuccessfully (code=${result.code}, signal=${result.signal})`);
      if (trayMode && (fs.existsSync(paths.lockPath) || fs.existsSync(paths.metadataPath))) {
        throw new Error("Owned tray lock or metadata remained after authenticated shutdown");
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    if (owned) {
      try { await terminateOwnedChild(owned); } catch (error) { failure ??= error; }
    }
    if (occupiedListener) {
      try { await assertListenerAccepting(port); } catch (error) { failure ??= error; }
      try { await closeListener(occupiedListener.server); } catch (error) { failure ??= error; }
    }
    try { await assertPortReleased(port); } catch (error) { failure ??= error; }
    try { assertSnapshotUnchanged(workspaceDatabase, workspaceBefore); } catch (error) { failure ??= error; }
    try { sqliteWatcher?.close(); } catch (error) { failure ??= error; }
    try { fs.rmSync(fixture, { recursive: true, force: true }); } catch (error) { failure ??= error; }
  }

  if (failure) {
    const output = owned ? `
--- bounded stdout ---
${owned.stdout()}
--- bounded stderr ---
${owned.stderr()}` : "";
    throw new Error(String(failure) + output);
  }
  console.log(JSON.stringify({ ok: true, mode: occupiedPortMode ? "occupied-port" : startupStopMode ? "startup-stop" : trayMode ? "tray" : "http", port }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
