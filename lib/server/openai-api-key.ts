import "@/lib/server/server-guard";
import fs from "node:fs";
import path from "node:path";

export function upsertEnvValue(contents:string,name:string,value:string){
  const newline=contents.includes("\r\n")?"\r\n":"\n";
  const entry=name+"="+JSON.stringify(value);
  const pattern=new RegExp("^\\s*"+name+"\\s*=.*$","m");
  if(pattern.test(contents))return contents.replace(pattern,entry);
  return contents+(contents&&!contents.endsWith("\n")?newline:"")+entry+newline;
}

export function setOpenAiApiKey(apiKey:string,envPath=path.join(process.cwd(),".env.local")){
  if(!apiKey||/[\r\n\0]/.test(apiKey))throw new Error("OpenAI API key không hợp lệ");
  const contents=fs.existsSync(envPath)?fs.readFileSync(envPath,"utf8"):"";
  fs.writeFileSync(envPath,upsertEnvValue(contents,"OPENAI_API_KEY",apiKey),{encoding:"utf8",mode:0o600});
  try{fs.chmodSync(envPath,0o600)}catch{}
  process.env.OPENAI_API_KEY=apiKey;
}
