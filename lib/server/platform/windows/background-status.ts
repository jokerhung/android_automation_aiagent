import fs from "node:fs";
import path from "node:path";
import {appendRotatingLog} from "./rotating-log";
import type {WindowsInstallationPaths} from "./paths";
import {ensureProtectedDirectory,protectWindowsPath} from "./windows-security";

export type InstanceMode="development"|"foreground"|"background";
export type BackgroundMetadata={version:1;appRoot:string;installationId:string;instanceId:string;pid:number;startedAt:string;mode:InstanceMode;pipeName:string;token:string;port:number;ready:boolean;trayReady:boolean};
export function readBackgroundMetadata(paths:WindowsInstallationPaths){try{return JSON.parse(fs.readFileSync(paths.metadataPath,"utf8")) as BackgroundMetadata}catch{return null}}
export function writeBackgroundMetadata(paths:WindowsInstallationPaths,value:BackgroundMetadata){
 ensureProtectedDirectory(paths.stateDirectory);
 const temporary=paths.metadataPath+"."+process.pid+"."+value.instanceId+".tmp";
 try{fs.writeFileSync(temporary,JSON.stringify(value,null,2),{encoding:"utf8",mode:0o600,flag:"wx"});protectWindowsPath(temporary);fs.renameSync(temporary,paths.metadataPath);protectWindowsPath(paths.metadataPath)}finally{try{fs.unlinkSync(temporary)}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error}}
}
export function removeOwnedMetadata(paths:WindowsInstallationPaths,token:string,instanceId?:string){const current=readBackgroundMetadata(paths);if(current?.token===token&&(!instanceId||current.instanceId===instanceId))try{fs.unlinkSync(paths.metadataPath)}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error}}
export function appendBackgroundLog(paths:WindowsInstallationPaths,message:string){ensureProtectedDirectory(path.dirname(paths.logPath));appendRotatingLog(paths.logPath,message);protectWindowsPath(paths.logPath)}
