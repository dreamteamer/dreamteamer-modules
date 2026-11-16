/**
 * Markdown as React elements: `lib/render-md.ts` parses into a plain node tree, this draws it. No
 * `dangerouslySetInnerHTML` anywhere — an untrusted record body cannot inject markup by construction.
 *
 * `slot(i)` draws the node a display template spliced in at `slotToken(i)` (a field's own View); without it a
 * slot draws nothing.
 */
import { createElement, type ReactNode } from "react"
import { renderMd, type MdNode } from "../lib/render-md.ts"
import { cx } from "../styles/classes.ts"

// ---- the looks (was dt-md, dt-md-tpl, dt-md-*) ------------------------------------------------------------------
// Set on the container and reaching each node by its tag or its `data-md` (lib/render-md.ts). Direction is decided
// per block, so a list keeps its gutter on the item, where an RTL item indents on its own side. The document and
// the template are two whole looks, not one with overrides: an override of a descendant rule ties with it. Every
// class is written out whole, as Tailwind finds them only so.
/** What both share: list items and task items, inline code, the code/quote/table boxes' own look, tables. */
const mdShared = cx(
  "[&>:first-child]:mt-0!",
  "[&_li]:my-0.5 [&_li]:me-0 [&_li]:ms-[22px]",
  "[&_li[data-md=task]]:list-none [&_li[data-md=task]]:ms-1",
  "[&_li[data-md=task]_input]:me-1.5 [&_li[data-md=task]_input]:align-[-2px]",
  "[&_[data-md=code]]:py-px [&_[data-md=code]]:px-[5px] [&_[data-md=code]]:rounded [&_[data-md=code]]:bg-bg-subtle [&_[data-md=code]]:font-mono [&_[data-md=code]]:text-[12px]",
  "[&_[data-md=pre]]:py-2.5 [&_[data-md=pre]]:px-3 [&_[data-md=pre]]:rounded-dt [&_[data-md=pre]]:bg-bg-subtle [&_[data-md=pre]]:font-mono [&_[data-md=pre]]:text-[12px] [&_[data-md=pre]]:overflow-x-auto",
  "[&_[data-md=quote]]:py-0.5 [&_[data-md=quote]]:px-3.5 [&_[data-md=quote]]:border-s-[3px] [&_[data-md=quote]]:border-input-border [&_[data-md=quote]]:text-fg-subtle",
  "[&_[data-md=table]]:overflow-x-auto",
  "[&_table]:border-collapse [&_table]:min-w-[50%]",
  "[&_th]:py-[5px] [&_th]:px-[9px] [&_th]:border-b [&_th]:border-border [&_th]:text-start [&_th]:align-top [&_th]:text-small [&_th]:uppercase [&_th]:tracking-[0.04em] [&_th]:text-fg-subtle",
  "[&_td]:py-[5px] [&_td]:px-[9px] [&_td]:border-b [&_td]:border-border [&_td]:text-start [&_td]:align-top"
)
/** A document: a record body, a markdown field. (was dt-md) */
export const mdDoc = cx(
  mdShared,
  "max-w-[720px] text-[14px] leading-[1.65]",
  "[&_h1]:text-[20px] [&_h1]:mt-3.5 [&_h1]:mb-1.5 [&_h1]:mx-0",
  "[&_h2]:text-[16px] [&_h2]:mt-3.5 [&_h2]:mb-1 [&_h2]:mx-0",
  "[&_h3]:text-[14px] [&_h3]:mt-3 [&_h3]:mb-[3px] [&_h3]:mx-0",
  "[&_h4]:text-[13px] [&_h4]:mt-2.5 [&_h4]:mb-0.5 [&_h4]:mx-0",
  "[&_p]:my-1.5 [&_p]:mx-0",
  "[&_ul]:my-1 [&_ul]:mx-0 [&_ul]:ps-0",
  "[&_ol]:my-1 [&_ol]:mx-0 [&_ol]:ps-0",
  "[&_[data-md=pre]]:my-2 [&_[data-md=pre]]:mx-0",
  "[&_[data-md=quote]]:my-2 [&_[data-md=quote]]:mx-0",
  "[&_[data-md=table]]:my-2 [&_[data-md=table]]:mx-0"
)
/** A display template on a card or in a cell: the document tightened to its box. (was dt-md dt-md-tpl) */
export const mdTemplate = cx(
  mdShared,
  "max-w-none text-[length:inherit] leading-[1.45]",
  "[&_h1]:m-0 [&_h1]:text-[length:calc(1em+1px)] [&_h1]:leading-[1.35]",
  "[&_h2]:m-0 [&_h2]:text-[length:calc(1em+1px)] [&_h2]:leading-[1.35]",
  "[&_h3]:m-0 [&_h3]:text-[length:inherit] [&_h3]:leading-[1.35]",
  "[&_h4]:m-0 [&_h4]:text-[length:inherit] [&_h4]:leading-[1.35]",
  "[&_p]:m-0",
  "[&_p+p]:mt-[3px]",
  "[&_p>*]:align-baseline",
  "[&_ul]:my-0.5 [&_ul]:mx-0 [&_ul]:pl-4 [&_ul]:pr-0",
  "[&_ol]:my-0.5 [&_ol]:mx-0 [&_ol]:pl-4 [&_ol]:pr-0",
  "[&_[data-md=pre]]:my-[3px] [&_[data-md=pre]]:mx-0 [&_[data-md=pre]]:whitespace-pre-wrap",
  "[&_[data-md=quote]]:my-[3px] [&_[data-md=quote]]:mx-0",
  "[&_[data-md=table]]:my-[3px] [&_[data-md=table]]:mx-0"
)

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
    <div className={cx(mdDoc, className)}>
      <MdNodes nodes={renderMd(text)} />
    </div>
  )
}
