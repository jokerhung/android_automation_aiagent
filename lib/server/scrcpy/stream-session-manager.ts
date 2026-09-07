import "@/lib/server/server-guard";
import {deviceManager} from "@/lib/server/adb/device-manager";
export type StreamMode="snapshot"|"scrcpy";
export type StreamSession={token:string;serial:string;mode:StreamMode;expiresAt:string;snapshotUrl:string;webSocketUrl:string|null};
type StoredSession={serial:string;expiresAt:number};
const sharedKey=Symbol.for("android-vision-control.stream-sessions");
const sharedStore=()=>{const root=globalThis as typeof globalThis&{[sharedKey]?:Map<string,StoredSession>};return root[sharedKey]??=new Map<string,StoredSession>()};
export class StreamSessionManager{
 private sessions:Map<string,StoredSession>;
 constructor(private now=()=>Date.now(),private ttlMs=5*60_000,private maxSessions=64,sessions?:Map<string,StoredSession>){this.sessions=sessions??new Map()}
 private cleanup(){const current=this.now();for(const [token,session] of this.sessions)if(session.expiresAt<=current)this.sessions.delete(token)}
 private mode():StreamMode{return process.env.SCRCPY_INTEGRATION==="gplv3"?"scrcpy":"snapshot"}
 createForConnectedSerial(serial:string):StreamSession{this.cleanup();if(this.sessions.size>=this.maxSessions)throw new Error("Too many active stream sessions");const token=crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().replaceAll("-","");const expiresAt=this.now()+this.ttlMs;this.sessions.set(token,{serial,expiresAt});const mode=this.mode();return{token,serial,mode,expiresAt:new Date(expiresAt).toISOString(),snapshotUrl:"/api/devices/"+encodeURIComponent(serial)+"/snapshot?token="+encodeURIComponent(token),webSocketUrl:mode==="scrcpy"?"/ws/scrcpy?serial="+encodeURIComponent(serial)+"&session="+encodeURIComponent(token):null}}
 async create(serial:string){await deviceManager.requireConnected(serial);return this.createForConnectedSerial(serial)}
 resolve(token:string,touch=true){this.cleanup();const session=this.sessions.get(token);if(!session)return null;if(touch)session.expiresAt=this.now()+this.ttlMs;return{serial:session.serial,expiresAt:new Date(session.expiresAt).toISOString()}}
 release(token:string,serial?:string){const session=this.sessions.get(token);if(!session||serial&&session.serial!==serial)return false;return this.sessions.delete(token)}
 releaseSerial(serial:string){let count=0;for(const [token,session] of this.sessions)if(session.serial===serial){this.sessions.delete(token);count++}return count}
 closeAll(){const count=this.sessions.size;this.sessions.clear();return count}
 stats(){this.cleanup();return{active:this.sessions.size,capacity:this.maxSessions,ttlMs:this.ttlMs}}
}
export const streamSessionManager=new StreamSessionManager(()=>Date.now(),5*60_000,64,sharedStore());
