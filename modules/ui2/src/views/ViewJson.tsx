/**
 * `json` — the default for an object or a map, branching on the VALUE's shape rather than assuming one: in a
 * cell an array is "N items" and an object a `{…}` chip previewing the JSON on hover; on the record page the
 * whole value, pretty-printed. Never "[object Object]".
 */
import type { ViewProps } from "../registry/props.ts"
import { Empty } from "./empty.tsx"

const PREVIEW = 120

export function ViewJson({ value, context }: ViewProps) {
  if (value === null || value === undefined || typeof value !== "object")
    return value === null || value === undefined || value === "" ? <Empty /> : <span>{String(value)}</span>
  if (context === "record") return <pre className="ui2-pre ui2-json">{JSON.stringify(value, null, 2)}</pre>
  if (Array.isArray(value))
    return (
      <span>
        {value.length} item{value.length === 1 ? "" : "s"}
      </span>
    )
  const json = JSON.stringify(value)
  return (
    <span className="ui2-chip ui2-mono" title={json.length > PREVIEW ? `${json.slice(0, PREVIEW)}…` : json}>
      {"{…}"}
    </span>
  )
}
