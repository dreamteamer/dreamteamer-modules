/**
 * RenderEdit and RenderView — one field drawn by whatever the registry resolves for it: the field's own
 * `editor`/`viewer` id when registered, else its shape's default (a body, a reference, an enum, a list), else
 * its type's, else the fallback. A component that throws shows the raw value instead (an editor read-only).
 */
import { useMemo } from "react"
import type { FieldRow } from "../api/types.ts"
import { resolveEdit, resolveView } from "../registry/resolve.ts"
import { ErrorBoundary } from "./ErrorBoundary.tsx"

const raw = (v: unknown) =>
  v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)

export function RenderEdit(props: {
  field: FieldRow
  value: unknown
  onChange(value: unknown): void
  id: string
  create?: boolean
  record?: Record<string, unknown>
}) {
  const resolved = useMemo(() => resolveEdit(props.field), [props.field])
  const Edit = resolved.entry.component
  return (
    <ErrorBoundary
      name={`edit:${resolved.entry.id}:${props.field.field}`}
      fallback={
        <span className="dt-render-fallback">
          {raw(props.value)} <em className="dt-subtle">— editor failed, value shown read-only</em>
        </span>
      }
    >
      <Edit {...props} options={props.field.editor_options} />
    </ErrorBoundary>
  )
}

export function RenderView(props: {
  field: FieldRow
  value: unknown
  context?: "cell" | "record"
  record?: Record<string, unknown>
}) {
  const context = props.context ?? "cell"
  const resolved = useMemo(() => resolveView(props.field, context), [props.field, context])
  const View = resolved.entry.component
  return (
    <ErrorBoundary
      name={`view:${resolved.entry.id}:${props.field.field}`}
      fallback={<span className="dt-render-fallback">{raw(props.value)}</span>}
    >
      <View {...props} context={context} options={props.field.viewer_options} />
    </ErrorBoundary>
  )
}
