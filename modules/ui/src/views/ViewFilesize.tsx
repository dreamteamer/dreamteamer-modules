/**
 * `filesize` — a byte count, human-readable (`lib/format-filesize.ts`). Opt-in only.
 */
import { formatFilesize } from "../lib/format-filesize.ts"
import type { ViewProps } from "../registry/props.ts"
import { Empty, isEmpty } from "./empty.tsx"

export function ViewFilesize({ value }: ViewProps) {
  if (isEmpty(value)) return <Empty />
  return <span className="whitespace-nowrap">{formatFilesize(value)}</span>
}
