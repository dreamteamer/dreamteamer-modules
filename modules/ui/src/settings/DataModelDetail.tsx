/**
 * THE COLLECTION DESIGNER (ported from the Vue ui's pages/DataModelDetail.vue): one collection's fields as a
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
import {
  button,
  buttonSize,
  buttonTone,
  cx,
  dialogActions,
  error as errorBox,
  formRow,
  hint,
  iconButton,
  input,
  menu as menuBox,
  menuItem,
  menuItemTone,
  mono,
  notice,
  noticeTone,
  page,
  pageHead,
  pageHeadSpace,
  popoverAnchor,
  subtle,
  toolbar,
} from "../styles/classes.ts"
import { FieldDrawer } from "./FieldDrawer.tsx"
import { dialogForm, hintErr, sectionLabel } from "./looks.ts"

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const DISCARD = "Discard unsaved field changes?"
const WIDE = new Set(["markdown", "object", "map", "list", "tags"])

/** The two-column field grid, one column when narrow. (was dt-field-grid) */
const fieldGrid = "grid grid-cols-2 gap-2.5 max-w-[920px] items-start max-[720px]:grid-cols-1"
/** A field's small tag; the tone adds its colours. (was dt-field-badge) */
const badge = "px-1.5 rounded text-small font-semibold"
const badgePlain = "bg-bg-hover text-fg-subtle"
const badgeAccent = "bg-[color-mix(in_srgb,var(--dt-accent)_14%,transparent)] text-accent"
const badgeImplicit = "bg-[color-mix(in_srgb,var(--dt-warning)_16%,transparent)] text-warning"
/** A field's name: mono, one line. (was dt-field-card-name) */
const fieldName = "overflow-hidden text-ellipsis whitespace-nowrap font-mono font-semibold"

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
      <button
        type="button"
        className={cx(button, buttonTone.default, buttonSize.default)}
        data-action="add-field"
        onClick={() => setDrawer({ field: null })}
      >
        <Icon name="add" /> Add field
      </button>
      <button
        type="button"
        className={cx(button, buttonTone.danger, buttonSize.default)}
        data-action="delete-collection"
        onClick={() => setDeleting(true)}
      >
        <Icon name="trash" /> Delete collection
      </button>
    </>
  )

  return (
    <section className={embedded ? "pb-[72px]" : cx(page, "pb-[72px]")} data-designer={collection}>
      {embedded ? (
        <div className={cx(toolbar, "justify-end mb-2")}>{actions}</div>
      ) : (
        <header className={cx(pageHead, pageHeadSpace.page)}>
          <div>
            <div className="mb-1 text-small">
              <Link to={`${SCHEMA_BASE}/collections`}>Data Model</Link>
            </div>
            <h1>
              <Icon name={row?.nav.icon ?? "database"} /> {collection}
            </h1>
            {row && row.title !== collection && <p className={subtle}>{row.title}</p>}
          </div>
          <div className={toolbar}>{actions}</div>
        </header>
      )}

      {row && (
        <dl className="grid grid-cols-[minmax(90px,max-content)_1fr] gap-x-3.5 gap-y-1 m-0 max-w-[720px] py-3 px-3.5 border border-border rounded-dt [&_dt]:text-fg-subtle [&_dd]:m-0 [&_dd]:whitespace-pre-wrap [&_dd]:[overflow-wrap:anywhere]">
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

      <h2 className={sectionLabel}>Fields</h2>
      {loadError && <p className={errorBox}>{loadError}</p>}
      {outcome?.notices.map((n, i) => (
        <p key={`n${i}`} className={cx(notice, "mt-0", noticeTone.ok)} data-save-notice>
          <Icon name="check" /> {n}
        </p>
      ))}
      {outcome?.errors.map((n, i) => (
        <p key={`e${i}`} className={cx(notice, "mt-0", noticeTone.error)} role="alert" data-save-error>
          <Icon name="error" /> {n}
        </p>
      ))}
      {outcome?.warnings.map((n, i) => (
        <p key={`w${i}`} className={cx(notice, "mt-0", noticeTone.warning)} data-save-warning>
          <Icon name="warning" /> {n}
        </p>
      ))}

      {locked.length > 0 && (
        <div className={cx(fieldGrid, "mb-2.5")}>
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
      <div className={fieldGrid}>
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
      {loaded && !fields.length && <p className={subtle}>No fields yet.</p>}

      {(dirty || saving) && (
        <div
          className="sticky bottom-3 z-15 flex items-center gap-3 max-w-[920px] mt-4 py-2.5 px-3.5 border border-border rounded-lg bg-bg shadow-[0_8px_24px_rgb(0_0_0/0.18)] font-semibold"
          data-save-bar
        >
          <span>
            <Icon name="edit" /> Unsaved field changes
          </span>
          {saveError && <span className="text-danger font-normal">{saveError}</span>}
          <span className="flex-1" />
          <button
            type="button"
            className={cx(button, buttonTone.default, buttonSize.default)}
            disabled={saving}
            onClick={() => void discard()}
          >
            Discard
          </button>
          <button
            type="button"
            className={cx(button, buttonTone.primary, buttonSize.default)}
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
      className={cx(
        "flex items-center gap-2 py-[9px] pr-1.5 pl-2.5 border rounded-dt",
        WIDE.has(type) && "col-span-full",
        locked ? "bg-bg-subtle" : "bg-bg",
        dragging && "opacity-40",
        over ? "border-focus shadow-[0_0_0_1px_var(--dt-focus)]" : "border-border"
      )}
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
      {!locked && <Icon name="gripper" className="text-fg-subtle" />}
      <div className="flex flex-col gap-[3px] flex-1 min-w-0">
        {locked && !field.mirror ? (
          <span className={fieldName}>{field.key}</span>
        ) : (
          <button
            type="button"
            className={cx(
              fieldName,
              "p-0 border-0 bg-transparent text-fg text-left cursor-pointer hover:text-link hover:underline"
            )}
            title={field.mirror ? `Two-way link with ${linked} — edit it here` : "Edit field"}
            onClick={onEdit}
          >
            {field.key}
          </button>
        )}
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={cx(mono, subtle)}>{type}</span>
          {field.mirror ? (
            <span className={cx(badge, badgeAccent)} title={`Two-way link with ${linked} — kept in step for you`}>
              ↔ linked
            </span>
          ) : (
            locked && <span className={cx(badge, badgeImplicit)}>implicit</span>
          )}
          {field.def["required"] === true && <span className={cx(badge, badgeAccent)}>★ required</span>}
          {hidden && <span className={cx(badge, badgePlain)}>hidden</span>}
        </span>
      </div>
      <div ref={menu.anchor} className={popoverAnchor}>
        <button
          type="button"
          className={iconButton}
          title="Field actions"
          aria-label={`Actions for ${field.key}`}
          aria-expanded={menu.open}
          onClick={() => menu.setOpen(!menu.open)}
        >
          <Icon name="ellipsis" />
        </button>
        {menu.open && (
          <div className={menuBox} role="menu">
            <button
              type="button"
              role="menuitem"
              className={cx(menuItem, menuItemTone.default)}
              data-id="edit"
              onClick={pick(onEdit)}
            >
              <Icon name="edit" /> Edit field
            </button>
            {onToggleHidden && (
              <button
                type="button"
                role="menuitem"
                className={cx(menuItem, menuItemTone.default)}
                data-id="hide"
                onClick={pick(onToggleHidden)}
              >
                <Icon name={hidden ? "eye" : "eye-closed"} /> {hidden ? "Show field" : "Hide field"}
              </button>
            )}
            {onRename && (
              <button
                type="button"
                role="menuitem"
                className={cx(menuItem, menuItemTone.default)}
                data-id="rename"
                onClick={pick(onRename)}
              >
                <Icon name="symbol-field" /> Rename field…
              </button>
            )}
            {onRenameValue && (
              <button
                type="button"
                role="menuitem"
                className={cx(menuItem, menuItemTone.default)}
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
                className={cx(menuItem, menuItemTone.danger)}
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
      <form className={dialogForm} data-rename={what} onSubmit={e => void submit(e)}>
        <p className={subtle}>
          {what === "field"
            ? "Every record, descriptor, view and binding that names the field is rewritten, and committed."
            : "Every record and descriptor holding the value is rewritten, and committed."}
        </p>
        {what === "value" && (
          <label className={formRow}>
            <span>Value</span>
            <Select
              value={from}
              choices={values.map(v => ({ text: v, value: v }))}
              ariaLabel="Value"
              onChange={v => setFrom(String(v))}
            />
          </label>
        )}
        <label className={formRow}>
          <span>New {what === "field" ? "name" : "value"}</span>
          <input
            className={cx(input, mono)}
            value={to}
            aria-label={`New ${what}`}
            spellCheck={false}
            onChange={e => setTo(e.target.value)}
          />
        </label>
        {to.trim() !== from && to.trim() !== "" && problem && <p className={hintErr}>{problem}</p>}
        {planned && (
          <div
            className="py-2 px-2.5 border border-border rounded-dt bg-bg-subtle [&_p]:m-0 [&_ul]:mt-1 [&_ul]:mx-0 [&_ul]:mb-0 [&_ul]:pl-[18px]"
            data-plan
          >
            <p>{renamePlanLine(plan.answer)}</p>
            <ul className={hint}>
              {planFiles(plan.answer).map(f => (
                <li key={f} className={mono}>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className={errorBox}>{error}</p>}
        <div className={dialogActions}>
          <button type="button" className={cx(button, buttonTone.default, buttonSize.default)} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={cx(button, buttonTone.primary, buttonSize.default)}
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
      <form className={dialogForm} data-delete-collection onSubmit={e => void remove(e)}>
        <p className={subtle}>
          This removes the descriptor — the collection leaves the schema. The engine refuses while records remain under
          it (remove them first). Type <code>{collection}</code> to confirm.
        </p>
        <input
          className={cx(input, mono)}
          value={typed}
          placeholder={collection}
          aria-label="Collection name"
          onChange={e => setTyped(e.target.value)}
        />
        {error && <p className={errorBox}>{error}</p>}
        <div className={dialogActions}>
          <button type="button" className={cx(button, buttonTone.default, buttonSize.default)} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={cx(button, buttonTone.danger, buttonSize.default)}
            disabled={typed !== collection || busy}
          >
            {busy ? "Deleting…" : "Delete descriptor"}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
