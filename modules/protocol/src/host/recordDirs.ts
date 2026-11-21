import { unreadableReason } from "./unreadableReason.ts"
export { unreadableReason } from "./unreadableReason.ts"
export function recordDirsOrNone(store: any, d: any): string[] {
  return unreadableReason(d, store.descriptors) ? [] : store.recordDirs(d)
}
