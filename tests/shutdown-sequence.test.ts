import {afterEach,expect,it,vi} from "vitest";
import {createShutdownSequence} from "@/lib/server/shutdown-sequence";
afterEach(()=>vi.useRealTimers());
it("never closes persistence after a critical drain failure",async()=>{
 const closeDatabase=vi.fn(),failure=vi.fn();
 const shutdown=createShutdownSequence({closeAdmissions:vi.fn(),deadlineMs:1000,
 onFailure:failure,onTimeout:vi.fn(),steps:[
  {name:"drain",critical:true,run:()=>{throw new Error("drain failed")}},
  {name:"database",run:closeDatabase}
 ]});
 await expect(shutdown()).rejects.toThrow("drain failed");
 expect(failure).toHaveBeenCalledOnce();expect(closeDatabase).not.toHaveBeenCalled();
});
it("closes admissions immediately and shares repeated shutdown",async()=>{
 const order:string[]=[];
 const shutdown=createShutdownSequence({closeAdmissions:()=>{order.push("gate")},deadlineMs:1000,
 onFailure:vi.fn(),onTimeout:vi.fn(),steps:[{name:"cleanup",run:()=>{order.push("cleanup")}}]});
 const first=shutdown();expect(order[0]).toBe("gate");expect(shutdown()).toBe(first);await first;
 expect(order).toEqual(["gate","cleanup"]);
});
it("uses total deadline and never continues to database after timeout",async()=>{
 vi.useFakeTimers();let release!:()=>void;const closeDatabase=vi.fn(),timeout=vi.fn();
 const shutdown=createShutdownSequence({closeAdmissions:vi.fn(),deadlineMs:100,
 onFailure:vi.fn(),onTimeout:timeout,steps:[{name:"logs",run:()=>new Promise<void>(resolve=>{release=resolve})},{name:"database",run:closeDatabase}]});
 const result=shutdown();const rejection=expect(result).rejects.toThrow("SHUTDOWN_TIMEOUT: logs");
 await vi.advanceTimersByTimeAsync(101);await rejection;release();await Promise.resolve();
 expect(closeDatabase).not.toHaveBeenCalled();expect(timeout).toHaveBeenCalledWith("logs");
});
