import { afterEach, describe, expect, it, vi } from "vitest";
import { runRequestSchema } from "@/lib/contracts/schemas";

const { getSettings } = vi.hoisted(() => ({ getSettings: vi.fn((): Record<string, unknown> => ({})) }));
vi.mock("@/lib/server/persistence/session-repository", () => ({ sessionRepository: { getSettings } }));
import { getRuntimeSettings } from "@/lib/server/runtime-settings";

afterEach(() => { vi.unstubAllEnvs(); getSettings.mockReset(); getSettings.mockReturnValue({}); });

describe("maximum steps", () => {
  it("defaults to 100 without configuration", () => {
    vi.stubEnv("MAX_STEPS", undefined);
    expect(getRuntimeSettings().maxSteps).toBe(100);
  });
  it("allows 100 and rejects values outside 1–100", () => {
    const input = { goal: "Test", deviceSerial: "test-device" };
    expect(runRequestSchema.parse({ ...input, maxSteps: 100 }).maxSteps).toBe(100);
    for (const maxSteps of [0, 101, 1.5]) expect(runRequestSchema.safeParse({ ...input, maxSteps }).success).toBe(false);
  });
  it("preserves explicitly saved settings and caps them at 100", () => {
    getSettings.mockReturnValue({ maxSteps: 25 });
    expect(getRuntimeSettings().maxSteps).toBe(25);
    getSettings.mockReturnValue({ maxSteps: 200 });
    expect(getRuntimeSettings().maxSteps).toBe(100);
  });
  it("validates environment overrides", () => {
    vi.stubEnv("MAX_STEPS", "100");
    expect(getRuntimeSettings().maxSteps).toBe(100);
    vi.stubEnv("MAX_STEPS", "200");
    expect(getRuntimeSettings().maxSteps).toBe(100);
    vi.stubEnv("MAX_STEPS", "invalid");
    expect(getRuntimeSettings().maxSteps).toBe(100);
  });
});
