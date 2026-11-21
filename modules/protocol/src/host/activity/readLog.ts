import { execFile } from "node:child_process"
import * as path from "node:path"
import type { ActivityScope, LogEntries } from "../activity.ts"
import { logArgs } from "./logArgs.ts"
import { parseActivityLog } from "./parseActivityLog.ts"

export const ACTIVITY_GIT_TIMEOUT_MS = 60_000

export function readLog(
  root: string,
  scope: ActivityScope,
  limit: number,
  timeoutMs: number = ACTIVITY_GIT_TIMEOUT_MS
): Promise<LogEntries> {
  const prefix = scope.repo === "." ? "" : `${scope.repo}/`
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      logArgs(scope, limit),
      { cwd: path.join(root, scope.repo), timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
      (err, out) => {
        if (err) return err.killed ? reject(err) : resolve([])
        resolve(
          parseActivityLog(String(out), scope.repo).map(e => ({ ...e, paths: e.paths.map(p => `${prefix}${p}`) }))
        )
      }
    )
  })
}
