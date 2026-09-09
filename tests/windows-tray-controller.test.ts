import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";

const mocks=vi.hoisted(()=>({spawn:vi.fn()}));
vi.mock("node:child_process",()=>({spawn:mocks.spawn}));
import {WindowsTrayController} from "@/lib/server/platform/windows/tray-controller";

class FakeChild extends EventEmitter{
 stdin=new PassThrough();stdout=new PassThrough();stderr=new PassThrough();killed=false;
 kill(){this.killed=true;this.emit("exit",0);return true}
}
let originalPlatform:PropertyDescriptor|undefined;
beforeEach(()=>{originalPlatform=Object.getOwnPropertyDescriptor(process,"platform");Object.defineProperty(process,"platform",{configurable:true,value:"win32"});mocks.spawn.mockReset()});
afterEach(()=>{if(originalPlatform)Object.defineProperty(process,"platform",originalPlatform)});
const nextTurn=()=>new Promise<void>(resolve=>setImmediate(resolve));

describe("Windows tray desktop mock smoke",()=>{
 it("handshakes, relays menu events, sends commands, and reports unexpected loss",async()=>{
  const child=new FakeChild();mocks.spawn.mockReturnValue(child);const writes:string[]=[];child.stdin.on("data",chunk=>writes.push(String(chunk)));
  const tray=new WindowsTrayController(),events:string[]=[];tray.onEvent(event=>events.push(event.event));
  const started=tray.start({appRoot:"C:\Mock App",homeUrl:"http://127.0.0.1:3000/",timeoutMs:1000});
  expect(mocks.spawn).toHaveBeenCalledOnce();const [executable,args,options]=mocks.spawn.mock.calls[0];
  expect(String(executable)).toMatch(/powershell.exe$/i);expect(args).toEqual(expect.arrayContaining(["-NoProfile","-NonInteractive","-STA","-WindowStyle","Hidden","-File"]));expect(args.join(" ")).not.toMatch(/ExecutionPolicy|Bypass/i);expect(options).toMatchObject({windowsHide:true,stdio:["pipe","pipe","pipe"]});
  child.stdout.write('{"event":"ready"}\n');await started;await nextTurn();
  child.stdout.write('{"event":"open-home"}\n{"event":"quit-requested"}\n');await nextTurn();
  tray.setStatus("ready",true);tray.confirmQuit(2);await nextTurn();
  expect(events).toEqual(expect.arrayContaining(["ready","open-home","quit-requested"]));
  const commands=writes.join("").trim().split(/\r?\n/).map(line=>JSON.parse(line));
  expect(commands).toEqual(expect.arrayContaining([expect.objectContaining({command:"initialize",homeUrl:"http://127.0.0.1:3000/"}),{command:"set-status",status:"ready",homeEnabled:true},{command:"confirm-quit",activeRuns:2}]));
  child.emit("exit",7);expect(events).toContain("lost");
 });
 it("disposes the mocked helper without launching a real desktop process",async()=>{
  const child=new FakeChild();mocks.spawn.mockReturnValue(child);const tray=new WindowsTrayController();const started=tray.start({appRoot:"C:\Mock App",homeUrl:"http://127.0.0.1:3000/",timeoutMs:1000});child.stdout.write('{"event":"ready"}\n');await started;
  const disposing=tray.dispose(100);child.emit("exit",0);await disposing;expect(mocks.spawn).toHaveBeenCalledOnce();expect(child.killed).toBe(false);
 });
});
