// Isolated real helper only: no Startup, app server, database or browser.
const {spawn}=require("node:child_process");
const path=require("node:path");
const readline=require("node:readline");
const assert=require("node:assert/strict");
(async()=>{
 const events=[];
 const ps=path.join(process.env.SystemRoot,"System32/WindowsPowerShell/v1.0/powershell.exe");
 const child=spawn(ps,["-NoProfile","-NonInteractive","-STA","-WindowStyle","Hidden","-File",path.resolve("scripts/windows/tray.ps1")],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
 let errors="";
 child.stderr.on("data",chunk=>{errors+=chunk});
 const lines=readline.createInterface({input:child.stdout});
 let timer;
 try{
  await new Promise((resolve,reject)=>{
   timer=setTimeout(()=>{child.kill();reject(new Error("disconnect smoke timed out: "+errors))},15000);
   child.once("error",reject);
   lines.on("line",line=>{
    try{
     const event=JSON.parse(line);events.push(event.event);
     if(event.event==="ready")child.stdin.end();
    }catch(error){reject(error)}
   });
   child.once("exit",code=>code===0?resolve():reject(new Error("tray exit "+code+": "+errors)));
   child.stdin.write(JSON.stringify({command:"initialize",homeUrl:"http://127.0.0.1:3000/",status:"Disconnect smoke"})+"\n");
  });
  assert.ok(events.includes("ready"));assert.ok(events.includes("disposed"));
  assert.equal(errors,"");
  console.log("PASS: real tray disposes and exits when parent input closes");
 }finally{clearTimeout(timer);lines.close();if(child.exitCode===null)child.kill();}
})().catch(error=>{console.error(error);process.exitCode=1});
