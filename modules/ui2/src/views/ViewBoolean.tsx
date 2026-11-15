/**
 * `boolean` — a check for true, a quiet cross for false; nothing set is the empty dash, not a "false".
 */
import { Icon } from "../components/Icon.tsx"
import type { ViewProps } from "../registry/props.ts"
import { Empty } from "./empty.tsx"

export function ViewBoolean({ value }: ViewProps) {
  if (value === null || value === undefined || value === "") return <Empty />
  const on = value === true || value === "true"
  return (
    <span className={on ? "ui2-yes" : "ui2-subtle"} title={on ? "Yes" : "No"} aria-label={on ? "Yes" : "No"}>
      <Icon name={on ? "check" : "close"} />
    </span>
  )
}
