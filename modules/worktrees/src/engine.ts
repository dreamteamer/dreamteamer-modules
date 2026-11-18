// The RUNNING engine's public API, bound once by `activate(dt)` (src/activate.js).
//
// Every engine call in this package goes through `dt.*`. Nothing here imports `dreamteamer` at
// runtime: a second engine copy would validate, compile and commit with a different version than the
// one you ran.
export type Api = typeof import("dreamteamer")

export let dt: Api | null = null
export function bind(api: Api): void {
  dt = api
}
