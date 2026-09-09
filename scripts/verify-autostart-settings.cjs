// Mock-only browser integration: no server, database, OS Startup or ADB.
const assert = require("node:assert/strict");
const { build } = require("esbuild");
const { chromium } = require("../vendor/ws-scrcpy-web/node_modules/playwright");
(async () => {
  const bundle = await build({
    stdin: {
      contents: 'import React from "react";import {createRoot} from "react-dom/client";import App from "./components/app-shell";createRoot(document.getElementById("root")).render(<App/>);',
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const browser = await chromium.launch({headless:true,
    executablePath: process.env.CHROMIUM_PATH || process.env.LOCALAPPDATA + "/ms-playwright/chromium-1234/chrome-win64/chrome.exe"});
  try {
    const page = await browser.newPage();
    const mutations = [];
    let failStartup = true;
    let supported = true;
    let unknownApproval = true;
    const status = () => ({supported,enabled:false,registration:"absent",backgroundReady:true,csrfToken:"mock-local-token"});
    await page.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/") return route.fulfill({contentType:"text/html",body:'<div id="root"></div>'});
      if (request.method() === "PATCH") {
        const body = request.postDataJSON();
        mutations.push({path:url.pathname,body});
        if (url.pathname === "/api/system/autostart") {
          assert.equal(request.headers()["x-autostart-token"], "mock-local-token");
          return route.fulfill({status:failStartup?400:200,json:failStartup?
            {ok:false,error:{message:"STARTUP_WRITE_FAILED mock"}}:
            {ok:true,data:{...status(),enabled:unknownApproval?null:body.enabled,registration:"valid"}}});
        }
        assert.equal("enabled" in body, false, "OS toggle must not enter strict settings API");
        return route.fulfill({json:{ok:true,data:body}});
      }
      let data = [];
      if (url.pathname === "/api/settings") data = {model:"mock",baseUrl:"https://example.test/v1",maxSteps:100,screenRefreshMs:900};
      if (url.pathname === "/api/system/autostart") data = status();
      return route.fulfill({json:{ok:true,data}});
    });
    await page.goto("http://mock.local");
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.getByRole("button",{name:/Cài đặt/}).click();
    const toggle = page.getByRole("switch",{name:"Khởi động cùng Windows"});
    await toggle.click();
    await page.getByRole("button",{name:"Hủy",exact:true}).click();
    assert.equal(mutations.length,0);
    await page.getByRole("button",{name:/Cài đặt/}).click();
    assert.equal(await toggle.getAttribute("aria-checked"),"false");
    await toggle.click();
    await page.getByRole("button",{name:"Lưu thay đổi"}).click();
    await page.getByRole("alert").filter({hasText:"Đã lưu cấu hình ứng dụng, nhưng chưa áp dụng"}).waitFor();
    assert.deepEqual(mutations.map(x=>x.path),["/api/settings","/api/system/autostart"]);
    assert.equal(await toggle.getAttribute("aria-checked"),"true","dirty toggle survives partial failure");
    failStartup = false;
    await page.getByRole("button",{name:"Lưu thay đổi"}).click();
    await page.getByRole("alert").filter({hasText:"Đã tạo đăng ký khởi động cùng Windows"}).waitFor();
    assert.equal(await page.getByRole("alert").filter({hasText:"chưa áp dụng"}).count(),0);
    assert.equal(await page.getByRole("dialog").count(),1);
    unknownApproval = false;
    await page.getByRole("button",{name:"Lưu thay đổi"}).click();
    await page.getByRole("dialog").waitFor({state:"detached"});
    supported = false;
    await page.getByRole("button",{name:/Cài đặt/}).click();
    assert.equal(await toggle.isDisabled(),true);
    console.log("PASS: mock cancel, strict payload separation, settings-first save, partial failure, retry, unsupported");
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
