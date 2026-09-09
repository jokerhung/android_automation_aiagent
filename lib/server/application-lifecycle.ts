import { openHomePage } from "./platform/windows/open-home";
export { openHomePage, isSafeHomeUrl } from "./platform/windows/open-home";
import {
  createServer,
  type RequestListener,
  type Server as HttpServer,
} from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import next from "next";
import {
  resetApplicationAdmissions,
  stopApplicationAdmissions,
} from "./application-admission";
import {
  appendBackgroundLog,
  removeOwnedMetadata,
  writeBackgroundMetadata,
  type BackgroundMetadata,
} from "./platform/windows/background-status";
import { createControlPipe } from "./platform/windows/control-pipe";
import type { InstanceLock } from "./platform/windows/instance-lock";
import {
  WindowsTrayController,
  type TrayEvent,
} from "./platform/windows/tray-controller";
import { createShutdownSequence } from "./shutdown-sequence";
import { protectSystemApiPeerHeaders } from "./system-api-guard";

export type ShutdownReason =
  | "SIGINT"
  | "SIGTERM"
  | "tray"
  | "control-pipe"
  | "tray-lost"
  | "startup-error"
  | "application";

export type ApplicationOptions = {
  instanceLock: InstanceLock;
  mode: "development" | "foreground" | "background";
  host?: string;
  port?: number;
  tray?: boolean;
  onShutdownFailure?: (error: unknown) => void;
};

export class StartupCancelledError extends Error {
  constructor() {
    super("STARTUP_CANCELLED: shutdown requested during startup");
    this.name = "StartupCancelledError";
  }
}

export type ApplicationLifecycle = {
  homeUrl: string;
  shutdown: (reason?: ShutdownReason) => Promise<void>;
  ready: Promise<void>;
};

type RuntimeServices = {
  sessionRepository: (typeof import("./persistence/session-repository"))["sessionRepository"];
  deviceMonitor: (typeof import("./device-monitor"))["deviceMonitor"];
  getRuntimeSettings: (typeof import("./runtime-settings"))["getRuntimeSettings"];
  streamSessionManager: (typeof import("./scrcpy/stream-session-manager"))["streamSessionManager"];
  agentRunner: (typeof import("./agent/agent-runner"))["agentRunner"];
  scheduleRepository: (typeof import("./schedule/schedule-repository"))["scheduleRepository"];
  scheduleService: (typeof import("./schedule/schedule-service"))["scheduleService"];
  gplScrcpyBridge: (typeof import("./scrcpy/gpl-scrcpy-bridge"))["gplScrcpyBridge"];
};

const STARTING_HANDLER: RequestListener = (_request, response) => {
  response.statusCode = 503;
  response.setHeader("Retry-After", "1");
  response.end("Android Agent is starting");
};

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function listen(
  server: {
    listen: (...args: any[]) => unknown;
    once: (event: string, listener: (error: Error) => void) => unknown;
  },
  ...args: unknown[]
) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(...args, resolve);
  });
}

function closeServer(
  server: { close: (callback: (error?: Error) => void) => unknown },
  listening = true,
) {
  return new Promise<void>((resolve, reject) => {
    if (!listening) {
      resolve();
      return;
    }

    try {
      server.close((error) => (error ? reject(error) : resolve()));
    } catch (error) {
      reject(error);
    }
  });
}

function safeLog(options: ApplicationOptions, message: string) {
  try {
    appendBackgroundLog(options.instanceLock.paths, message);
  } catch (error) {
    console.error("Could not write background lifecycle log", error);
  }
}

function writeMetadata(
  options: ApplicationOptions,
  metadata: BackgroundMetadata,
) {
  try {
    writeBackgroundMetadata(options.instanceLock.paths, metadata);
  } catch (error) {
    console.error("Could not update background metadata", error);
  }
}


async function importRuntimeServices(): Promise<RuntimeServices> {
  const [
    sessions,
    monitor,
    settings,
    streams,
    runner,
    schedules,
    scheduler,
    bridge,
  ] = await Promise.all([
    import("./persistence/session-repository"),
    import("./device-monitor"),
    import("./runtime-settings"),
    import("./scrcpy/stream-session-manager"),
    import("./agent/agent-runner"),
    import("./schedule/schedule-repository"),
    import("./schedule/schedule-service"),
    import("./scrcpy/gpl-scrcpy-bridge"),
  ]);

  return {
    sessionRepository: sessions.sessionRepository,
    deviceMonitor: monitor.deviceMonitor,
    getRuntimeSettings: settings.getRuntimeSettings,
    streamSessionManager: streams.streamSessionManager,
    agentRunner: runner.agentRunner,
    scheduleRepository: schedules.scheduleRepository,
    scheduleService: scheduler.scheduleService,
    gplScrcpyBridge: bridge.gplScrcpyBridge,
  };
}

export async function startApplication(
  options: ApplicationOptions,
): Promise<ApplicationLifecycle> {
  resetApplicationAdmissions();

  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    options.instanceLock.release();
    throw new Error("PORT must be an integer from 1 to 65535");
  }

  const dev = process.env.NODE_ENV !== "production";
  const homeUrl = `http://127.0.0.1:${port}/`;
  const app = next({ dev, hostname: host, port });
  const sockets = new Set<Socket>();

  let requestHandler: RequestListener = STARTING_HANDLER;
  let upgradeHandler:
    | ((request: any, socket: any, head: any) => void)
    | null = null;
  let runtime: RuntimeServices | undefined;
  let tray: WindowsTrayController | null = null;
  let trayRestarting = false;
  let httpListening = false;
  let controlListening = false;
  let stopping: Promise<void> | null = null;
  let shutdownReason: ShutdownReason = "application";
  let startupSettled = false;
  let resolveStartupSettled!: () => void;
  const startupSettledPromise = new Promise<void>((resolve) => {
    resolveStartupSettled = resolve;
  });
  const settleStartup = () => {
    if (startupSettled) return;
    startupSettled = true;
    resolveStartupSettled();
  };

  const metadata: BackgroundMetadata = {
    version: 1,
    appRoot: options.instanceLock.paths.appRoot,
    installationId: options.instanceLock.paths.installationId,
    instanceId: options.instanceLock.record.instanceId,
    pid: process.pid,
    startedAt: options.instanceLock.record.startedAt,
    mode: options.mode,
    pipeName: options.instanceLock.record.pipeName,
    token: options.instanceLock.token,
    port,
    ready: false,
    trayReady: false,
  };

  const http: HttpServer = createServer((request, response) => {
    protectSystemApiPeerHeaders(
      request.headers,
      request.socket.remoteAddress,
    );
    return requestHandler(request, response);
  });
  http.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  http.on("upgrade", (request, socket, head) => {
    protectSystemApiPeerHeaders(
      request.headers,
      request.socket.remoteAddress,
    );
    if (upgradeHandler) {
      upgradeHandler(request, socket, head);
      return;
    }
    socket.destroy();
  });

  const control = createControlPipe({
    metadata,
    onStop: () => void shutdown("control-pipe"),
  });

  const runShutdownSequence = createShutdownSequence({
    deadlineMs: 10_000,
    closeAdmissions: () =>
      stopApplicationAdmissions("Android Agent is shutting down"),
    onFailure: (step, error) => {
      safeLog(
        options,
        `shutdown step failed (${step}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      console.error(`Shutdown step failed: ${step}`, error);
    },
    onTimeout: (step) =>
      safeLog(options, `shutdown deadline exceeded during: ${step}`),
    steps: [
      {
        name: "startup cancellation",
        critical: true,
        run: () => startupSettledPromise,
      },
      {
        name: "scheduler/event/log drain",
        critical: true,
        run: () => runtime?.scheduleService.stop(),
      },
      { name: "device monitor", run: () => runtime?.deviceMonitor.stop() },
      { name: "agent runner", run: () => runtime?.agentRunner.shutdown(4_000) },
      {
        name: "stream sessions",
        run: () => {
          runtime?.streamSessionManager.closeAll();
        },
      },
      { name: "scrcpy bridge", run: () => runtime?.gplScrcpyBridge.close() },
      {
        name: "http sockets",
        run: () => {
          for (const socket of sockets) socket.destroy();
        },
      },
      {
        name: "http server",
        run: async () => {
          await closeServer(http, httpListening);
          httpListening = false;
        },
      },
      { name: "next application", run: () => app.close() },
      { name: "tray", run: () => tray?.dispose() },
      { name: "database", run: () => runtime?.sessionRepository.close() },
    ],
  });

  function assertStartupActive() {
    if (stopping) {
      throw new StartupCancelledError();
    }
  }

  async function shutdown(reason: ShutdownReason = "application") {
    if (!stopping) {
      shutdownReason = reason;
      safeLog(options, `shutdown requested: ${reason}`);
      stopping = (async () => {
        let cleanupSafe = false;
        try {
          await runShutdownSequence();
          cleanupSafe = true;
        } finally {
          try {
            await Promise.race([
              closeServer(control, controlListening),
              delay(500),
            ]);
          } catch (error) {
            console.error("Control pipe cleanup failed", error);
          } finally {
            controlListening = false;
          }

          if (cleanupSafe) {
            try {
              removeOwnedMetadata(
                options.instanceLock.paths,
                metadata.token,
                metadata.instanceId,
              );
            } catch (error) {
              console.error("Metadata cleanup failed", error);
            }

            try {
              options.instanceLock.release();
            } catch (error) {
              console.error("Instance lock cleanup failed", error);
            }
          } else {
            safeLog(
              options,
              "shutdown incomplete; retaining instance lock until process termination",
            );
          }
        }
      })();
    }

    try {
      await stopping;
    } catch (error) {
      safeLog(
        options,
        `shutdown failed (${shutdownReason}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      options.onShutdownFailure?.(error);
      throw error;
    }
  }

  let openingHome = false;
  const onTrayEvent = (event: TrayEvent) => {
    if (event.event === "open-home") {
      if (openingHome || stopping) return;
      openingHome = true;
      safeLog(options, "tray open home requested: " + homeUrl);
      void openHomePage(options.instanceLock.paths.appRoot, homeUrl).then(() => {
        safeLog(options, "Windows accepted homepage request: " + homeUrl);
      }).catch(error => {
        safeLog(
          options,
          `open home failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        tray?.send({ command: "open-home-failed", message: "Không mở được trình duyệt. Mở thủ công: " + homeUrl });
      }).finally(() => { openingHome = false; });
    }

    if (event.event === "quit-requested") {
      tray?.confirmQuit(runtime?.agentRunner.stats().active ?? 0);
    }
    if (event.event === "quit-confirmed") void shutdown("tray");
    if (event.event === "error" && event.message) {
      safeLog(options, `tray error: ${event.message}`);
    }

    if (event.event === "lost" && !stopping && !trayRestarting) {
      trayRestarting = true;
      metadata.trayReady = false;
      writeMetadata(options, metadata);

      void (async () => {
        for (let attempt = 1; attempt <= 2 && !stopping; attempt++) {
          await delay(attempt * 500);
          try {
            await tray!.start({
              appRoot: options.instanceLock.paths.appRoot,
              homeUrl,
            });
            if (stopping) return;
            metadata.trayReady = true;
            writeMetadata(options, metadata);
            tray!.setStatus("Android Agent đang chạy", true);
            safeLog(options, `tray restarted on attempt ${attempt}`);
            return;
          } catch (error) {
            safeLog(
              options,
              `tray restart attempt ${attempt} failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }

        if (!stopping) await shutdown("tray-lost");
      })().finally(() => {
        trayRestarting = false;
      });
    }
  };

  try {
    // Keep the 503 startup handler active and claim the public port before any
    // import that can initialize SQLite or open runtime services.
    await listen(http, port, host);
    httpListening = true;
    assertStartupActive();

    writeBackgroundMetadata(options.instanceLock.paths, metadata);
    await listen(control, metadata.pipeName);
    controlListening = true;
    assertStartupActive();

    runtime = await importRuntimeServices();
    assertStartupActive();
    await app.prepare();
    assertStartupActive();

    const handle = app.getRequestHandler();
    const nextUpgrade = app.getUpgradeHandler();

    runtime.sessionRepository.pruneRunEvents(
      Number(process.env.EVENT_RETENTION_DAYS || 30),
    );
    runtime.scheduleRepository.pruneOccurrences(
      Number(process.env.SCHEDULE_RETENTION_DAYS || 365),
    );
    const recovered = runtime.sessionRepository.recoverInterruptedRuns();
    if (recovered) {
      console.log(
        `Đã đánh dấu ${recovered} tác vụ bị gián đoạn do server khởi động lại.`,
      );
    }

    await runtime.gplScrcpyBridge.initialize();
    assertStartupActive();
    requestHandler = (request, response) => handle(request, response);
    upgradeHandler = (request, socket, head) => {
      const url = new URL(
        request.url || "/",
        "http://" + (request.headers.host || host),
      );
      if (url.pathname === "/ws/scrcpy") {
        runtime!.gplScrcpyBridge.handleUpgrade(request, socket, head);
        return;
      }
      void nextUpgrade(request, socket, head);
    };

    runtime.deviceMonitor.start(runtime.getRuntimeSettings().deviceRefreshMs);
    runtime.scheduleService.start();

    if (options.tray) {
      tray = new WindowsTrayController();
      tray.onEvent(onTrayEvent);
      await tray.start({
        appRoot: options.instanceLock.paths.appRoot,
        homeUrl,
      });
      assertStartupActive();
      metadata.trayReady = true;
      tray.setStatus("Android Agent đang chạy", true);
    }

    assertStartupActive();
    metadata.ready = true;
    writeBackgroundMetadata(options.instanceLock.paths, metadata);
    settleStartup();
    console.log(
      `Android Vision Control listening on ${homeUrl} (bound to ${host})`,
    );

    return { homeUrl, shutdown, ready: Promise.resolve() };
  } catch (error) {
    settleStartup();
    await shutdown("startup-error");
    throw error;
  }
}
