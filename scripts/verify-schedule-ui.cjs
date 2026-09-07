const { chromium } = require("../vendor/ws-scrcpy-web/node_modules/playwright");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1234/chrome-win64/chrome.exe`,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(process.env.APP_URL || "http://127.0.0.1:3000", { waitUntil: "networkidle", timeout: 20_000 });
  await page.locator("button.scheduleNav").waitFor({ state: "visible", timeout: 15_000 });
  await page.locator("button.scheduleNav").click();
  await page.locator(".schedulePanel").waitFor({ state: "visible", timeout: 15_000 });

  const title = await page.locator(".schedulePanel h1").textContent();
  const search = await page.locator(".scheduleSearch input").count();
  const filters = await page.locator(".scheduleFilters button").count();

  await page.locator("button.scheduleCreate").click();
  await page.locator(".scheduleEditor").waitFor({ state: "visible", timeout: 5_000 });

  console.log(JSON.stringify({
    panel: await page.locator(".schedulePanel").count(),
    form: await page.locator(".scheduleEditor").count(),
    title,
    search,
    filters,
  }));
  await browser.close();
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
