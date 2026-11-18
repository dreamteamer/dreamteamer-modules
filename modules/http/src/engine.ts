// The RUNNING engine's public API, bound once by `activate(dt)` (or by a test / host tool that mounts
// the app itself). Never `import 'dreamteamer'` here: a second engine copy would validate, compile and
// commit with a different version than the one you ran.
export type Api = typeof import("dreamteamer")

export let dt: Api | null = null
export function bind(api: Api): void {
  dt = api
}
