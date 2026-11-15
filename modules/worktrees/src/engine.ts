// The RUNNING engine's public API, bound once by `activate(dt)` (src/extension.js).
//
// Every engine call in this package goes through `dt.*`. Nothing here imports `dreamteamer` at
// runtime: a second engine copy would validate, compile and commit with a different version than the
// one you ran.
export let dt = null;
export function bind(api) { dt = api; }
