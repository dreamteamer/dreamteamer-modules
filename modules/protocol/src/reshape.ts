// The one answer filter (cr-modules-007 §4c): every host passes every gated answer through it.

import type { Scope } from "./gate.ts"

const COMMIT_KEYS = ["$last-commit-message", "$created-by", "$last-modified-by", "$repo", "$dirty", "$ahead"]

function row(r: Record<string, any>, scope: Scope, collection: string | undefined) {
  if (scope.kind !== "module" || scope.own?.has(collection)) return r
  const out = { ...r }
  for (const k of COMMIT_KEYS) delete out[k]
  return out
}

/**
 * @param {string} routeId the protocol route the answer came from
 * @param {unknown} body the handler's answer
 * @param {object} scope the gate scope
 * @param {string} [collection] the collection the answer is about (list and record routes)
 */
export function reshape(routeId: string, body: any, scope: Scope, collection?: string): unknown {
  const reads = scope.reads ?? new Set()
  switch (routeId) {
    case "records-list": {
      let records = (body?.records ?? []).map((r: Record<string, any>) => row(r, scope, collection))
      if (scope.kind === "module" && collection === "ui-views")
        records = records.filter((r: Record<string, any>) => r.$module === scope.module)
      return { records, total: collection === "ui-views" && scope.kind === "module" ? records.length : body?.total }
    }
    case "record-read":
      return { id: body?.id, fields: row(body?.fields ?? {}, scope, collection) }
    case "info":
      return scope.kind === "module"
        ? {
            name: body?.name,
            host: body?.host,
            compiled: body?.compiled,
            ui: [scope.module],
            user: null,
            collections: (body?.collections ?? []).filter((c: string) => reads.has(c)),
          }
        : { name: body?.name, collections: (body?.collections ?? []).filter((c: string) => reads.has(c)) }
    case "schema":
      return (body ?? []).filter((d: { name: string }) => reads.has(d.name))
    case "presentation":
      return {
        collections: (body?.collections ?? []).filter((c: { name?: string; collection?: string }) =>
          reads.has(c.name ?? c.collection)
        ),
      }
    default:
      return body
  }
}
