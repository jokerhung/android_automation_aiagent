import "@/lib/server/server-guard";

const admissionSymbol=Symbol.for("android-automation-aiagent.application-admission.v1");
type AdmissionState={accepting:boolean;reason:string};
const root=globalThis as Record<PropertyKey,unknown>;
const state=(root[admissionSymbol] as AdmissionState|undefined)??{accepting:true,reason:"Application is stopping"};
root[admissionSymbol]=state;

export function assertApplicationAcceptingWork(){if(!state.accepting)throw Object.assign(new Error(state.reason),{code:"APPLICATION_STOPPING"})}
export function stopApplicationAdmissions(reason="Application is stopping"){state.accepting=false;state.reason=reason}
export function resetApplicationAdmissions(){state.accepting=true;state.reason="Application is stopping"}
export function isApplicationAcceptingWork(){return state.accepting}
