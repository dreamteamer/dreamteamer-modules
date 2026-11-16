/**
 * Markdown as React elements: `lib/render-md.ts` parses into a plain node tree, this draws it. No
 * `dangerouslySetInnerHTML` anywhere — an untrusted record body cannot inject markup by construction.
 *
 * `slot(i)` draws the node a display template spliced in at `slotToken(i)` (a field's own View); without it a
 * slot draws nothing.
 */
import { createElement, type ReactNode } from "react"
import { renderMd, type MdNode } from "../lib/render-md.ts"

function draw(node: MdNode, key: number, slot?: (i: number) => ReactNode): ReactNode {
  if (typeof node === "string") return node
  if ("slot" in node) return <span key={key}>{slot?.(node.slot) ?? null}</span>
  const { class: cls, ...rest } = node.attrs ?? {}
  const props: Record<string, unknown> = { key, ...rest }
  if (cls) props["className"] = cls
  const kids = node.children.map((c, i) => draw(c, i, slot))
  return createElement(node.tag, props, ...(kids.length ? kids : []))
}

export function MdNodes({ nodes, slot }: { nodes: MdNode[]; slot?: (i: number) => ReactNode }) {
  return <>{nodes.map((n, i) => draw(n, i, slot))}</>
}

/** A markdown document, rendered. */
export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`dt-md ${className}`.trim()}>
      <MdNodes nodes={renderMd(text)} />
    </div>
  )
}
