/**
 * ONE RECORD — its fields as a form, the body last, and beside it what the engine says about it (when it was
 * made and last changed, by whom, which source holds it). Save sends only the fields that changed (`PATCH`),
 * validated by the host exactly as `dt set` validates; a refusal is shown as the host's sentence and nothing
 * is written. The same page with no id is the new-record form (`POST`), which moves to the record it made.
 *
 * A draft survives an invalidation: a change on disk re-reads the record, and the form takes the new values
 * only while nothing is edited.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { createRecord, getRecord, removeRecord, updateRecord, type RecordDoc } from "../api/client.ts"
import { useApp, useAsync } from "../app-context.tsx"
import { FieldInput } from "../components/FieldInput.tsx"
import { Icon } from "../components/Icon.tsx"
import { Link } from "../components/Link.tsx"
import { Value } from "../components/Value.tsx"
import {
  changedFields,
  editableOf,
  fieldsOf,
  formatValue,
  isComputed,
  labelOf,
  recordTitle,
  singularOf,
  titleOf,
} from "../lib/fields.ts"
import { listRoute, recordRoute } from "../lib/route.ts"

const META: [string, string][] = [
  ["$source", "Source"],
  ["$created-by", "Created by"],
  ["$last-modified-by", "Last changed by"],
  ["$last-commit-message", "Last commit"],
]

export function RecordPage({ collection, id }: { collection: string; id: string | null }) {
  const { descriptors, navigate, editable, version } = useApp()
  const d = descriptors.find(x => x.name === collection)
  const fields = fieldsOf(d)
  const form = editableOf(fields)
  const computed = fields.filter(isComputed)

  const doc = useAsync<RecordDoc | null>(
    () => (id ? getRecord(collection, id) : Promise.resolve(null)),
    [collection, id, version]
  )
  const saved = useMemo(() => {
    const out: Record<string, unknown> = {}
    for (const f of form) out[f.name] = doc.data?.fields[f.name] ?? null
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- form follows the descriptor, which follows collection
  }, [doc.data, collection])

  const [draft, setDraft] = useState<Record<string, unknown>>(saved)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
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
        const made = await createRecord(collection, body)
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
    if (!id || !confirm(`Delete ${recordTitle(doc.data?.fields ?? {}, id)}? This removes its file.`)) return
    void run(async () => {
      await removeRecord(collection, id)
      navigate(listRoute(collection))
    })
  }

  if (id && doc.error) return <Problem collection={collection} text={doc.error} />
  // the previous record stays in hand while the next one loads: draw neither until it arrives
  if (id && doc.data?.id !== id) return <section className="ui2-page ui2-subtle">Loading…</section>

  const all = doc.data?.fields ?? {}
  const title = id ? recordTitle(all, id) : `New ${singularOf(d)}`

  return (
    <section className="ui2-page">
      <header className="ui2-page-head">
        <div>
          <p className="ui2-crumbs">
            <Link to={listRoute(collection)}>{titleOf(d, collection)}</Link>
            {id && <span className="ui2-subtle"> / {id}</span>}
          </p>
          <h1>{title}</h1>
        </div>
        {editable && (
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
              disabled={busy || (!!id && !dirty)}
            >
              <Icon name="save" /> {id ? "Save" : "Create"}
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
          {form.map(f => (
            <div key={f.name} className={`ui2-form-row${f.body ? " is-body" : ""}`}>
              <label htmlFor={`f-${f.name}`} title={f.description}>
                {labelOf(f)}
                {f.required && <span className="ui2-required"> *</span>}
              </label>
              {editable ? (
                <FieldInput
                  id={`f-${f.name}`}
                  field={f}
                  value={draft[f.name]}
                  onChange={v => setDraft(dr => ({ ...dr, [f.name]: v }))}
                />
              ) : (
                <div id={`f-${f.name}`} className={f.body ? "ui2-body" : ""}>
                  <Value field={f} value={all[f.name]} />
                </div>
              )}
            </div>
          ))}
        </form>

        {id && (
          <aside className="ui2-meta">
            <dl>
              {computed.map(f => (
                <div key={f.name}>
                  <dt>{labelOf(f)}</dt>
                  <dd>{f.name === "id" ? id : formatValue(all[f.name] ?? all[f.name.replace(/_/g, "-")], f) || "—"}</dd>
                </div>
              ))}
              {META.filter(([k]) => all[k]).map(([k, label]) => (
                <div key={k}>
                  <dt>{label}</dt>
                  <dd>{String(all[k])}</dd>
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
  const { descriptors } = useApp()
  return (
    <section className="ui2-page">
      <p className="ui2-crumbs">
        <Link to={listRoute(collection)}>
          {titleOf(
            descriptors.find(x => x.name === collection),
            collection
          )}
        </Link>
      </p>
      <p className="ui2-error">{text}</p>
    </section>
  )
}
