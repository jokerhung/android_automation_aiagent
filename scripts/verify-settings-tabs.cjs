// Offline component test: settings are mocked; no API or device is contacted.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { build } = require("esbuild");
const { chromium } = require("../vendor/ws-scrcpy-web/node_modules/playwright");

(async () => {
  const bundle = await build({
    stdin: {
      contents: `import React, {useState} from "react";import {createRoot} from "react-dom/client";import Dialog from "./components/settings-dialog";
      function Test(){const [open,setOpen]=useState(false);return <><button id="open" onClick={()=>setOpen(true)}>Open</button>{open&&<Dialog initial={{model:"test-model",baseUrl:"https://example.test/v1",maxSteps:100,screenRefreshMs:900,apiKeyConfigured:true}} onClose={()=>setOpen(false)} onSave={async draft=>{window.saved=draft;if(window.failSave)throw new Error("Test save failure");setOpen(false)}}/>}</>}
      createRoot(document.getElementById("root")).render(<Test/>);`,
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(5000);
    const css = ["globals", "schedule", "theme", "settings"].map(name => fs.readFileSync("app/" + name + ".css", "utf8")).join("\n");
    await page.setContent('<style>' + css + '</style><div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.locator("#open").click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(await page.getByRole("tab").count(), 3);
    assert.equal(await page.getByRole("tab", { name: "Chung" }).getAttribute("aria-selected"), "true");
    const stepsBox = await page.locator("#settings-steps").boundingBox();
    const refreshBox = await page.locator("#settings-refresh").boundingBox();
    assert.ok(Math.abs(stepsBox.x - refreshBox.x) < 1, "General textboxes must share the same left edge");
    assert.equal(stepsBox.width, refreshBox.width);
    await page.screenshot({ path: process.env.TEMP + "/settings-tabs-desktop.png" });
    await page.locator("#settings-steps").fill("75");
    await page.getByRole("tab", { name: "AI Model" }).click();
    await page.locator("#settings-model").fill("updated-model");
    assert.equal(await page.locator("#settings-key").inputValue(), "");
    await page.getByRole("tab", { name: "Chung" }).click();
    assert.equal(await page.locator("#settings-steps").inputValue(), "75");

    // Invalid hidden fields return to their panel and never submit.
    await page.locator("#settings-steps").fill("101");
    await page.getByRole("tab", { name: "AI Model" }).click();
    await page.getByRole("button", { name: "Lưu thay đổi" }).click();
    assert.equal(await page.getByRole("tab", { name: "Chung" }).getAttribute("aria-selected"), "true");
    await page.getByRole("alert").waitFor();
    await page.locator("#settings-steps").fill("75");
    await page.evaluate(() => { window.failSave = true; });
    await page.getByRole("button", { name: "Lưu thay đổi" }).click();
    await page.getByRole("alert").filter({ hasText: "Test save failure" }).waitFor();
    assert.equal(await dialog.count(), 1);
    await page.evaluate(() => { window.failSave = false; });
    await page.getByRole("button", { name: "Lưu thay đổi" }).click();
    await dialog.waitFor({ state: "detached" });
    const saved = await page.evaluate(() => window.saved);
    assert.equal(saved.maxSteps, 75);
    assert.equal(saved.model, "updated-model");
    assert.equal(saved.apiKey, "");

    await page.locator("#open").click();
    await page.getByRole("tab", { name: "Chung" }).press("ArrowDown");
    assert.equal(await page.getByRole("tab", { name: "AI Model" }).getAttribute("aria-selected"), "true");
    await page.getByRole("tab", { name: "AI Model" }).press("End");
    assert.equal(await page.getByRole("tab", { name: "Giới thiệu" }).getAttribute("aria-selected"), "true");
    await page.getByRole("button", { name: "Lưu thay đổi" }).press("Tab");
    assert.equal(await page.locator(".settingsClose").evaluate(el => el === document.activeElement), true);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(await page.locator("#open").evaluate(el => el === document.activeElement), true);

    await page.locator("#open").click();
    await page.locator("#settings-steps").fill("33");
    await page.getByRole("button", { name: "Hủy", exact: true }).click();
    await page.locator("#open").click();
    assert.equal(await page.locator("#settings-steps").inputValue(), "100");
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileSteps = await page.locator("#settings-steps").boundingBox();
    const mobileRefresh = await page.locator("#settings-refresh").boundingBox();
    assert.ok(Math.abs(mobileSteps.x - mobileRefresh.x) < 1, "Mobile textboxes must align left");
    await page.getByRole("tab", { name: "AI Model" }).click();
    await page.screenshot({ path: process.env.TEMP + "/settings-tabs-mobile.png" });
    for (const selector of [".settingsDialog", ".settingsContent"]) {
      assert.equal(await page.locator(selector).evaluate(el => el.scrollWidth > el.clientWidth), false);
    }
    console.log("PASS: tabs, draft persistence, save/error/cancel, hidden validation, keyboard/focus, mobile layout");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
