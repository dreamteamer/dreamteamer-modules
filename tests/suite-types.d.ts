// Loosens a few library return types for the suites only: a suite reads parsed YAML and JSON as the
// shape it expects and lets an assertion fail when it is not, so `unknown` there only adds casts.
import "js-yaml"

declare module "js-yaml" {
  export function load(str: string, opts?: LoadOptions): any
  export function loadAll(str: string, iterator?: null, opts?: LoadOptions): any[]
}

declare global {
  // Object.values / Object.entries of an untyped (any) value give `unknown` elements; a suite reads them as parsed data.
  interface ObjectConstructor {
    values(o: any): any[]
    entries(o: any): [string, any][]
  }
  // `new Map(list.map(x => [k, v]))`: the pairs infer as arrays, not tuples, and the map as Map<unknown, unknown>.
  interface MapConstructor {
    new (entries: Iterable<any[]>): Map<any, any>
  }
}
