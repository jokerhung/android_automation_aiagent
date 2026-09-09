import {describe,expect,it} from "vitest";
import {getLocalSessionCsrfToken,protectSystemApiPeerHeaders,secureSystemApiRequest} from "@/lib/server/system-api-guard";
function request(host:string,origin?:string){
 const headers:Record<string,string|undefined>={host,"x-autostart-token":getLocalSessionCsrfToken()};
 if(origin)headers.origin=origin;
 protectSystemApiPeerHeaders(headers,"127.0.0.1");
 return new Request("http://127.0.0.1:3000/api/system/autostart",{method:"PATCH",headers:headers as Record<string,string>});
}
describe("system request boundaries",()=>{
 it("accepts localhost Host despite Next internal bind URL and rejects alias crossing",()=>{
  expect(secureSystemApiRequest(request("localhost:3000","http://localhost:3000"))).toBeNull();
  expect(secureSystemApiRequest(request("localhost:3000","http://127.0.0.1:3000"))?.status).toBe(403);
  expect(secureSystemApiRequest(request("localhost:3000","https://localhost:3000"))?.status).toBe(403);
 });
 it("rejects DNS-rebinding names and wrong origin port",()=>{
  expect(secureSystemApiRequest(request("evil.test:3000","http://evil.test:3000"))?.status).toBe(403);
  expect(secureSystemApiRequest(request("127.0.0.1:3000","http://127.0.0.1:3001"))?.status).toBe(403);
 });
 it("rejects forwarded loopback without a real trusted peer",()=>{
  const req=new Request("http://127.0.0.1:3000/api/system/autostart",{headers:{host:"127.0.0.1:3000","x-forwarded-for":"127.0.0.1"}});
  expect(secureSystemApiRequest(req)?.status).toBe(403);
 });
});
