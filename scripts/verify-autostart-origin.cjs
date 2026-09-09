// Invalid body deliberately prevents any OS mutation after the guard.
const assert=require("node:assert/strict");
(async()=>{
 for(const host of ["localhost:3000","127.0.0.1:3000"]){
  const response=await fetch("http://"+host+"/api/system/autostart",{headers:{host}});
  const payload=await response.json();assert.ok(payload.ok);
  for(const [origin,status] of [["http://"+host,400],["http://evil.test",403]]){
   const result=await fetch("http://"+host+"/api/system/autostart",{method:"PATCH",headers:{host,origin,"content-type":"application/json","x-autostart-token":payload.data.csrfToken},body:"{}"});
   const body=await result.json();assert.equal(result.status,status,JSON.stringify({host,origin,body}));
   if(status===400)assert.equal(body.error.code,"INVALID_AUTOSTART_REQUEST");
  }
 }
 console.log("PASS: real localhost/IP origins accepted; foreign origin rejected; invalid body prevents Startup changes");
})().catch(error=>{console.error(error);process.exitCode=1});
