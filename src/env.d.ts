/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />
declare global {
 interface Window { services: {
 diagnose(): { app: string; version: string; node: string }
 getLaunchCount(): number
 recordLaunch(): number
 checkStorage(): boolean
 } }
}
export {}
