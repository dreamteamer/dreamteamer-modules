// Which UI `dt web` serves (`--app ui|ui2`): the page AND the module frames' guest come from the SAME package, so a
// React page never hosts frames drawn with the Vue guest. @dreamteamer/ui is this package's dependency; ui2 is not —
// it is found where the workspace installed it.
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { guestOf, type Guest } from "./moduleFrames.ts"

export const APPS = { ui: "@dreamteamer/ui", ui2: "@dreamteamer/ui2" } as const
export type AppName = keyof typeof APPS
export const isApp = (v: unknown): v is AppName => typeof v === "string" && Object.hasOwn(APPS, v)

/** The installed package dir of `app`: this package's own resolution first, then the workspace's; null when neither. */
export function appPackage(app: AppName, root: string, from: string = import.meta.url): string | null {
  for (const base of [from, pathToFileURL(path.join(root, "package.json")).href]) {
    try {
      return path.dirname(createRequire(base).resolve(`${APPS[app]}/package.json`))
    } catch {
      /* not from here */
    }
  }
  return null
}

/** What the server serves. `app` null: a DT_WEB_APP_DIR page, with the guest startWeb finds by default. */
export interface AppChoice {
  app: AppName | null
  appDir: string
  guest?: Guest | null
}

/**
 * The app the server starts with: `--app` when given, else a DT_WEB_APP_DIR page (`appDir`), else ui. Nothing is
 * remembered — ui2 is served only when the flag names it, and only when it is already installed: a named app that is
 * not, or is installed without its build, throws naming the fix.
 */
export function resolveApp(
  root: string,
  { app, appDir, from }: { app?: AppName; appDir?: string; from?: string } = {}
): AppChoice {
  if (!app && appDir) return { app: null, appDir }
  const name = app ?? "ui"
  const dir = appPackage(name, root, from)
  if (!dir) throw new Error(`--app ${name} needs ${APPS[name]}, which is not installed — npm install ${APPS[name]}`)
  const page = path.join(dir, "dist", "app")
  if (!fs.existsSync(path.join(page, "index.html")))
    throw new Error(`the app is missing: ${path.join(page, "index.html")} — ${APPS[name]} is installed without its build`)
  return { app: name, appDir: page, guest: guestOf(dir) }
}
