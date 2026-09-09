import {expect,it,vi} from "vitest";
it("shares peer signing and CSRF state across separately loaded server bundles",async()=>{
 const server=await import("@/lib/server/system-api-guard");
 const headers:Record<string,string|undefined>={host:"127.0.0.1:3000",origin:"http://127.0.0.1:3000"};
 server.protectSystemApiPeerHeaders(headers,"127.0.0.1");
 headers[server.SYSTEM_CSRF_HEADER]=server.getLocalSessionCsrfToken();
 vi.resetModules();
 const route=await import("@/lib/server/system-api-guard");
 expect(route.getLocalSessionCsrfToken()).toBe(server.getLocalSessionCsrfToken());
 const request=new Request("http://127.0.0.1:3000/api/system/autostart",{method:"PATCH",headers:headers as Record<string,string>});
 expect(route.secureSystemApiRequest(request)).toBeNull();
});
