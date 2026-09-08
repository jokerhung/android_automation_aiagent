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
  const menuItems=page.locator(".scheduleTypeMenu [role=menuitem]");
  const menuCount=await menuItems.count();
  const forms={};
  for(const type of ["interval","daily","weekly"]){await page.getByRole("menuitem",{name:new RegExp('^'+type,'i')}).click();await page.locator(".scheduleEditor").waitFor({state:"visible"});forms[type]={interval:await page.locator("[data-rule-field=interval]").count(),weekly:await page.locator("[data-rule-field=weekly]").count(),preview:await page.locator(".schedulePreview").count()};await page.getByRole("button",{name:"Đóng"}).click();await page.locator("button.scheduleCreate").click()}

  console.log(JSON.stringify({
    panel: await page.locator(".schedulePanel").count(),
    form: await page.locator(".scheduleEditor").count(),
    title,
    search,
    filters,
    menuCount,
    forms,
  }));
  await browser.close();
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
