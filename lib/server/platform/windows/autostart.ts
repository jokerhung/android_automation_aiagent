import "@/lib/server/server-guard";
import path from "node:path";
import { execFile } from "node:child_process";
import type { AutostartStatus } from "@/lib/contracts/system";
import { getWindowsInstallationPaths } from "./paths";


export type AutostartOperationOptions = { signal?: AbortSignal };

let operation: Promise<void> = Promise.resolve();

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function serialized<T>(
  signal: AbortSignal | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const run = async () => {
    // This check must happen after earlier queue entries settle. It prevents an
    // HTTP request that timed out while queued from later touching Startup.
    throwIfAborted(signal);
    return work();
  };
  const next = operation.then(run, run);
  operation = next.then(() => undefined, () => undefined);
  return next;
}

function scriptPath(appRoot: string): string {
  return path.join(appRoot, "scripts", "windows", "autostart.ps1");
}

function autostartHelperError(error: Error, stderr: string): Error {
  const detail = `${error.message} ${stderr}`;
  if (/running scripts is disabled|cannot be loaded because running scripts|execution policies|PSSecurityException|UnauthorizedAccess/i.test(detail)) {
    return Object.assign(new Error("STARTUP_BLOCKED: PowerShell policy blocks the autostart helper; ask your administrator or review the current-user execution policy."), { code: "STARTUP_BLOCKED", cause: error });
  }
  return error;
}

async function invoke(
  action: "status" | "enable" | "disable",
  appRoot: string,
  signal?: AbortSignal,
): Promise<AutostartStatus> {
  throwIfAborted(signal);
  if (process.platform !== "win32") {
    return {
      supported: false,
      enabled: false,
      registration: "absent",
      backgroundReady: false,
      reason: "Windows only",
    };
  }

  // Avoid path/preflight work after cancellation and pass the same signal to
  // execFile so an in-flight PowerShell child is terminated on abort.
  throwIfAborted(signal);
  const paths = getWindowsInstallationPaths(appRoot);
  const powershell = path.join(
    process.env.SystemRoot || String.raw`C:\Windows`,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const launcher = path.join(paths.appRoot, "scripts", "windows", "launch-background.ps1");
  throwIfAborted(signal);
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        scriptPath(paths.appRoot),
        "-Action",
        action,
        "-AppRoot",
        paths.appRoot,
        "-InstallationId",
        paths.installationId,
        "-LauncherPath",
        launcher,
        "-NodePath",
        process.execPath,
      ],
      {
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 16_384,
        signal,
      },
      (error, output, stderr) => {
        if (error) reject(autostartHelperError(error, stderr));
        else resolve(output);
      },
    );
  });
  throwIfAborted(signal);
  return JSON.parse(stdout.trim()) as AutostartStatus;
}

export function getAutostartStatus(
  appRoot = process.cwd(),
  options: AutostartOperationOptions = {},
): Promise<AutostartStatus> {
  return serialized(options.signal, () => invoke("status", appRoot, options.signal));
}

export function setAutostartEnabled(
  enabled: boolean,
  appRoot = process.cwd(),
  options: AutostartOperationOptions = {},
): Promise<AutostartStatus> {
  return serialized(options.signal, () =>
    invoke(enabled ? "enable" : "disable", appRoot, options.signal),
  );
}
