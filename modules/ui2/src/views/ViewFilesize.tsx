/**
 * `filesize` — a byte count, human-readable (`lib/formatFilesize.ts`). Opt-in only.
 */
import { formatFilesize } from "../lib/formatFilesize.ts"
import type { ViewProps } from "../registry/props.ts"
import { Empty, isEmpty } from "./Empty.tsx"

export function ViewFilesize({ value }: ViewProps) {
  if (isEmpty(value)) return <Empty />
  return <span className="whitespace-nowrap">{formatFilesize(value)}</span>
}
