/**
 * ONE RECORD — drawn from the display contract: the form's fields in the collection's `form.sections` (an
 * unnamed section for the rest; a collapsed one shut and last), each by its resolved Edit when the field takes
 * a control here and by its View when it does not (a computed or create-only field), the body last; beside it
 * the engine's facts (the fields the record surface draws and the form leaves out) and where the record lives.
 *
 * Save sends only the fields that changed (`PATCH`), validated by the host exactly as `dt set` validates; a
 * refusal is shown as the host's sentence and nothing is written. The same page with no id is the new-record
 * form (`POST`), which moves to the record it made.
 *
 * A draft survives an invalidation: a change on disk re-reads the record, and the form takes the new values
 * only while nothing is edited.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { createRecord, getRecord, removeRecord, updateRecord, type RecordDoc } from "../api/client.ts"
import type { FieldRow } from "../api/types.ts"
import { useApp, useAsync } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { Link } from "../components/Link.tsx"
import { computedReason, formSections, isBodyField } from "../lib/field-row.ts"
import { changedFields, formFields, recordFacts, recordLabel } from "../lib/schema.ts"
import { listRoute, queryOf, recordRoute } from "../lib/route.ts"
import { TARGET_QUERY } from "../lib/created-visibility.ts"
import { RenderEdit, RenderView } from "../render/Render.tsx"

const META: [string, string][] = [
  ["$source", "Source"],
  ["$created-by", "Created by"],
  ["$last-modified-by", "Last changed by"],
  ["$last-commit-message", "Last commit"],
]

/** A record's value for a field, whichever spelling the host used (`last_modified` / `last-modified`). */
const valueOf = (fields: Record<string, unknown>, name: string) => fields[name] ?? fields[name.replace(/_/g, "-")]

/** `?prefill=` as an object of field values; anything else is no prefill. */
function parsePrefill(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function RecordPage({ collection, id }: { collection: string; id: string | null }) {
  const { schema, navigate, editable, version, route } = useApp()
  const create = id === null
  // a create from a list carries where it saves (`?target=`, the list's target choice) and what it starts with
  // (`?prefill=`, a JSON object of field values)
  const query = queryOf(route)
  const target = create ? query[TARGET_QUERY] : undefined
  const prefill = create ? parsePrefill(query["prefill"]) : {}
  const row = schema.collection(collection)
  const all = schema.fields(collection)
  const drawn = formFields(all, create)
  const controls = drawn.filter(d => d.control).map(d => d.field)

  const doc = useAsync<RecordDoc | null>(
    () => (id ? getRecord(collection, id) : Promise.resolve(null)),
    [collection, id, version]
  )
  const saved = useMemo(() => {
    const out: Record<string, unknown> = {}
    for (const f of controls) out[f.field] = doc.data?.fields[f.field] ?? prefill[f.field] ?? f.default ?? null
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the controls follow the schema, which follows collection
  }, [doc.data, collection, schema])

  const [draft, setDraft] = useState<Record<string, unknown>>(saved)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const dirty = Object.keys(changedFields(saved, draft)).length > 0

  // a re-read takes the form only while nothing is edited — compared with the PREVIOUS read, which is what
  // the draft started from (against the new one, the first load's empty draft would count as an edit)
  const previous = useRef(saved)
  useEffect(() => {
    const before = previous.current
    previous.current = saved
    setDraft(d => (Object.keys(changedFields(before, d)).length ? d : saved))
  }, [saved])
  // a different record starts clean
  useEffect(() => {
    setDraft(previous.current)
    setError(null)
  }, [collection, id])

  const run = async (act: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await act()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      if (!id) {
        const body = Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== null && v !== ""))
        const made = await createRecord(collection, body, target)
        navigate(recordRoute(collection, made.id))
        return
      }
      const changes = changedFields(saved, draft)
      if (!Object.keys(changes).length) return
      const out = await updateRecord(collection, id, changes)
      // a rename by the id template moves the record
      if (out?.id && out.id !== id) navigate(recordRoute(collection, out.id))
    })
  }

  const remove = () => {
    if (!id || !confirm(`Delete ${recordLabel(row, doc.data?.fields ?? {}, id)}? This removes its file.`)) return
    void run(async () => {
      await removeRecord(collection, id)
      navigate(listRoute(collection))
    })
  }

  if (id && doc.error) return <Problem collection={collection} text={doc.error} />
  // the previous record stays in hand while the next one loads: draw neither until it arrives
  if (id && doc.data?.id !== id) return <section className="ui2-page ui2-subtle">Loading…</section>

  const values = doc.data?.fields ?? {}
  const title = id ? recordLabel(row, values, id) : `New ${row?.record_type ?? "record"}`
  const canWrite = editable && !row?.runtime

  const fieldRow = (f: FieldRow) => {
    const control = canWrite && controls.includes(f)
    const reason = control ? null : computedReason(f, { create, target: schema.target(f)?.collection })
    return (
      <div key={f.field} className={`ui2-form-row${isBodyField(f) ? " is-body" : ""}${control ? "" : " is-computed"}`}>
        <label htmlFor={`f-${f.field}`} title={f.description}>
          {f.title}
          {f.required && control && <span className="ui2-required"> *</span>}
        </label>
        {control ? (
          <RenderEdit
            id={`f-${f.field}`}
            field={f}
            value={draft[f.field]}
            create={create}
            onChange={v => setDraft(dr => ({ ...dr, [f.field]: v }))}
          />
        ) : (
          <div id={`f-${f.field}`} title={reason ?? undefined}>
            <RenderView field={f} value={valueOf(values, f.field)} context="record" record={values} />
          </div>
        )}
      </div>
    )
  }

  const shownFields = drawn.map(d => d.field)
  const sections = formSections(shownFields, row?.form.sections)
  const body = shownFields.find(isBodyField)
  const facts = recordFacts(all)

  return (
    <section className="ui2-page">
      <header className="ui2-page-head">
        <div>
          <p className="ui2-crumbs">
            <Link to={listRoute(collection)}>{row?.title ?? collection}</Link>
            {id && <span className="ui2-subtle"> / {id}</span>}
          </p>
          <h1>{title}</h1>
        </div>
        {canWrite && (
          <div className="ui2-toolbar">
            {id && (
              <button type="button" className="ui2-button is-danger" onClick={remove} disabled={busy}>
                <Icon name="trash" /> Delete
              </button>
            )}
            {id && (
              <button type="button" className="ui2-button" onClick={() => setDraft(saved)} disabled={!dirty || busy}>
                Revert
              </button>
            )}
            <button
              type="submit"
              form="ui2-record"
              className="ui2-button is-primary"
              disabled={busy || (!create && !dirty)}
            >
              <Icon name="save" /> {create ? "Create" : "Save"}
            </button>
          </div>
        )}
      </header>

      {error && (
        <p className="ui2-error" role="alert">
          {error}
        </p>
      )}

      <div className="ui2-record">
        <form id="ui2-record" className="ui2-form" onSubmit={save}>
          {sections.map(s =>
            s.title ? (
              <fieldset key={s.title} className="ui2-section">
                <legend>
                  {s.collapsed ? (
                    <button
                      type="button"
                      className="ui2-link-button"
                      onClick={() =>
                        setOpen(o => {
                          const n = new Set(o)
                          if (n.has(s.title)) n.delete(s.title)
                          else n.add(s.title)
                          return n
                        })
                      }
                    >
                      <Icon name={open.has(s.title) ? "chevron-down" : "chevron-right"} /> {s.title}
                    </button>
                  ) : (
                    s.title
                  )}
                </legend>
                {(!s.collapsed || open.has(s.title)) && s.fields.map(fieldRow)}
              </fieldset>
            ) : (
              <div key="" className="ui2-form">
                {s.fields.map(fieldRow)}
              </div>
            )
          )}
          {body && fieldRow(body)}
        </form>

        {id && (
          <aside className="ui2-meta">
            <dl>
              <div>
                <dt>Id</dt>
                <dd>{id}</dd>
              </div>
              {facts
                .filter(f => f.field !== "id")
                .map(f => (
                  <div key={f.field}>
                    <dt title={f.description}>{f.title}</dt>
                    <dd>
                      <RenderView field={f} value={valueOf(values, f.field)} context="record" record={values} />
                    </dd>
                  </div>
                ))}
              {META.filter(([k]) => values[k]).map(([k, label]) => (
                <div key={k}>
                  <dt>{label}</dt>
                  <dd>{String(values[k])}</dd>
                </div>
              ))}
              {doc.data?.path && (
                <div>
                  <dt>File</dt>
                  <dd className="ui2-mono">{doc.data.path}</dd>
                </div>
              )}
            </dl>
          </aside>
        )}
      </div>
    </section>
  )
}

function Problem({ collection, text }: { collection: string; text: string }) {
  const { schema } = useApp()
  return (
    <section className="ui2-page">
      <p className="ui2-crumbs">
        <Link to={listRoute(collection)}>{schema.collection(collection)?.title ?? collection}</Link>
      </p>
      <p className="ui2-error">{text}</p>
    </section>
  )
}
