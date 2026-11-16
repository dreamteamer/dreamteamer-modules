/**
 * THE DIAGRAM — the built-in `diagram` List (ported from the Vue ui's ListDiagram.vue): an ordinary layout,
 * like the table — the filter scopes it, the sort orders it, and saving it is saving a `ui-view`.
 *
 * There is no separate "schema diagram": `collections` is a collection whose records are descriptors, and a diagram
 * over it is this layout with `link_by: schema` — collection descriptors drawn as ENTITY nodes (a table with its
 * field rows), grouped by module, an edge per reference (`lib/diagram/providers/buildSchemaRefs.ts`, over the display
 * contract: the presentation's collection rows, field rows and relation rows). Over any other collection a record
 * is a DOT and an edge is a typed reference, a shared value, or a value drawn as a node of its own
 * (`providers/record-links.ts`).
 *
 * LAYOUT: a grouped packing (dagre per group, `lib/diagram/layout.ts`) for entity nodes or a chosen `group_by`,
 * a settled force simulation otherwise — re-solved only when WHICH nodes exist, their heights, the edge count or
 * the solver change (`layoutKey`), never because an option moved: dragging a node writes an option. A hand
 * placement is written into the layout's options (`arrangement`), which is what makes Save persist it; a node's
 * placement is RELATIVE TO ITS GROUP, and a dragged group (`group:<id>`) carries its members — live, while it moves.
 * A resized group keeps its size on the same entry.
 *
 * An empty canvas says WHY, and names the control that fixes it.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { getPresentation, listRecords, type Row } from "../api/client.ts"
import { useApp, useAsync } from "../AppContext.tsx"
import { DiagramCanvas } from "../components/diagram/DiagramCanvas.tsx"
import { layoutForce, layoutGrouped, type LayoutBox, type SizedNode } from "../lib/diagram/layout.ts"
import { buildRecordLinks, type LinkMode } from "../lib/diagram/providers/record-links.ts"
import {
  buildSchemaRefs,
  type SchemaCollectionRow,
  type SchemaFieldRow,
  type SchemaRelationRow,
} from "../lib/diagram/providers/buildSchemaRefs.ts"
import { isRelationField } from "../lib/field-row.ts"
import { tryRenderDisplay } from "../lib/template.ts"
import type { ListProps } from "../registry/props.ts"
import { listEmpty } from "../styles/classes.ts"

/** Entity node size has to be known BEFORE the DOM exists — the solver places boxes, not elements. These track the
 *  entity node's row padding and font size in components/diagram/DiagramNodes.tsx; change them together. A dot is
 *  uniform. */
const HEAD_H = 30
const ROW_H = 23
const NODE_W = 232
const DOT_BOX = 34

/** A hand placement; `w`/`h` only on a resized GROUP — a node's size comes from its content. */
type Placement = { node: string; x: number; y: number; w?: number; h?: number }

export function ListDiagram({ state }: ListProps) {
  const { schema, version } = useApp()
  const options = state.listOptions["diagram"] ?? {}
  const linkBy = (options["link_by"] as LinkMode | "schema" | undefined) ?? "references"
  const nodeStyle = (options["node"] as "dot" | "box" | "table" | undefined) ?? "dot"
  const records = state.records

  const relationFields = state.fields.filter(f => isRelationField(f)).map(f => f.field)
  const linkFields = (() => {
    const chosen = (options[linkBy === "references" ? "ref_fields" : "value_fields"] as string[] | undefined) ?? []
    if (chosen.length) return chosen
    if (linkBy === "references") return relationFields
    // a value mode has no honest "all" — every field would link every record through its timestamps
    return state.fields.some(f => f.field === "tags") ? ["tags"] : []
  })()
  const labelTemplate = String(options["label_template"] ?? "").trim()
  const labelOf = (r: Record<string, unknown>) =>
    (labelTemplate ? (tryRenderDisplay(labelTemplate, r) ?? "").trim() : "") ||
    state.recordTitleOf(r as Row) ||
    String(r["id"] ?? "")

  // ── the schema diagram's inputs: the display contract, and the modules' titles for the group boxes ──
  const schemaMode = linkBy === "schema"
  const presentation = useAsync(() => (schemaMode ? getPresentation() : Promise.resolve(null)), [schemaMode, version])
  const modules = useAsync(
    () =>
      schemaMode
        ? listRecords("modules", { limit: 200 }).then(
            page => Object.fromEntries(page.records.map(m => [m.id, String(m["title"] ?? m.id)])),
            () => ({}) // an engine with no `modules` collection: the group box keeps the raw id
          )
        : Promise.resolve({}),
    [schemaMode, version]
  )
  const isDescriptors = records.some(r => r["fields"] && typeof r["fields"] === "object" && r["compiled"])

  const model = useMemo(() => {
    if (schemaMode) {
      const collections: SchemaCollectionRow[] = schema.collections.map(c => ({
        collection: c.collection,
        title: c.title,
        nav: { ...(c.nav?.icon ? { icon: c.nav.icon } : {}) },
        internal: c.internal,
      }))
      const fields: Record<string, SchemaFieldRow[]> = {}
      for (const r of records) {
        const name = String(r["name"] ?? r.id).replace(/^\/?collections\//, "")
        fields[name] = (presentation.data?.fields[name] ?? []) as SchemaFieldRow[]
      }
      return buildSchemaRefs(
        {
          records,
          collections,
          fields,
          relations: (presentation.data?.relations ?? []) as unknown as SchemaRelationRow[],
        },
        {
          detail: nodeStyle === "table" ? ((options["detail"] as "refs" | "all" | undefined) ?? "all") : "title",
          moduleTitles: modules.data ?? {},
          showSystem: options["show_system"] === true,
          showIsolated: options["show_isolated"] === true,
        }
      )
    }
    return buildRecordLinks({
      collection: state.collection,
      records,
      pkOf: r => String(r["id"] ?? ""),
      labelOf,
      mode: linkBy,
      fields: linkFields,
      groupBy: (options["group_by"] as string | undefined) || null,
      shape: nodeStyle === "dot" ? "dot" : "entity",
      hideLeaves: options["hide_leaves"] === true,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- labelOf/linkFields derive from options and fields
  }, [schemaMode, records, schema, presentation.data, modules.data, options, state.fields, state.collection])

  const useGrouped = nodeStyle !== "dot" || Boolean(options["group_by"])
  const layoutKey =
    `${useGrouped ? "g" : "f"}|${model.edges.length}|` +
    model.nodes.map(n => `${n.id}:${n.fields?.length ?? 0}`).join(",")
  const modelNow = useRef(model)
  modelNow.current = model
  const [auto, setAuto] = useState<{
    positions: Map<string, { x: number; y: number }>
    groupBoxes?: Map<string, LayoutBox>
  }>({
    positions: new Map(),
  })
  const [fitToken, setFitToken] = useState(0)
  useEffect(() => {
    const m = modelNow.current
    const sized: SizedNode[] = m.nodes.map(n => ({
      id: n.id,
      width: n.shape === "entity" ? NODE_W : DOT_BOX,
      height: n.shape === "entity" ? HEAD_H + (n.fields?.length ?? 0) * ROW_H : DOT_BOX,
      ...(n.group ? { group: n.group } : {}),
    }))
    setAuto(useGrouped ? layoutGrouped(sized, m.edges) : { positions: layoutForce(m.nodes, m.edges) })
    // refit only alongside a genuine re-solve — never on a hand placement
    setFitToken(t => t + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is what the layout depends on
  }, [layoutKey])

  // ── hand placements over the auto layout ──
  const arrangement = (options["arrangement"] ?? []) as Placement[]
  const [liveDrag, setLiveDrag] = useState<{ group: string; dx: number; dy: number } | null>(null)
  const groupOffsets = useMemo(() => {
    const out = new Map<string, { dx: number; dy: number }>()
    for (const p of arrangement) {
      if (!p.node.startsWith("group:")) continue
      const id = p.node.slice("group:".length)
      const box = auto.groupBoxes?.get(id)
      if (box) out.set(id, { dx: p.x - box.x, dy: p.y - box.y })
    }
    // the drag in progress: members follow the container while it moves, not on release
    if (liveDrag) out.set(liveDrag.group, { dx: liveDrag.dx, dy: liveDrag.dy })
    return out
  }, [arrangement, auto, liveDrag])

  const positions = useMemo(() => {
    const merged = new Map(auto.positions)
    const byNode = new Map(arrangement.filter(p => !p.node.startsWith("group:")).map(p => [p.node, p]))
    for (const n of model.nodes) {
      const own = byNode.get(n.id)
      const base = own ? { x: own.x, y: own.y } : merged.get(n.id)
      if (!base) continue
      // a placement is RELATIVE TO ITS GROUP: moving a container moves what is inside it
      const off = n.group ? groupOffsets.get(n.group) : undefined
      merged.set(n.id, off ? { x: base.x + off.dx, y: base.y + off.dy } : base)
    }
    return merged
  }, [auto, arrangement, model, groupOffsets])

  const groupBoxes = useMemo(() => {
    if (!auto.groupBoxes) return undefined
    const out = new Map(auto.groupBoxes)
    for (const [id, off] of groupOffsets) {
      const box = out.get(id)
      if (box) out.set(id, { ...box, x: box.x + off.dx, y: box.y + off.dy })
    }
    // a hand-set size wins over the solver's bounding box
    for (const p of arrangement) {
      if (!p.node.startsWith("group:") || p.w == null || p.h == null) continue
      const box = out.get(p.node.slice("group:".length))
      if (box) out.set(p.node.slice("group:".length), { ...box, width: p.w, height: p.h })
    }
    return out
  }, [auto, groupOffsets, arrangement])

  const write = (next: Placement[]) => state.setListOptions("diagram", { ...options, arrangement: next })
  const onMove = (id: string, pos: { x: number; y: number }) => {
    // stored RELATIVE to its group: the drawn position already includes the offset
    const node = model.nodes.find(n => n.id === id)
    const off = node?.group ? groupOffsets.get(node.group) : undefined
    setLiveDrag(null)
    const saved = [...arrangement]
    const at = saved.findIndex(p => p.node === id)
    const entry: Placement = { node: id, x: Math.round(pos.x - (off?.dx ?? 0)), y: Math.round(pos.y - (off?.dy ?? 0)) }
    // a group keeps the size it was given
    if (at === -1) saved.push(entry)
    else saved[at] = { ...saved[at]!, ...entry }
    write(saved)
  }
  const onDragging = (id: string, pos: { x: number; y: number }) => {
    if (!id.startsWith("group:")) return
    const group = id.slice("group:".length)
    const box = auto.groupBoxes?.get(group)
    if (box) setLiveDrag({ group, dx: pos.x - box.x, dy: pos.y - box.y })
  }
  const onResize = (id: string, size: { w: number; h: number }) => {
    const saved = [...arrangement]
    const at = saved.findIndex(p => p.node === id)
    const box = auto.groupBoxes?.get(id.slice("group:".length))
    const entry: Placement = {
      node: id,
      x: saved[at]?.x ?? box?.x ?? 0,
      y: saved[at]?.y ?? box?.y ?? 0,
      w: size.w,
      h: size.h,
    }
    if (at === -1) saved.push(entry)
    else saved[at] = { ...saved[at]!, ...entry }
    write(saved)
  }
  /** A node id is `<collection>/<id>`; only a record this browse loaded opens. */
  const onOpen = (id: string) => {
    const own = `${state.collection}/`
    const rec = id.startsWith(own) ? records.find(r => r.id === id.slice(own.length)) : undefined
    if (rec) state.openRecord(rec)
  }

  const emptyReason = !records.length
    ? state.loading
      ? "Loading…"
      : "No records in this view."
    : schemaMode && !isDescriptors
      ? "These records are not collection descriptors — pick another Link by."
      : linkBy === "references" && !relationFields.length
        ? "No reference fields on this collection — link by a shared value or by values instead."
        : linkBy !== "references" && !linkFields.length
          ? "Pick a field to link by."
          : "Nothing to draw."

  return (
    <div className="flex flex-col flex-auto min-h-[420px]">
      {!model.nodes.length ? (
        <p className={listEmpty}>{emptyReason}</p>
      ) : (
        <DiagramCanvas
          model={model}
          positions={positions}
          groupBoxes={groupBoxes}
          fitToken={fitToken}
          onMove={onMove}
          onDragging={onDragging}
          onOpen={onOpen}
          onResize={onResize}
        />
      )}
    </div>
  )
}
