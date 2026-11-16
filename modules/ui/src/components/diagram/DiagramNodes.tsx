/**
 * The diagram's three node kinds, as React Flow custom nodes (ported from the Vue ui's components/diagram/
 * DotNode.vue, EntityNode.vue and GroupNode.vue, which were Vue Flow nodes):
 *
 *   · DOT — a circle sized by degree, filled when the record was loaded and hollow (a GHOST) when it is known only
 *     from a reference value. ⚠ Its label is ABSOLUTELY positioned: the node box is the dot at every zoom, so the
 *     names arriving as you zoom in never move the edges' anchors from the dot to the end of its text.
 *   · ENTITY — a collection descriptor drawn as a table: a header band in the group's accent, one row per field.
 *     Handles are per FIELD on the source side and one `__id` handle on the target side, so an edge leaves the row
 *     that holds the reference and lands on the id it points at — what makes an ERD readable.
 *   · GROUP — the coloured container behind a group's members: draggable from the space between them (moving it
 *     moves its members — the List does that, it knows who belongs where), and resized from its one corner. ⚠ A
 *     pointer delta is in SCREEN pixels and the box in GRAPH units, so every delta is divided by the live zoom.
 */
import { Handle, Position, useReactFlow, type Node, type NodeProps } from "@xyflow/react"
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react"
import type { DiagramField } from "../../lib/diagram/types.ts"
import { Icon } from "../Icon.tsx"
import { cx } from "../../styles/classes.ts"

export type DotData = {
  label: string
  group: string
  ghost: boolean
  accent: string
  size: number
  dimmed: boolean
  /** False when zoomed out — the dots carry the shape, the names would be noise. */
  showLabel: boolean
}
export type EntityData = {
  label: string
  icon?: string
  system?: boolean
  fields?: DiagramField[]
  accent: string
  dimmed: boolean
}
export type GroupData = {
  label: string
  accent: string
  onResize: (id: string, size: { w: number; h: number }) => void
}

export function DotNode({ data }: NodeProps<Node<DotData>>) {
  return (
    <div
      className={cx("relative [transition:opacity_120ms_ease] cursor-pointer", data.dimmed && "opacity-20")}
      style={{ width: data.size, height: data.size }}
      title={`${data.group}/${data.label}`}
    >
      <Handle type="target" position={Position.Left} className="dt-gnode-handle" />
      <span
        className="block w-full h-full box-border rounded-full border-2 border-solid shadow-[0_1px_3px_rgb(0_0_0/0.25)]"
        style={{ background: data.ghost ? "transparent" : data.accent, borderColor: data.accent }}
      />
      {data.showLabel && (
        <span
          className={cx(
            "absolute left-[calc(100%+6px)] top-1/2 -translate-y-1/2 text-[10.5px] leading-[1.3] whitespace-nowrap max-w-[150px] overflow-hidden text-ellipsis [text-shadow:0_0_3px_var(--dt-bg),0_0_3px_var(--dt-bg)]",
            data.ghost ? "text-fg-subtle" : "text-fg"
          )}
        >
          {data.label}
        </span>
      )}
      <Handle type="source" position={Position.Right} className="dt-gnode-handle" />
    </div>
  )
}

export function EntityNode({ data }: NodeProps<Node<EntityData>>) {
  return (
    <div
      className={cx(
        "min-w-[232px] bg-bg border border-border rounded-[10px] shadow-[0_1px_4px_rgb(0_0_0/0.12)] overflow-hidden [transition:opacity_120ms_ease]",
        data.dimmed && "opacity-35"
      )}
    >
      <div
        className="flex items-center gap-1.5 py-[7px] px-2.5 text-white font-semibold text-[12px]"
        style={{ background: data.accent }}
      >
        <Icon name={data.icon || "table"} />
        <span className="flex-1 whitespace-nowrap">{data.label}</span>
        {data.system && (
          <span
            className="text-[9px] uppercase tracking-[0.06em] opacity-75 border border-[rgb(255_255_255/0.5)] rounded-[3px] py-0 px-[3px]"
            title="engine collection"
          >
            sys
          </span>
        )}
      </div>
      {(data.fields ?? []).map(f => (
        <div
          key={f.name}
          className={cx(
            "relative flex items-center gap-1.5 py-1 px-2.5 text-[11.5px] border-t border-border text-fg",
            f.isId && "font-semibold"
          )}
        >
          {/* the id row is where every incoming reference lands */}
          {f.isId && <Handle type="target" position={Position.Left} id="__id" className="dt-entity-handle" />}
          <span className={cx("flex-1 whitespace-nowrap", f.ref && "text-link")}>{f.name}</span>
          {f.isId && <Icon name="key" className="text-fg-subtle" />}
          <span className="font-mono text-[10.5px] text-fg-subtle whitespace-nowrap">{f.label}</span>
          {f.ref && <Handle type="source" position={Position.Right} id={f.name} className="dt-entity-handle" />}
        </div>
      ))}
    </div>
  )
}

export function GroupNode({ id, data }: NodeProps<Node<GroupData>>) {
  const flow = useReactFlow()
  const onGrab = (event: ReactPointerEvent<HTMLSpanElement>) => {
    // never let the container's own drag start from the handle
    event.stopPropagation()
    event.preventDefault()
    const el = (event.target as HTMLElement).closest("[data-diagram-group]") as HTMLElement | null
    if (!el) return
    const startX = event.clientX
    const startY = event.clientY
    const zoom = flow.getZoom() || 1
    const w0 = el.offsetWidth
    const h0 = el.offsetHeight
    const move = (e: PointerEvent) => {
      const w = Math.max(120, w0 + (e.clientX - startX) / zoom)
      const h = Math.max(80, h0 + (e.clientY - startY) / zoom)
      data.onResize(id, { w: Math.round(w), h: Math.round(h) })
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }
  return (
    <div
      className="relative w-full h-full box-border flex items-start gap-1 py-2 px-3 border-[1.5px] border-solid [border-color:var(--dt-group-accent)] rounded-xl bg-[color-mix(in_srgb,var(--dt-group-accent)_7%,transparent)] cursor-grab active:cursor-grabbing"
      style={{ "--dt-group-accent": data.accent } as CSSProperties}
      data-diagram-group
    >
      <Icon name="gripper" className="[color:var(--dt-group-accent)] opacity-70" />
      <span className="text-[12px] font-semibold [color:var(--dt-group-accent)]">{data.label}</span>
      {/* `nodrag`: React Flow's own class for "a drag starting here is not the node's" */}
      <span
        className="nodrag absolute right-0.5 bottom-0.5 w-3.5 h-3.5 cursor-nwse-resize border-r-2 border-b-2 [border-color:var(--dt-group-accent)] rounded-br-[10px] opacity-60"
        title="Resize"
        onPointerDown={onGrab}
      />
    </div>
  )
}
