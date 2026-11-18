/**
 * `markdown` — rendered markdown (`lib/renderMd.ts` → `components/Markdown.tsx`): the body on the record page
 * and every `markdown` field. A cell gets ONE stripped line (`mdToPlainText`), never a document, so row heights
 * survive; the record page gets the real thing.
 */
import { Markdown } from "../components/Markdown.tsx"
import { mdToPlainText } from "../lib/renderMd.ts"
import type { ViewProps } from "../registry/props.ts"
import { CELL_MAX, Empty } from "./Empty.tsx"

export function ViewMarkdown({ value, context }: ViewProps) {
  const text = value === null || value === undefined ? "" : String(value)
  if (!text.trim()) return <Empty />
  if (context !== "record") {
    const plain = mdToPlainText(text)
    return (
      <span dir="auto" title={plain}>
        {plain.length > CELL_MAX ? `${plain.slice(0, CELL_MAX)}…` : plain}
      </span>
    )
  }
  return <Markdown text={text} />
}
