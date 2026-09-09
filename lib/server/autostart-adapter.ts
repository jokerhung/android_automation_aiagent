import "@/lib/server/server-guard";
import type { AutostartStatus } from "@/lib/contracts/system";
import {
  getAutostartStatus as getWindowsAutostartStatus,
  setAutostartEnabled as setWindowsAutostartEnabled,
} from "@/lib/server/platform/windows/autostart";

export type AutostartOperationOptions = { signal: AbortSignal };
export type AutostartAdapter = {
  getStatus(options: AutostartOperationOptions): Promise<AutostartStatus>;
  setEnabled(enabled: boolean, options: AutostartOperationOptions): Promise<AutostartStatus>;
};

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Autostart operation aborted", "AbortError");
}

let adapter: AutostartAdapter = {
  async getStatus({ signal }) {
    throwIfAborted(signal);
    const status = await getWindowsAutostartStatus(process.cwd(), { signal });
    throwIfAborted(signal);
    return status;
  },
  async setEnabled(enabled, { signal }) {
    throwIfAborted(signal);
    const status = await setWindowsAutostartEnabled(enabled, process.cwd(), { signal });
    throwIfAborted(signal);
    return status;
  },
};

/** Dependency injection seam for route tests; never calls the real Startup folder. */
export function configureAutostartAdapter(next: AutostartAdapter): void {
  adapter = next;
}

export function getAutostartStatus(options: AutostartOperationOptions): Promise<AutostartStatus> {
  return adapter.getStatus(options);
}

export function setAutostartEnabled(
  enabled: boolean,
  options: AutostartOperationOptions,
): Promise<AutostartStatus> {
  return adapter.setEnabled(enabled, options);
}
