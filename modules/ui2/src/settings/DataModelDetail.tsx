/**
 * THE COLLECTION DESIGNER (ported from @dreamteamer/ui's pages/DataModelDetail.vue): one collection's fields as a
 * two-column grid that reads like the record form. Engine-held fields, the body and fields DERIVED from a relation
 * sit in a locked block on top; the rest drag to reorder, and each has a menu — Edit field (the drawer), Hide/Show,
 * Rename field…, Rename value… (an enum), Delete field.
 *
 * Two kinds of write, and the page says which is which:
 *  - STAGED: the drawer's Apply, hide and delete change the grid only; the save bar's Save diffs the grid against
 *    what was loaded and writes one compile-gated op per field (`lib/designer-state.ts`), then re-reads. Discard
 *    re-reads. Leaving with staged changes asks first.
 *  - IMMEDIATE: a rename rewrites every record and every source that names the field or the value, so it is not
 *    a staged edit: its dialog shows the engine's dry-run plan first, and Rename writes and commits it at once
 *    (beyond ui, which had the client call but no gesture). Delete collection removes the descriptor.
 *
 * `embedded` drops the page header — the record-scoped `data-model` layout draws this inside a record page.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { deleteCollection, renameField, renameFieldValue } from "../api/client.ts"
import { useApp } from "../app-context.tsx"
import { usePopover } from "../browse/use-popover.ts"
import { Dialog } from "../components/Dialog.tsx"
import { Icon } from "../components/Icon.tsx"
import { Link } from "../components/Link.tsx"
import { Select } from "../components/Select.tsx"
import {
  applyStaged,
  enumValues,
  isDirty,
  loadDesigner,
  moveStaged,
  patchStaged,
  planFiles,
  renamePlanLine,
  renameProblem,
  saveDesigner,
  type Loaded,
  type SaveOutcome,
  type StagedField,
} from "../lib/designer-state.ts"
import { setLeaveGuard } from "../lib/leave-guard.ts"
import { SCHEMA_BASE } from "../lib/route.ts"
import { FieldDrawer } from "./FieldDrawer.tsx"

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const DISCARD = "Discard unsaved field changes?"
const WIDE = new Set(["markdown", "object", "map", "list", "tags"])

type Rename = { kind: "field"; field: StagedField } | { kind: "value"; field: StagedField }

export function DataModelDetail({
  collection,
  openField,
  embedded,
}: {
  collection: string
  /** `?field=` — open this field's drawer once the fields have loaded. */
  openField?: string
  embedded?: boolean
}) {
  const { schema, navigate, refresh } = useApp()
  const row = schema.collection(collection)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [fields, setFields] = useState<StagedField[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<{ field: StagedField | null } | null>(null)
  const [rename, setRename] = useState<Rename | null>(null)
  const [deleting, setDeleting] = useState(false)
  const dirty = loaded ? isDirty(fields, loaded) : false

  const reload = useCallback(async () => {
    setLoadError(null)
    try {
      const next = await loadDesigner(collection)
      setLoaded(next)
      setFields(next.fields)
      return next
    } catch (err) {
      setLoadError(message(err))
      return null
    }
  }, [collection])

  // `?field=` is honoured once, after the first load: the rows do not exist before it
  const opened = useRef(false)
  useEffect(() => {
    void reload().then(next => {
      if (opened.current || !openField || !next) return
      opened.current = true
      const hit = next.fields.find(f => f.key === openField)
      if (hit) setDrawer({ field: hit })
    })
  }, [reload, openField])

  useEffect(() => {
    if (!dirty) return
    return setLeaveGuard(() => confirm(DISCARD))
  }, [dirty])

  const save = async () => {
    if (!loaded) return
    setSaving(true)
    setSaveError(null)
    setOutcome(null)
    try {
      setOutcome(await saveDesigner(collection, loaded, fields))
    } catch (err) {
      setSaveError(message(err))
    } finally {
      setSaving(false)
      refresh()
      await reload()
    }
  }
  const discard = async () => {
    setOutcome(null)
    setSaveError(null)
    await reload()
  }

  // ---- drag to reorder (editable rows only) ------------------------------------------------------------------
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)
  const drop = (target: StagedField) => {
    const from = fields.findIndex(f => f.key === dragKey)
    const to = fields.findIndex(f => f.key === target.key)
    if (from !== -1 && to !== -1) setFields(f => moveStaged(f, from, to))
    setDragKey(null)
    setOverKey(null)
  }

  const locked = fields.filter(f => f.implicit)
  const free = fields.filter(f => !f.implicit)
  const actions = (
    <>
      <button type="button" className="ui2-button" data-action="add-field" onClick={() => setDrawer({ field: null })}>
        <Icon name="add" /> Add field
      </button>
      <button
        type="button"
        className="ui2-button is-danger"
        data-action="delete-collection"
        onClick={() => setDeleting(true)}
      >
        <Icon name="trash" /> Delete collection
      </button>
    </>
  )

  return (
    <section className={embedded ? "ui2-designer is-embedded" : "ui2-page ui2-designer"} data-designer={collection}>
      {embedded ? (
        <div className="ui2-toolbar ui2-designer-actions">{actions}</div>
      ) : (
        <header className="ui2-page-head">
          <div>
            <p className="ui2-crumbs">
              <Link to={`${SCHEMA_BASE}/collections`}>Data Model</Link>
            </p>
            <h1>
              <Icon name={row?.nav.icon ?? "database"} /> {collection}
            </h1>
            {row && row.title !== collection && <p className="ui2-subtle">{row.title}</p>}
          </div>
          <div className="ui2-toolbar">{actions}</div>
        </header>
      )}

      {row && (
        <dl className="ui2-kv ui2-designer-overview">
          <dt>Record type</dt>
          <dd>{row.record_type}</dd>
          <dt>Record title</dt>
          <dd>
            <code>{row.record_title}</code>
          </dd>
          <dt>Read from</dt>
          <dd>{(row.sources ?? []).map(s => `${s.name} (${s.count})`).join(", ") || "—"}</dd>
        </dl>
      )}

      <h2 className="ui2-section-label">Fields</h2>
      {loadError && <p className="ui2-error">{loadError}</p>}
      {outcome?.notices.map((n, i) => (
        <p key={`n${i}`} className="ui2-notice is-ok" data-save-notice>
          <Icon name="check" /> {n}
        </p>
      ))}
      {outcome?.errors.map((n, i) => (
        <p key={`e${i}`} className="ui2-notice is-error" role="alert" data-save-error>
          <Icon name="error" /> {n}
        </p>
      ))}
      {outcome?.warnings.map((n, i) => (
        <p key={`w${i}`} className="ui2-notice is-warning" data-save-warning>
          <Icon name="warning" /> {n}
        </p>
      ))}

      {locked.length > 0 && (
        <div className="ui2-field-grid is-locked">
          {locked.map(f => (
            <FieldCard
              key={f.key}
              field={f}
              locked
              onEdit={() => setDrawer({ field: f })}
              onRemove={f.mirror ? () => setFields(all => all.filter(x => x.key !== f.key)) : undefined}
              onRename={f.mirror && loaded?.defs[f.key] ? () => setRename({ kind: "field", field: f }) : undefined}
            />
          ))}
        </div>
      )}
      <div className="ui2-field-grid">
        {free.map(f => (
          <FieldCard
            key={f.key}
            field={f}
            dragging={dragKey === f.key}
            over={overKey === f.key}
            onDragStart={() => setTimeout(() => setDragKey(f.key))}
            onDragEnter={() => dragKey && dragKey !== f.key && setOverKey(f.key)}
            onDrop={() => drop(f)}
            onDragEnd={() => {
              setDragKey(null)
              setOverKey(null)
            }}
            onEdit={() => setDrawer({ field: f })}
            onToggleHidden={() => setFields(all => patchStaged(all, f.key, { hidden: f.def["hidden"] !== true }))}
            onRemove={() => setFields(all => all.filter(x => x.key !== f.key))}
            // a rename rewrites what is ON DISK, so it is offered on a field that is there and unchanged
            onRename={
              loaded?.defs[f.key] && JSON.stringify(loaded.defs[f.key]) === JSON.stringify(f.def)
                ? () => setRename({ kind: "field", field: f })
                : undefined
            }
            onRenameValue={
              loaded?.defs[f.key] && enumValues(loaded.defs[f.key]!).length
                ? () => setRename({ kind: "value", field: f })
                : undefined
            }
          />
        ))}
      </div>
      {loaded && !fields.length && <p className="ui2-empty">No fields yet.</p>}

      {(dirty || saving) && (
        <div className="ui2-save-bar" data-save-bar>
          <span>
            <Icon name="edit" /> Unsaved field changes
          </span>
          {saveError && <span className="ui2-save-bar-error">{saveError}</span>}
          <span className="ui2-toolbar-spacer" />
          <button type="button" className="ui2-button" disabled={saving} onClick={() => void discard()}>
            Discard
          </button>
          <button
            type="button"
            className="ui2-button is-primary"
            data-action="save"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}

      {drawer && (
        <FieldDrawer
          key={drawer.field?.key ?? "+"}
          collection={collection}
          field={drawer.field}
          existingKeys={fields.map(f => f.key)}
          onClose={() => setDrawer(null)}
          onApply={f => {
            setFields(all => applyStaged(all, f))
            setDrawer(null)
          }}
        />
      )}

      {rename && (
        <RenameDialog
          collection={collection}
          rename={rename}
          taken={fields.map(f => f.key)}
          onClose={() => setRename(null)}
          onDone={async () => {
            setRename(null)
            refresh()
            await reload()
          }}
        />
      )}

      {deleting && (
        <DeleteCollectionDialog
          collection={collection}
          onClose={() => setDeleting(false)}
          onDone={() => {
            setDeleting(false)
            refresh()
            navigate(`${SCHEMA_BASE}/collections`)
          }}
        />
      )}
    </section>
  )
}

function FieldCard({
  field,
  locked,
  dragging,
  over,
  onDragStart,
  onDragEnter,
  onDrop,
  onDragEnd,
  onEdit,
  onToggleHidden,
  onRemove,
  onRename,
  onRenameValue,
}: {
  field: StagedField
  locked?: boolean
  dragging?: boolean
  over?: boolean
  onDragStart?(): void
  onDragEnter?(): void
  onDrop?(): void
  onDragEnd?(): void
  onEdit(): void
  onToggleHidden?(): void
  onRemove?(): void
  onRename?(): void
  onRenameValue?(): void
}) {
  const menu = usePopover()
  const type = typeof field.def["type"] === "string" ? field.def["type"] : "—"
  const hidden = field.def["hidden"] === true
  const pick = (fn?: () => void) => () => {
    menu.setOpen(false)
    fn?.()
  }
  const linked = field.mirror ? `${field.mirror.collection}.${field.mirror.field}` : ""
  return (
    <div
      className={[
        "ui2-field-card",
        WIDE.has(type) ? "is-wide" : "",
        locked ? "is-locked" : "",
        dragging ? "is-dragging" : "",
        over ? "is-over" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-field={field.key}
      draggable={!locked}
      onDragStart={e => {
        e.dataTransfer.effectAllowed = "move"
        onDragStart?.()
      }}
      onDragEnter={e => {
        e.preventDefault()
        onDragEnter?.()
      }}
      onDragOver={e => !locked && e.preventDefault()}
      onDrop={e => {
        e.preventDefault()
        onDrop?.()
      }}
      onDragEnd={onDragEnd}
    >
      {!locked && <Icon name="gripper" className="ui2-field-card-grip" />}
      <div className="ui2-field-card-main">
        {locked && !field.mirror ? (
          <span className="ui2-field-card-name">{field.key}</span>
        ) : (
          <button
            type="button"
            className="ui2-field-card-name is-button"
            title={field.mirror ? `Two-way link with ${linked} — edit it here` : "Edit field"}
            onClick={onEdit}
          >
            {field.key}
          </button>
        )}
        <span className="ui2-field-badges">
          <span className="ui2-mono ui2-subtle">{type}</span>
          {field.mirror ? (
            <span className="ui2-field-badge is-linked" title={`Two-way link with ${linked} — kept in step for you`}>
              ↔ linked
            </span>
          ) : (
            locked && <span className="ui2-field-badge is-implicit">implicit</span>
          )}
          {field.def["required"] === true && <span className="ui2-field-badge is-required">★ required</span>}
          {hidden && <span className="ui2-field-badge">hidden</span>}
        </span>
      </div>
      <div ref={menu.anchor} className="ui2-popover-anchor">
        <button
          type="button"
          className="ui2-icon-button"
          title="Field actions"
          aria-label={`Actions for ${field.key}`}
          aria-expanded={menu.open}
          onClick={() => menu.setOpen(!menu.open)}
        >
          <Icon name="ellipsis" />
        </button>
        {menu.open && (
          <div className="ui2-menu" role="menu">
            <button type="button" role="menuitem" className="ui2-menu-item" data-id="edit" onClick={pick(onEdit)}>
              <Icon name="edit" /> Edit field
            </button>
            {onToggleHidden && (
              <button
                type="button"
                role="menuitem"
                className="ui2-menu-item"
                data-id="hide"
                onClick={pick(onToggleHidden)}
              >
                <Icon name={hidden ? "eye" : "eye-closed"} /> {hidden ? "Show field" : "Hide field"}
              </button>
            )}
            {onRename && (
              <button type="button" role="menuitem" className="ui2-menu-item" data-id="rename" onClick={pick(onRename)}>
                <Icon name="symbol-field" /> Rename field…
              </button>
            )}
            {onRenameValue && (
              <button
                type="button"
                role="menuitem"
                className="ui2-menu-item"
                data-id="rename-value"
                onClick={pick(onRenameValue)}
              >
                <Icon name="symbol-enum" /> Rename value…
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                role="menuitem"
                className="ui2-menu-item is-danger"
                data-id="delete"
                onClick={pick(onRemove)}
              >
                <Icon name="trash" /> Delete field
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Rename a field, or one of its enum values: the dry-run plan first, then the write. */
function RenameDialog({
  collection,
  rename,
  taken,
  onClose,
  onDone,
}: {
  collection: string
  rename: Rename
  taken: string[]
  onClose(): void
  onDone(): void | Promise<void>
}) {
  const key = rename.field.key
  const values = rename.kind === "value" ? enumValues(rename.field.def) : []
  const [from, setFrom] = useState(rename.kind === "field" ? key : (values[0] ?? ""))
  const [to, setTo] = useState(rename.kind === "field" ? key : "")
  const [plan, setPlan] = useState<{ to: string; from: string; answer: Record<string, unknown> | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const what = rename.kind
  const problem = renameProblem(from, to, what === "field" ? taken : values, what)
  const planned = plan && plan.to === to.trim() && plan.from === from
  const call = (dryRun: boolean) =>
    what === "field"
      ? renameField(collection, key, to.trim(), dryRun)
      : renameFieldValue(collection, key, from, to.trim(), dryRun)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (problem || busy) return
    setBusy(true)
    setError(null)
    try {
      if (!planned) {
        setPlan({ to: to.trim(), from, answer: await call(true) })
        return
      }
      await call(false)
      await onDone()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={what === "field" ? `Rename ${collection}.${key}` : `Rename a value of ${collection}.${key}`}
      onClose={onClose}
    >
      <form className="ui2-dialog-form" data-rename={what} onSubmit={e => void submit(e)}>
        <p className="ui2-subtle">
          {what === "field"
            ? "Every record, descriptor, view and binding that names the field is rewritten, and committed."
            : "Every record and descriptor holding the value is rewritten, and committed."}
        </p>
        {what === "value" && (
          <label className="ui2-form-row">
            <span>Value</span>
            <Select
              value={from}
              choices={values.map(v => ({ text: v, value: v }))}
              ariaLabel="Value"
              onChange={v => setFrom(String(v))}
            />
          </label>
        )}
        <label className="ui2-form-row">
          <span>New {what === "field" ? "name" : "value"}</span>
          <input
            className="ui2-input ui2-mono"
            value={to}
            aria-label={`New ${what}`}
            spellCheck={false}
            onChange={e => setTo(e.target.value)}
          />
        </label>
        {to.trim() !== from && to.trim() !== "" && problem && <p className="ui2-hint is-error">{problem}</p>}
        {planned && (
          <div className="ui2-plan" data-plan>
            <p>{renamePlanLine(plan.answer)}</p>
            <ul className="ui2-hint">
              {planFiles(plan.answer).map(f => (
                <li key={f} className="ui2-mono">
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="ui2-error">{error}</p>}
        <div className="ui2-dialog-actions">
          <button type="button" className="ui2-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="ui2-button is-primary"
            data-action={planned ? "rename" : "preview"}
            disabled={busy || !!problem}
          >
            {busy ? "Working…" : planned ? "Rename" : "Preview"}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function DeleteCollectionDialog({
  collection,
  onClose,
  onDone,
}: {
  collection: string
  onClose(): void
  onDone(): void
}) {
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remove = async (e: FormEvent) => {
    e.preventDefault()
    if (typed !== collection || busy) return
    setBusy(true)
    setError(null)
    try {
      await deleteCollection(collection)
      onDone()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title="Delete collection?" onClose={onClose}>
      <form className="ui2-dialog-form" data-delete-collection onSubmit={e => void remove(e)}>
        <p className="ui2-subtle">
          This removes the descriptor — the collection leaves the schema. The engine refuses while records remain under
          it (remove them first). Type <code>{collection}</code> to confirm.
        </p>
        <input
          className="ui2-input ui2-mono"
          value={typed}
          placeholder={collection}
          aria-label="Collection name"
          onChange={e => setTyped(e.target.value)}
        />
        {error && <p className="ui2-error">{error}</p>}
        <div className="ui2-dialog-actions">
          <button type="button" className="ui2-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="ui2-button is-danger" disabled={typed !== collection || busy}>
            {busy ? "Deleting…" : "Delete descriptor"}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
