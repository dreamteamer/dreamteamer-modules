/**
 * `json` — the default for an object or a map, branching on the VALUE's shape rather than assuming one: in a
 * cell an array is "N items" and an object a `{…}` chip previewing the JSON on hover; on the record page the
 * whole value, pretty-printed. Never "[object Object]".
 */
import type { ViewProps } from "../registry/props.ts"
import { Empty } from "./Empty.tsx"
import { chip, cx } from "../styles/classes.ts"

const PREVIEW = 120

export function ViewJson({ value, context }: ViewProps) {
  if (value === null || value === undefined || typeof value !== "object")
    return value === null || value === undefined || value === "" ? <Empty /> : <span>{String(value)}</span>
  if (context === "record")
    return (
      <pre className="m-0 font-mono text-[12px] whitespace-pre-wrap max-h-[420px] overflow-auto py-2.5 px-3 border border-border rounded-dt">
        {JSON.stringify(value, null, 2)}
      </pre>
    )
  if (Array.isArray(value))
    return (
      <span>
        {value.length} item{value.length === 1 ? "" : "s"}
      </span>
    )
  const json = JSON.stringify(value)
  return (
    <span
      className={cx(chip, "font-mono break-all")}
      title={json.length > PREVIEW ? `${json.slice(0, PREVIEW)}…` : json}
    >
      {"{…}"}
    </span>
  )
}
