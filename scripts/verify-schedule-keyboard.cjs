const assert = require("node:assert/strict");
const { chromium } = require("../vendor/ws-scrcpy-web/node_modules/playwright");
(async () => {
  const browser = await chromium.launch({headless:true,executablePath:process.env.LOCALAPPDATA+"/ms-playwright/chromium-1234/chrome-win64/chrome.exe"});
  try {
    const page = await browser.newPage();
    await page.goto(process.env.APP_URL || "http://127.0.0.1:3000", {waitUntil:"domcontentloaded"});
    await page.locator(".scheduleNav").click();
    const create = page.locator(".scheduleCreate");
    await create.press("Enter");
    const dialog = page.locator(".scheduleEditor");
    await dialog.waitFor({state:"visible"});
    assert.equal(await dialog.locator("select").first().inputValue(), "daily");
    assert.equal(await page.getByRole("menu").count(), 0);
    await dialog.locator("select").first().selectOption("weekly");
    await page.keyboard.press("Escape");
    await dialog.waitFor({state:"detached"});
    await create.press("Space");
    await dialog.waitFor({state:"visible"});
    assert.equal(await dialog.locator("select").first().inputValue(), "daily");
    await page.locator(".scheduleModalBackdrop").click({position:{x:5,y:5}});
    await dialog.waitFor({state:"detached"});
    console.log(JSON.stringify({defaultDaily:true,reopenedDaily:true,enter:true,space:true,escape:true,outside:true}));
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
