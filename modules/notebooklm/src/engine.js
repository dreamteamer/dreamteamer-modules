// The RUNNING engine's public API, bound once by `activate(dt)`. Every engine call in this package
// goes through `dt` — never `import 'dreamteamer'`, which could load a second engine copy that
// disagrees with the one that is running.
export let dt = null;
export function bind(api) { dt = api; }
