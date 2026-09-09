// Isolated UI regression: no real server, database, device or model calls.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { build } = require("esbuild");
const { chromium } = require("../vendor/ws-scrcpy-web/node_modules/playwright");

(async () => {
  const bundle = await build({
    stdin: {
      contents: 'import React from "react";import {createRoot} from "react-dom/client";import AppShell from "./components/app-shell";createRoot(document.getElementById("root")).render(<AppShell/>);',
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1234/chrome-win64/chrome.exe",
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(5000);
    await page.addInitScript(() => {
      window.testSources = [];
      window.EventSource = class extends EventTarget {
        static CLOSED = 2;
        constructor(url) { super(); this.url = url; window.testSources.push(this); }
        close() { window.testSources = window.testSources.filter(source => source !== this); }
      };
      window.emitJob = data => {
        for (const source of [...window.testSources]) {
          if (source.url === "/api/schedules/events") {
            source.dispatchEvent(new MessageEvent("schedule.updated", { data: JSON.stringify(data) }));
          }
        }
      };
    });
    const css = ["globals", "schedule", "theme"].map(name => fs.readFileSync("app/" + name + ".css", "utf8")).join("\n");
    const conversation = (id, title, status = "running") => ({
      id, title, deviceSerial: "job-device", createdAt: "2026-09-09T01:00:00Z", updatedAt: "2026-09-09T01:00:00Z",
      messages: [{ id: id + "-msg", role: "user", content: "Prompt " + id, createdAt: "2026-09-09T01:00:00Z" }],
      runs: [{ id: id + "-run", status, deviceSerial: "job-device", maxSteps: 100, steps: [] }],
    });
    const manual = conversation("manual", "Manual conversation", "completed");
    const jobs = { manual, job1: conversation("job1", "Scheduled job one"), job2: conversation("job2", "Scheduled job two") };
    let list = [manual];
    let requestedJobs = 0;
    await page.route("http://job.test/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/") return route.fulfill({ contentType: "text/html", body: '<style>' + css + '</style><div id="root"></div>' });
      let data;
      if (pathname === "/api/settings") data = { maxSteps: 100 };
      else if (pathname === "/api/devices") data = [{ serial: "job-device", state: "device", displayName: "Job device" }];
      else if (pathname === "/api/schedules") data = [];
      else if (pathname === "/api/conversations") data = list;
      else if (pathname.startsWith("/api/conversations/")) {
        const id = pathname.split("/").at(-1);
        data = jobs[id];
        if (id.startsWith("job")) requestedJobs++;
      } else if (pathname.endsWith("/stream")) {
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: false }) });
      } else throw new Error("Unexpected request: " + pathname);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
    });
    await page.goto("http://job.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole("heading", { name: manual.title, exact: true }).waitFor();
    await page.locator(".scheduleNav").click();
    await page.locator(".schedulePanel").waitFor();

    // Non-start events must not change the view.
    await page.evaluate(() => window.emitJob({ status: "waiting_device", scheduleId: "s1" }));
    assert.equal(await page.locator(".schedulePanel").count(), 1);
    list = [jobs.job1, manual];
    const first = { status: "running", scheduleId: "s1", conversationId: "job1", runId: "job1-run" };
    await page.evaluate(data => window.emitJob(data), first);
    await page.getByRole("heading", { name: jobs.job1.title, exact: true }).waitFor();
    assert.equal(await page.locator(".schedulePanel").count(), 0);
    assert.equal(await page.locator(".device select").inputValue(), "job-device");
    await page.locator(".conversations").getByText(jobs.job1.title, { exact: true }).waitFor();
    await page.waitForFunction(() => window.testSources.some(source => source.url === "/api/runs/job1-run/events"));

    // A duplicate must not pull the user back after they return to schedules.
    await page.locator(".scheduleNav").click();
    await page.evaluate(data => window.emitJob(data), first);
    assert.equal(await page.locator(".schedulePanel").count(), 1);
    assert.equal(requestedJobs, 1);

    // Global subscription still works while another chat is displayed.
    await page.getByRole("button", { name: "Về hội thoại", exact: true }).click();
    list = [jobs.job2, jobs.job1, manual];
    await page.evaluate(() => window.emitJob({ status: "running", scheduleId: "s2", conversationId: "job2", runId: "job2-run" }));
    await page.getByRole("heading", { name: jobs.job2.title, exact: true }).waitFor();
    await page.waitForFunction(() => window.testSources.some(source => source.url === "/api/runs/job2-run/events"));
    assert.equal(requestedJobs, 2);
    console.log("PASS: schedule-to-chat, chat-to-job, device selection, history refresh, live events, duplicate suppression");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
