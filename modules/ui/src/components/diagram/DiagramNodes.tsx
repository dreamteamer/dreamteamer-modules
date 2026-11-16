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
      className={`dt-gnode${data.dimmed ? " is-dimmed" : ""}${data.ghost ? " is-ghost" : ""}`}
      style={{ width: data.size, height: data.size }}
      title={`${data.group}/${data.label}`}
    >
      <Handle type="target" position={Position.Left} className="dt-gnode-handle" />
      <span
        className="dt-gnode-dot"
        style={{ background: data.ghost ? "transparent" : data.accent, borderColor: data.accent }}
      />
      {data.showLabel && <span className="dt-gnode-label">{data.label}</span>}
      <Handle type="source" position={Position.Right} className="dt-gnode-handle" />
    </div>
  )
}

export function EntityNode({ data }: NodeProps<Node<EntityData>>) {
  return (
    <div className={`dt-entity${data.dimmed ? " is-dimmed" : ""}${data.system ? " is-system" : ""}`}>
      <div className="dt-entity-head" style={{ background: data.accent }}>
        <Icon name={data.icon || "table"} />
        <span className="dt-entity-title">{data.label}</span>
        {data.system && (
          <span className="dt-entity-sys" title="engine collection">
            sys
          </span>
        )}
      </div>
      {(data.fields ?? []).map(f => (
        <div key={f.name} className={`dt-entity-row${f.ref ? " is-ref" : ""}${f.isId ? " is-id" : ""}`}>
          {/* the id row is where every incoming reference lands */}
          {f.isId && <Handle type="target" position={Position.Left} id="__id" className="dt-entity-handle" />}
          <span className="dt-entity-name">{f.name}</span>
          {f.isId && <Icon name="key" className="dt-entity-key" />}
          <span className="dt-entity-type">{f.label}</span>
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
    const el = (event.target as HTMLElement).closest(".dt-diagram-group") as HTMLElement | null
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
    <div className="dt-diagram-group" style={{ "--dt-group-accent": data.accent } as CSSProperties}>
      <Icon name="gripper" className="dt-diagram-group-grip" />
      <span className="dt-diagram-group-label">{data.label}</span>
      {/* `nodrag`: React Flow's own class for "a drag starting here is not the node's" */}
      <span className="dt-diagram-group-resize nodrag" title="Resize" onPointerDown={onGrab} />
    </div>
  )
}
