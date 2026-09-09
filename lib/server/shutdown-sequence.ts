export type ShutdownStep={name:string;run:()=>void|Promise<void>;critical?:boolean};
/** A single overall deadline, not an independent full timeout for each step. */
export function createShutdownSequence(options:{
 closeAdmissions:()=>void;
 steps:ShutdownStep[];
 deadlineMs:number;
 onFailure:(step:string,error:unknown)=>void;
 onTimeout:(step:string)=>void;
}){
 let shutdown:Promise<void>|undefined;
 return ()=>{
  if(shutdown)return shutdown;
  options.closeAdmissions();
  shutdown=(async()=>{
   let current="initializing";
   let expired=false;
   let timer:ReturnType<typeof setTimeout>|undefined;
   const timeout=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{
     expired=true;
     try{options.onTimeout(current)}finally{reject(new Error("SHUTDOWN_TIMEOUT: "+current))}
    },options.deadlineMs);
   });
   const work=(async()=>{
    for(const step of options.steps){
     if(expired)return;
     current=step.name;
     try{await step.run()}catch(error){options.onFailure(step.name,error);if(step.critical)throw error}
    }
   })();
   try{await Promise.race([work,timeout])}finally{clearTimeout(timer)}
  })();
  return shutdown;
 };
}
