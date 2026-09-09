import { beforeEach, describe, expect, it, vi } from "vitest";
const child = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => child);
import { openHomePage } from "@/lib/server/platform/windows/open-home";

beforeEach(() => child.execFile.mockReset());
function complete(error: Error | null, stdout = "", stderr = "") {
  child.execFile.mock.calls[0].at(-1)(error, stdout, stderr);
}
describe("Windows homepage launcher", () => {
  it("waits for acknowledgement and preserves the server port", async () => {
    const promise = openHomePage(process.cwd(), "http://127.0.0.1:4001/");
    const [, args, options] = child.execFile.mock.calls[0];
    expect(args.slice(-2)).toEqual(["-HomeUrl", "http://127.0.0.1:4001/"]);
    expect(options).toMatchObject({ windowsHide: true, timeout: 10000 });
    expect(options).not.toHaveProperty("detached");
    complete(null, "HOME_OPENED\r\n");
    await expect(promise).resolves.toBeUndefined();
  });
  it("rejects process failure with captured stderr", async () => {
    const promise = openHomePage(process.cwd(), "http://127.0.0.1:4001/");
    complete(new Error("exit 1"), "", "No HTTP application registered");
    await expect(promise).rejects.toThrow("No HTTP application registered");
  });
  it("reports spawn errors and timeout instead of ignoring them", async () => {
    for (const message of ["ENOENT", "timeout"]) {
      child.execFile.mockReset();
      const promise = openHomePage(process.cwd(), "http://127.0.0.1:4001/");
      complete(new Error(message));
      await expect(promise).rejects.toThrow(message);
    }
  });
  it("does not claim success without helper acknowledgement", async () => {
    const promise = openHomePage(process.cwd(), "http://127.0.0.1:4001/");
    complete(null);
    await expect(promise).rejects.toThrow("did not acknowledge");
  });
  it("rejects foreign URLs before starting a process", async () => {
    for (const url of ["https://example.com/", "http://127.0.0.1:4001/&calc.exe", "http://user@127.0.0.1/"]) {
      await expect(openHomePage(process.cwd(), url)).rejects.toThrow("non-loopback");
    }
    expect(child.execFile).not.toHaveBeenCalled();
  });
});
