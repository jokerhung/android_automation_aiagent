import { autostartMutationSchema, autostartStatusSchema } from "@/lib/contracts/system";
import { safeError } from "@/lib/server/logging/redaction";
import { RateLimiter } from "@/lib/server/rate-limiter";
import {
  getLocalSessionCsrfToken,
  getVerifiedSystemApiPeer,
  secureSystemApiRequest,
} from "@/lib/server/system-api-guard";
import {
  getAutostartStatus,
  setAutostartEnabled,
} from "@/lib/server/platform/windows/autostart";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024;
const READ_TIMEOUT_MS = 2_000;
const STATUS_TIMEOUT_MS = 5_000;
const MUTATION_TIMEOUT_MS = 10_000;
const mutationLimiter = new RateLimiter();

class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  return Response.json(
    { ok: false, error: { code: "AUTOSTART_FAILED", message: safeError(error) } },
    { status: 500 },
  );
}

async function withDeadline<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ApiError("AUTOSTART_TIMEOUT", "Autostart operation timed out", 504));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readStrictJson(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new ApiError("INVALID_BODY", "Invalid Content-Length", 400);
    }
    if (size > MAX_BODY_BYTES) {
      throw new ApiError("BODY_TOO_LARGE", "Request body exceeds 1024 bytes", 413);
    }
  }
  if (!request.body) throw new ApiError("INVALID_BODY", "JSON body is required", 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel("body read timeout");
      reject(new ApiError("BODY_TIMEOUT", "Request body read timed out", 408));
    }, READ_TIMEOUT_MS);
  });
  try {
    await Promise.race([
      (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_BODY_BYTES) {
            void reader.cancel("body too large");
            throw new ApiError("BODY_TOO_LARGE", "Request body exceeds 1024 bytes", 413);
          }
          chunks.push(value);
        }
      })(),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError("INVALID_BODY", "Body must be valid JSON", 400);
  }
}

export async function GET(request: Request): Promise<Response> {
  const denied = secureSystemApiRequest(request);
  if (denied) return denied;
  try {
    const status = autostartStatusSchema.parse(
      await withDeadline(STATUS_TIMEOUT_MS, signal =>
        getAutostartStatus(process.cwd(), { signal }),
      ),
    );
    return Response.json({
      ok: true,
      data: { ...status, csrfToken: getLocalSessionCsrfToken() },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const denied = secureSystemApiRequest(request, { mutation: true });
  if (denied) return denied;
  const peer = getVerifiedSystemApiPeer(request) ?? "missing";
  if (!mutationLimiter.check(`autostart:${peer}`, 10, 60_000)) {
    return Response.json(
      { ok: false, error: { code: "RATE_LIMITED", message: "Too many autostart mutations" } },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
  try {
    const body = autostartMutationSchema.parse(await readStrictJson(request));
    const status = autostartStatusSchema.parse(
      await withDeadline(MUTATION_TIMEOUT_MS, signal =>
        setAutostartEnabled(body.enabled, process.cwd(), { signal }),
      ),
    );
    return Response.json({ ok: true, data: status });
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) {
      return Response.json(
        { ok: false, error: { code: "INVALID_AUTOSTART_REQUEST", message: safeError(error) } },
        { status: 400 },
      );
    }
    return errorResponse(error);
  }
}
