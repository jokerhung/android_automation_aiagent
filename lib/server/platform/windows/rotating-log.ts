import fs from "node:fs";
import { redact } from "../../logging/redaction";

export const BACKGROUND_LOG_MAX_BYTES = 5 * 1024 * 1024;
export const BACKGROUND_LOG_MAX_FILES = 7;
export const BACKGROUND_LOG_MAX_LINE_BYTES = 16 * 1024;

export function scrubLogMessage(message: string) {
  return redact(message)
    .replace(/(\bAuthorization\s*[:=]\s*Bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(\bBearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(["\']?(?:api[_-]?key|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key)["\']?\s*[:=]\s*["\']?)[^"\'\s,;}]+/gi, "$1[REDACTED]")
    .replace(/data:image\/[^;\s]+;base64,[A-Za-z0-9+/=_-]+/gi, "[REDACTED]")
    .replace(/[\r\n]+/g, " ");
}

function boundUtf8(value: string, maxBytes: number) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return value;
  return bytes.subarray(0, maxBytes).toString("utf8").replace(/\uFFFD$/, "");
}

/** At most seven files including the active file; only lifecycle messages belong here. */
export function appendRotatingLog(file: string, message: string, maxBytes = BACKGROUND_LOG_MAX_BYTES) {
  const timestamp = `${new Date().toISOString()} `;
  const contentBudget = Math.max(0, Math.min(BACKGROUND_LOG_MAX_LINE_BYTES, maxBytes) - Buffer.byteLength(timestamp) - 1);
  const line = `${timestamp}${boundUtf8(scrubLogMessage(message), contentBudget)}\n`;
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (size && size + Buffer.byteLength(line) > maxBytes) {
    fs.rmSync(`${file}.6`, { force: true });
    for (let i = 5; i >= 1; i--) {
      if (fs.existsSync(`${file}.${i}`)) fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    }
    fs.renameSync(file, `${file}.1`);
  }
  fs.appendFileSync(file, line, { encoding: "utf8", mode: 0o600 });
}
