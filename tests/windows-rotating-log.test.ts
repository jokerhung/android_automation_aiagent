import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { appendRotatingLog, BACKGROUND_LOG_MAX_BYTES, BACKGROUND_LOG_MAX_FILES, BACKGROUND_LOG_MAX_LINE_BYTES } from "@/lib/server/platform/windows/rotating-log";

it("rotates at 5MB and retains active plus six archives", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-log-"));
  try {
    const file = path.join(root, "background.log");
    fs.writeFileSync(file, Buffer.alloc(BACKGROUND_LOG_MAX_BYTES - 1, 0x78));
    appendRotatingLog(file, "rotation boundary");
    expect(fs.statSync(`${file}.1`).size).toBe(BACKGROUND_LOG_MAX_BYTES - 1);
    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(file, Buffer.alloc(BACKGROUND_LOG_MAX_BYTES, 0x78));
      appendRotatingLog(file, `rotation ${i}`);
    }
    const names = fs.readdirSync(root).filter(name => name.startsWith("background.log"));
    expect(names).toHaveLength(BACKGROUND_LOG_MAX_FILES);
    expect(names.sort()).toEqual(["background.log", "background.log.1", "background.log.2", "background.log.3", "background.log.4", "background.log.5", "background.log.6"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("redacts API keys, bearer tokens, and data images while bounding one line", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-log-"));
  try {
    const file = path.join(root, "background.log");
    appendRotatingLog(file, `api_key=super-secret-value OPENAI_API_KEY: another-secret Bearer very-private-token data:image/png;base64,AAAA${"x".repeat(BACKGROUND_LOG_MAX_LINE_BYTES * 2)}`);
    const result = fs.readFileSync(file, "utf8");
    expect(result).not.toContain("super-secret-value");
    expect(result).not.toContain("another-secret");
    expect(result).not.toContain("very-private-token");
    expect(result).not.toContain("data:image");
    expect(result).toContain("[REDACTED]");
    expect(Buffer.byteLength(result)).toBeLessThanOrEqual(BACKGROUND_LOG_MAX_LINE_BYTES);
    expect(result.split("\n")).toHaveLength(2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
