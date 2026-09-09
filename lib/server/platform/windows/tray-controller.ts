import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";

export type TrayEvent = {
  event: "ready" | "open-home" | "quit-requested" | "quit-confirmed" | "error" | "disposed" | "lost";
  message?: string;
};

export class WindowsTrayController {
  private disposing = false;
  private child: ChildProcessWithoutNullStreams | null = null;
  private listeners = new Set<(event: TrayEvent) => void>();
  private readyPromise: Promise<void> | null = null;

  onEvent(listener: (event: TrayEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(options: { appRoot: string; homeUrl: string; status?: string; timeoutMs?: number }) {
    if (process.platform !== "win32") return Promise.reject(new Error("The Windows tray is only available on Windows"));
    if (this.readyPromise) return this.readyPromise;
    this.disposing = false;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const powershell = path.join(process.env.SystemRoot || String.raw`C:\Windows`, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const script = path.join(options.appRoot, "scripts", "windows", "tray.ps1");
      const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-File", script], {
        cwd: options.appRoot,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child = child;
      let ready = false;
      let stderr = "";
      const timeoutMs = options.timeoutMs ?? 15_000;
      const timer = setTimeout(() => {
        if (!ready) {
          reject(new Error(`Tray readiness timed out after ${timeoutMs}ms${stderr ? `: ${stderr}` : ""}`));
          void this.dispose();
        }
      }, timeoutMs);
      timer.unref();
      child.stdin.on("error", error => {
        if (!this.disposing) this.emit({ event: "error", message: error.message });
      });
      readline.createInterface({ input: child.stdout }).on("line", line => {
        if (line.length > 4096) return;
        try {
          const event = JSON.parse(line) as TrayEvent;
          if (event.event === "ready" && !ready) {
            ready = true;
            clearTimeout(timer);
            resolve();
          }
          this.emit(event);
        } catch {
          // Ignore non-protocol output; stderr is retained for readiness diagnostics.
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", data => {
        stderr = (stderr + String(data)).slice(-8192);
        const message = String(data).trim();
        if (message) this.emit({ event: "error", message });
      });
      this.send({ command: "initialize", homeUrl: options.homeUrl, status: options.status ?? "Android Agent đang khởi động" });
      child.once("error", error => {
        clearTimeout(timer);
        if (!ready) reject(error);
      });
      child.once("exit", code => {
        clearTimeout(timer);
        this.child = null;
        this.readyPromise = null;
        if (!ready) reject(new Error(`Tray exited before ready (${code ?? "unknown"})${stderr ? `: ${stderr}` : ""}`));
        else if (!this.disposing) this.emit({ event: "lost", message: `Tray helper exited (${code ?? "unknown"})` });
      });
    });
    return this.readyPromise;
  }

  send(command: unknown) {
    if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify(command) + "\n");
  }

  setStatus(status: string, homeEnabled = true) {
    this.send({ command: "set-status", status, homeEnabled });
  }

  confirmQuit(activeRuns: number) {
    this.send({ command: "confirm-quit", activeRuns });
  }

  async dispose(timeoutMs = 2_000) {
    const child = this.child;
    if (!child) return;
    this.disposing = true;
    await new Promise<void>(resolve => {
      const finish = () => {
        clearTimeout(timer);
        child.removeListener("exit", finish);
        resolve();
      };
      const timer = setTimeout(() => {
        if (this.child === child) child.kill();
        finish();
      }, timeoutMs);
      child.once("exit", finish);
      this.send({ command: "dispose" });
    });
  }

  private emit(event: TrayEvent) {
    for (const listener of this.listeners) listener(event);
  }
}
