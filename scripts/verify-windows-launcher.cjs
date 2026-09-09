// Real hidden launcher, mock host; no database, Startup, tray or app server.
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawn}=require("node:child_process");
const assert=require("node:assert/strict");
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"Android Agent Unicode thử-"));
 try{
  fs.mkdirSync(path.join(root,"scripts"));
  fs.symlinkSync(path.resolve("node_modules"),path.join(root,"node_modules"),"junction");
  const marker=path.join(root,"ready.json");
  fs.writeFileSync(path.join(root,"scripts/start-background.ts"),
   'import fs from "node:fs"; fs.writeFileSync('+JSON.stringify(marker)+',JSON.stringify({cwd:process.cwd(),mode:process.env.NODE_ENV,args:process.argv.slice(2)}));');
  const ps=path.join(process.env.SystemRoot,"System32/WindowsPowerShell/v1.0/powershell.exe");
  await new Promise((resolve,reject)=>{
   const child=spawn(ps,["-NoProfile","-NonInteractive","-File",path.resolve("scripts/windows/launch-background.ps1"),"-AppRoot",root,"-NodePath",process.execPath],{cwd:process.env.SystemRoot,windowsHide:true,stdio:"inherit"});
   child.once("error",reject);child.once("exit",code=>code===0?resolve():reject(new Error("launcher exit "+code)));
  });
  const deadline=Date.now()+10000;
  while(!fs.existsSync(marker)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(fs.existsSync(marker),"mock host must execute through real tsx loader");
  const result=JSON.parse(fs.readFileSync(marker,"utf8"));
  assert.equal(result.cwd,root);assert.equal(result.mode,"production");assert.deepEqual(result.args,["--host"]);
  console.log("PASS: real launcher, Unicode/space paths, unrelated cwd, production mock host; Startup untouched");
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
