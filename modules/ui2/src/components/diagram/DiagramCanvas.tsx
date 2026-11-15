/**
 * THE ONE DIAGRAM CANVAS (ported from @dreamteamer/ui's components/diagram/DiagramCanvas.vue, Vue Flow → React
 * Flow): presentational — a `DiagramModel` and a position map go in; `onMove` (a node dropped), `onDragging` (a node
 * moving, continuously, so a container's members can follow it), `onOpen` (a node double-clicked) and `onResize`
 * (a container's corner dragged) come out. It knows nothing of descriptors, records or the engine, which is what lets
 * the same canvas draw a schema, a record graph, or whatever a provider invents next.
 *
 * The diagram craft lives here once: group accents, hover-neighbourhood dimming, labels that arrive as you zoom in
 * (a dot's name is hidden below `LABEL_ZOOM` unless it or a neighbour is hovered), and the fit after measure.
 *
 * ⚠ THE FIT follows `fitToken`, never the node array: the nodes rebuild on every hover (dimming lives in their data),
 * and refitting off them yanks the viewport back to centre whenever the cursor crosses a node. The fit waits a beat
 * after the token moves, because React Flow measures nodes through a ResizeObserver that reports after the paint.
 *
 * ⚠ The nodes are the canvas's own state, re-derived from the props whenever they change — except the one being
 * dragged, which keeps the position React Flow is moving it to until it is dropped.
 */
import {
  applyNodeChanges,
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { useEffect, useMemo, useRef, useState } from "react"
import type { LayoutBox } from "../../lib/diagram/layout.ts"
import type { DiagramModel } from "../../lib/diagram/types.ts"
import { DotNode, EntityNode, GroupNode } from "./DiagramNodes.tsx"

/** Fixed hues rather than generated ones: checked to read on both themes, and a stable palette draws the same model
 *  the same colours every time it is opened. */
const ACCENTS = ["#7c5cff", "#0e9f6e", "#e2a300", "#e5484d", "#3b82f6", "#c026d3", "#0891b2", "#ea580c"]
const UNGROUPED_ACCENT = "#64748b"
const LABEL_ZOOM = 0.72

/** A declared relation's cardinality, read in the direction the arrow points (source = the side holding the key);
 *  a bare one-way reference keeps `N`/`1` — the distinction between a relation and a pointer is worth seeing. */
const KIND_LABEL = { m2o: "N:1", o2o: "1:1", m2m: "N:M" } as const

const nodeTypes: NodeTypes = { dtentity: EntityNode, dtdot: DotNode, dtgroup: GroupNode } as unknown as NodeTypes

export interface DiagramCanvasProps {
  model: DiagramModel
  positions: Map<string, { x: number; y: number }>
  /** Container boxes, when the auto-layout produced them (grouped layouts only). */
  groupBoxes?: Map<string, LayoutBox> | undefined
  /** Bumped by the List when the AUTO layout changed and the viewport should refit. */
  fitToken: number
  onMove(id: string, pos: { x: number; y: number }): void
  onDragging(id: string, pos: { x: number; y: number }): void
  onOpen(id: string): void
  onResize(id: string, size: { w: number; h: number }): void
}

export function DiagramCanvas(props: DiagramCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}

const isModelNode = (id: string) => !id.startsWith("group:")

function Canvas({ model, positions, groupBoxes, fitToken, onMove, onDragging, onOpen, onResize }: DiagramCanvasProps) {
  const flow = useReactFlow()
  const [hovered, setHovered] = useState<string | null>(null)
  const [showLabels, setShowLabels] = useState(true)
  const dragging = useRef<string | null>(null)
  const resize = useRef(onResize)
  resize.current = onResize

  useEffect(() => {
    const t = setTimeout(() => void flow.fitView({ padding: 0.1, maxZoom: 1 }), 120)
    return () => clearTimeout(t)
  }, [fitToken, flow])

  const accentOf = useMemo(() => new Map(model.groups.map((g, i) => [g.id, ACCENTS[i % ACCENTS.length]!])), [model])
  const shapeOf = useMemo(() => new Map(model.nodes.map(n => [n.id, n.shape])), [model])
  const neighbours = useMemo(() => {
    const set = new Set<string>()
    if (!hovered) return set
    set.add(hovered)
    for (const e of model.edges) {
      if (e.source === hovered) set.add(e.target)
      if (e.target === hovered) set.add(e.source)
    }
    return set
  }, [hovered, model])

  const derived = useMemo<Node[]>(() => {
    const dimming = hovered !== null
    const onGroupResize = (id: string, size: { w: number; h: number }) => resize.current(id, size)
    // containers first so they paint behind their members
    const groups: Node[] = [...(groupBoxes?.entries() ?? [])].map(([group, box]) => ({
      id: `group:${group}`,
      type: "dtgroup",
      position: { x: box.x, y: box.y },
      style: { width: box.width, height: box.height },
      data: {
        label: model.groups.find(g => g.id === group)?.label ?? group,
        accent: accentOf.get(group) ?? UNGROUPED_ACCENT,
        onResize: onGroupResize,
      },
      selectable: false,
      draggable: true,
      zIndex: 0,
    }))
    const members: Node[] = model.nodes.flatMap(n => {
      const p = positions.get(n.id)
      if (!p) return []
      const accent = n.group ? (accentOf.get(n.group) ?? UNGROUPED_ACCENT) : UNGROUPED_ACCENT
      const dimmed = dimming && !neighbours.has(n.id)
      return [
        {
          id: n.id,
          type: n.shape === "entity" ? "dtentity" : "dtdot",
          position: p,
          zIndex: 1,
          data:
            n.shape === "entity"
              ? { label: n.label, icon: n.icon, system: n.system, fields: n.fields, accent, dimmed }
              : {
                  label: n.label,
                  group: n.group ?? "",
                  ghost: n.ghost === true,
                  accent,
                  // degree drives the radius, so hubs read as hubs — clamped so one can't swallow the canvas
                  size: Math.min(34, 10 + (n.degree ?? 0) * 2.5),
                  dimmed,
                  showLabel: showLabels || hovered === n.id || neighbours.has(n.id),
                },
        },
      ]
    })
    return [...groups, ...members]
  }, [model, positions, groupBoxes, accentOf, hovered, neighbours, showLabels])

  const [nodes, setNodes] = useState<Node[]>(derived)
  useEffect(() => {
    setNodes(current => {
      const held = dragging.current ? current.find(n => n.id === dragging.current) : undefined
      return held
        ? derived.map(n => (n.id === held.id ? { ...n, position: held.position, dragging: true } : n))
        : derived
    })
  }, [derived])
  const onNodesChange = (changes: NodeChange[]) => setNodes(ns => applyNodeChanges(changes, ns))

  const edges = useMemo<Edge[]>(() => {
    const dimming = hovered !== null
    return model.edges.map(e => {
      const lit = !dimming || (neighbours.has(e.source) && neighbours.has(e.target))
      const entity = shapeOf.get(e.source) === "entity"
      const label = entity ? (e.kind ? KIND_LABEL[e.kind] : e.many ? "N" : "1") : dimming && lit ? e.field : undefined
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        // an entity anchors per field; a nested reference (`attendees.contact`) on its top-level row
        ...(entity ? { sourceHandle: (e.sourceField ?? e.field).split(".")[0], targetHandle: "__id" } : {}),
        type: entity ? "smoothstep" : "straight",
        ...(label ? { label } : {}),
        animated: dimming && lit,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { opacity: lit ? (entity ? 1 : 0.75) : entity ? 0.1 : 0.06 },
        zIndex: 2,
      }
    })
  }, [model, hovered, neighbours, shapeOf])

  return (
    <ReactFlow
      className="ui2-diagram-flow"
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      minZoom={0.02}
      maxZoom={2.5}
      fitView
      onMove={(_, viewport) => setShowLabels(viewport.zoom >= LABEL_ZOOM)}
      onNodeMouseEnter={(_, n) => setHovered(isModelNode(n.id) ? n.id : null)}
      onNodeMouseLeave={() => setHovered(null)}
      onNodeDragStart={(_, n) => (dragging.current = n.id)}
      onNodeDrag={(_, n) => onDragging(n.id, n.position)}
      onNodeDragStop={(_, n) => {
        dragging.current = null
        onMove(n.id, n.position)
      }}
      onNodeDoubleClick={(_, n) => isModelNode(n.id) && onOpen(n.id)}
      zoomOnDoubleClick={false}
    >
      <Background gap={16} size={1.1} color="var(--ui2-border)" />
      <Controls showInteractive={false} />
      {/* maskColor is a prop, not CSS: a neutral at low alpha is the one value that reads on both themes */}
      <MiniMap
        pannable
        zoomable
        maskColor="rgba(127,127,127,0.32)"
        nodeColor={n => String((n.data as { accent?: string } | undefined)?.accent ?? "#888")}
      />
    </ReactFlow>
  )
}
