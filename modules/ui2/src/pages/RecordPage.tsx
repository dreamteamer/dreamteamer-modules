/**
 * ONE RECORD (ported from @dreamteamer/ui's pages/ContentDetail.vue). The page is a frame around a RECORD-SCOPED
 * Edit or View: the record's display (`display.record.layout` — a record-scope ui-view's when the page is that
 * view's route, else the collection's) names it, `page` means the built-in `properties`, and the registries
 * resolve it (`lib/record-display.ts`). An existing record opens READ; the pencil flips the same layout into
 * edit mode in place, where Cancel and Save replace the actions. The new-record form (no id) is edit mode from
 * the start.
 *
 * The frame: the header (`RecordHeader` — the id's path, the title from `record_title` with references read as
 * their targets' titles, the duplicate-id badge, the commit line and where the record is read from), the
 * collection's `display.record` line (subtitle, badges, tint), what extensions say about the record
 * (`NextNotes`), and beside the body a panel of Commands, Info and Revisions.
 *
 * Writes: Save sends only the edited fields (`PATCH`), validated by the host exactly as `dt set` validates; a
 * refusal is the host's sentence, the edits and the edit mode stay. Mod-S saves. A create `POST`s, to the root
 * the target choice named (`?target=`, said in the Saves-to line), seeded by `?prefill=` or a record picked in
 * "Start from existing…", and moves to the record it made. Delete asks; a record others reference is refused
 * with 409 and the dialog then offers to delete it anyway (`?force=true`). Rename asks for the new id
 * (`POST /collections/:c/rename`, every reference rewritten; admin). Leaving with unsaved edits asks first —
 * in-app moves through the app's leave guard, closing the tab through `beforeunload`.
 *
 * A record whose root takes no write from here (`access: read`), or whose every field is computed, draws read
 * only, and says why. A re-read while edits are pending keeps the edits, and says the record changed under them.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createRecord, getRecord, removeRecord, renameRecord, updateRecord, type RecordDoc } from "../api/client.ts"
import { useApp, useAsync, useRouteBase, useSignal } from "../app-context.tsx"
import { usePopover } from "../browse/use-popover.ts"
import { CommitButton } from "../components/CommitButton.tsx"
import { Dialog } from "../components/Dialog.tsx"
import { Icon } from "../components/Icon.tsx"
import { Link } from "../components/Link.tsx"
import { isReferenceField } from "../lib/collection-display.ts"
import {
  excludedBy,
  noteCreated,
  saveRootFor,
  selectionFromQuery,
  SOURCES_QUERY,
  TARGET_QUERY,
} from "../lib/created-visibility.ts"
import { editsAnything } from "../lib/field-row.ts"
import { hostInfo, isAdmin } from "../lib/host.ts"
import { setLeaveGuard } from "../lib/leave-guard.ts"
import { askTitles, knownTitle, referenceTitlesChanged } from "../lib/record-cache.ts"
import { recordDisplayOf, recordRendererId } from "../lib/record-display.ts"
import { recordOrigin } from "../lib/record-origin.ts"
import {
  commitInfo,
  duplicatesOf,
  isReferencedRefusal,
  isSaveShortcut,
  pathCrumbs,
  renameProblem,
  setEdit,
  withEdits,
} from "../lib/record-page.ts"
import { recordPageFields } from "../lib/record-page-fields.ts"
import { listRoute, queryOf, recordRoute } from "../lib/route.ts"
import { recordFacts, recordLabel } from "../lib/schema.ts"
import { hasForeignSource, isTarget, notTargetReason, sourceEntry, stubNoteOf } from "../lib/sources.ts"
import { templateFields, tryRenderDisplay } from "../lib/template.ts"
import { uiViews } from "../lib/ui-views.ts"
import { edits as editRegistry, views as viewRegistry } from "../registry/index.ts"
import type { RecordLayoutProps } from "../registry/props.ts"
import { ErrorBoundary } from "../render/ErrorBoundary.tsx"
import { NextNotes } from "../record/NextNotes.tsx"
import { RecordCommands } from "../record/RecordCommands.tsx"
import { RecordDisplayLine, RecordHeader, type HeaderOrigin } from "../record/RecordHeader.tsx"
import { RecordHistory } from "../record/RecordHistory.tsx"
import { RecordInfo } from "../record/RecordInfo.tsx"
import { RecordSidebar } from "../record/RecordSidebar.tsx"
import { SaveTarget } from "../record/SaveTarget.tsx"
import { TemplatePicker } from "../record/TemplatePicker.tsx"

const DISCARD = "Discard unsaved changes?"

/** `?prefill=` as an object of field values; anything else is no prefill — a malformed one never breaks the
 *  create page, and an unknown field is the engine's to refuse on save. */
function parsePrefill(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function RecordPage({
  collection,
  id,
  viewId,
  after,
}: {
  collection: string
  id: string | null
  viewId?: string
  /** Drawn under the record's body — what only some records have (a module's New collection…, a view's module). */
  after?: ReactNode
}) {
  const { schema, navigate, editable, version, route } = useApp()
  const base = useRouteBase()
  const host = useSignal(hostInfo)
  const views = useSignal(uiViews)
  useSignal(referenceTitlesChanged)
  const create = id === null
  const query = queryOf(route)
  const row = schema.collection(collection)
  const sources = row?.sources
  const all = schema.fields(collection)
  /** What a record page draws: every field but a deprecated one, and never compile's own output. */
  const fields = useMemo(
    () =>
      recordPageFields(
        collection,
        all.filter(f => !f.deprecated)
      ),
    [collection, all]
  )

  // ---- the record ---------------------------------------------------------------------------------------
  const [reloads, setReloads] = useState(0)
  const doc = useAsync<RecordDoc | null>(
    () => (id ? getRecord(collection, id) : Promise.resolve(null)),
    [collection, id, version, reloads]
  )
  const record = useMemo(() => (doc.data && id ? { ...doc.data.fields, id: doc.data.id ?? id } : null), [doc.data, id])
  const [edits, setEdits] = useState<Record<string, unknown>>(() => (create ? parsePrefill(query["prefill"]) : {}))
  const dirty = Object.keys(edits).length > 0
  const setField = (field: string, value: unknown) => setEdits(e => setEdit(e, record, field, value))
  const current = withEdits(record, edits)

  // a re-read that lands while edits are pending keeps them — and says the record moved underneath
  const [changedUnder, setChangedUnder] = useState(false)
  const lastRead = useRef<string | null>(null)
  useEffect(() => {
    const now = record ? JSON.stringify(record) : null
    if (lastRead.current !== null && now !== null && now !== lastRead.current && dirty) setChangedUnder(true)
    lastRead.current = now
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new read is news
  }, [record])
  useEffect(() => {
    if (!dirty) setChangedUnder(false)
  }, [dirty])

  // ---- mode, writability ----------------------------------------------------------------------------------
  const [editing, setEditing] = useState(false)
  const mode: "view" | "edit" = create || editing ? "edit" : "view"
  const stub = record ? stubNoteOf(record) : null
  const origin = useMemo<HeaderOrigin | null>(() => {
    if (create) return null
    const o = recordOrigin(record)
    if (!o) return null
    const entry = o.name ? sourceEntry(sources, o.name) : undefined
    return {
      ...o,
      record: entry?.record ?? null,
      ...(entry?.access ? { access: entry.access } : {}),
      ...(entry?.via ? { via: entry.via } : {}),
      ...(entry?.note ? { note: entry.note } : {}),
      ...(stub ? { stub, stubSources: sources } : {}),
    }
  }, [create, record, sources, stub])
  /** The record's root takes no write from here — the origin line says why. */
  const readOnlySource = origin?.access === "read"
  const editsFields = editsAnything(fields)
  const canEdit = editable && editsFields && !readOnlySource
  const admin = editable && isAdmin(host)

  // ---- where a new record saves -----------------------------------------------------------------------------
  const selection = selectionFromQuery(query[SOURCES_QUERY])
  const askedTarget = create && query[TARGET_QUERY] ? query[TARGET_QUERY] : null
  const askedEntry = askedTarget ? sourceEntry(sources, askedTarget) : undefined
  const target = askedEntry && isTarget(askedEntry) ? askedEntry.name : null
  const savesTo = (() => {
    if (!create) return null
    const root = saveRootFor(sources, target)
    if (!root || (!hasForeignSource(sources) && !selection.length && !askedTarget)) return null
    const dropped =
      askedTarget && !target
        ? {
            name: askedTarget,
            reason: askedEntry ? notTargetReason(askedEntry) : `${askedTarget} is not a source of this list`,
          }
        : null
    return { root: root.name, access: root.access, via: root.via, excluded: excludedBy(selection, root.name), dropped }
  })()

  // ---- the title and the display line: references read as their targets' titles -----------------------------
  const isReference = (field: string) => isReferenceField(all, field)
  const templates = [row?.record_title ?? "", row?.record.subtitle ?? ""]
  const refs = templates
    .flatMap(templateFields)
    .filter(isReference)
    .flatMap(f => {
      const v = current[f]
      return (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string" && x !== "")
    })
  const refsKey = refs.join("\n")
  useEffect(() => {
    if (refs.length) askTitles(refs, schema, version)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the references themselves
  }, [refsKey, schema, version])
  const resolve = (ref: string) => knownTitle(ref) ?? undefined
  const title = create
    ? `New ${row?.record_type ?? "record"}`
    : recordLabel(row, current, id ?? "", { resolve, isReference })
  const subtitle =
    !create && row?.record.subtitle
      ? (tryRenderDisplay(row.record.subtitle, current, { resolve, isReference }) ?? "").replace(/\s+/g, " ").trim()
      : ""

  // ---- the layout ----------------------------------------------------------------------------------------------
  const view = viewId ? (views ?? []).find(v => v.id === viewId) : undefined
  const display = recordDisplayOf(view, row?.record)
  const layoutId = useMemo(
    () =>
      recordRendererId(
        display.layout,
        mode,
        (lid, m) => (m === "view" ? viewRegistry : editRegistry).get(lid)?.scope === "record"
      ),
    [display.layout, mode]
  )
  const Layout = (mode === "view" ? viewRegistry : editRegistry).get(layoutId)!.component

  // ---- writes ---------------------------------------------------------------------------------------------------
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [commitSample, setCommitSample] = useState(0)
  /** Set just before the page moves itself (after a save, a delete, a rename) — the leave guard lets it pass. */
  const leaving = useRef(false)
  const go = (to: string) => {
    leaving.current = true
    navigate(to)
  }

  const save = async () => {
    if (busy || (!create && !dirty)) return
    setBusy(true)
    setError(null)
    try {
      if (create) {
        const body = Object.fromEntries(Object.entries(edits).filter(([, v]) => v !== null && v !== ""))
        const made = await createRecord(collection, body, target ?? undefined)
        // the list it came from widens its Sources selection to show it (`lib/created-visibility.ts`)
        const root = saveRootFor(sources, target)?.name
        if (root && made.id) noteCreated({ collection, id: made.id, source: root })
        go(recordRoute(collection, made.id, base))
        return
      }
      const out = await updateRecord(collection, id!, edits)
      setCommitSample(n => n + 1)
      // an id template the edit changed moves the record
      if (out?.id && out.id !== id) {
        go(recordRoute(collection, out.id, base))
        return
      }
      setEdits({})
      setEditing(false)
      setReloads(n => n + 1)
    } catch (err) {
      // a refusal keeps the edits and the edit mode, and says the engine's own sentence
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => {
    if (create) {
      navigate(listRoute(collection, base)) // the leave guard asks when there is something to lose
      return
    }
    if (dirty && !confirm(DISCARD)) return
    setEdits({})
    setError(null)
    setEditing(false)
  }

  // Mod-S saves while editing; the browser's "save page" never opens over a record
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    if (mode !== "edit") return
    const onKey = (e: KeyboardEvent) => {
      if (!isSaveShortcut(e)) return
      e.preventDefault()
      void saveRef.current()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [mode])

  // leaving with unsaved edits asks first
  useEffect(() => {
    if (!dirty) return
    const off = setLeaveGuard(() => leaving.current || confirm(DISCARD))
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener("beforeunload", onUnload)
    return () => {
      off()
      window.removeEventListener("beforeunload", onUnload)
    }
  }, [dirty])

  // ---- delete and rename ------------------------------------------------------------------------------------------
  const menu = usePopover()
  const [dialog, setDialog] = useState<null | "delete" | "rename">(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [referenced, setReferenced] = useState(false)
  const [newId, setNewId] = useState("")
  const openDialog = (which: "delete" | "rename") => {
    menu.setOpen(false)
    setDialogError(null)
    setReferenced(false)
    setNewId(id ?? "")
    setDialog(which)
  }
  const remove = async (force: boolean) => {
    if (!id) return
    setBusy(true)
    setDialogError(null)
    try {
      await removeRecord(collection, id, force)
      go(listRoute(collection, base))
    } catch (err) {
      setReferenced(!force && isReferencedRefusal(err))
      setDialogError(message(err))
    } finally {
      setBusy(false)
    }
  }
  const rename = async () => {
    if (!id || renameProblem(id, newId)) return
    setBusy(true)
    setDialogError(null)
    try {
      await renameRecord(collection, id, newId.trim())
      go(recordRoute(collection, newId.trim(), base))
    } catch (err) {
      setDialogError(message(err))
    } finally {
      setBusy(false)
    }
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------
  if (id && doc.error) return <Problem collection={collection} text={doc.error} />
  // the previous record stays in hand while the next one loads: draw neither until it arrives
  if (id && doc.data?.id !== id) return <section className="ui2-page ui2-subtle">Loading…</section>

  const duplicates = duplicatesOf(record)
  const actions =
    mode === "view" ? (
      <>
        <CommitButton sample={commitSample} onCommitted={() => setReloads(n => n + 1)} />
        {!readOnlySource && editable && (
          <div className="ui2-popover-anchor" ref={menu.anchor}>
            <button
              type="button"
              className={`ui2-button is-icon${menu.open ? " is-active" : ""}`}
              title="More actions"
              aria-haspopup="menu"
              aria-expanded={menu.open}
              onClick={() => menu.setOpen(!menu.open)}
            >
              <Icon name="ellipsis" />
            </button>
            {menu.open && (
              <div className="ui2-menu" role="menu">
                {admin && (
                  <button type="button" className="ui2-menu-item" role="menuitem" onClick={() => openDialog("rename")}>
                    <Icon name="symbol-key" /> Rename…
                  </button>
                )}
                <button
                  type="button"
                  className="ui2-menu-item is-danger"
                  role="menuitem"
                  onClick={() => openDialog("delete")}
                >
                  <Icon name="trash" /> Delete…
                </button>
              </div>
            )}
          </div>
        )}
        {canEdit && (
          <button type="button" className="ui2-button is-primary" title="Edit" onClick={() => setEditing(true)}>
            <Icon name="edit" /> Edit
          </button>
        )}
      </>
    ) : (
      <>
        <button type="button" className="ui2-button" title="Cancel" onClick={cancel} disabled={busy}>
          <Icon name="close" /> Cancel
        </button>
        <button
          type="button"
          className="ui2-button is-primary"
          title={create ? "Create" : "Save (⌘S / Ctrl-S)"}
          disabled={busy || (!create && !dirty)}
          onClick={() => void save()}
        >
          <Icon name="check" /> {create ? "Create" : "Save"}
        </button>
      </>
    )

  const layoutProps: RecordLayoutProps = {
    collection,
    fields,
    record,
    edits,
    setField,
    readonly: mode === "view",
    create,
    mode,
    options: display.options ?? {},
  }

  const facts = recordFacts(all)
  const tabs =
    id && record
      ? [
          {
            id: "commands",
            title: "Commands",
            icon: "terminal",
            body: <RecordCommands collection={collection} ids={[id]} />,
          },
          {
            id: "info",
            title: "Info",
            icon: "info",
            body: (
              <RecordInfo
                collection={collection}
                id={id}
                record={record}
                facts={facts}
                sources={sources}
                path={doc.data?.path}
              />
            ),
          },
          {
            id: "revisions",
            title: "Revisions",
            icon: "history",
            body: <RecordHistory collection={collection} id={id} onReverted={() => setReloads(n => n + 1)} />,
          },
        ]
      : []

  return (
    <section className="ui2-record-page" data-mode={mode} data-layout={layoutId}>
      <RecordHeader
        icon={row?.nav.icon}
        title={title}
        crumbs={pathCrumbs(collection, id, base)}
        commit={create ? null : commitInfo(record)}
        origin={origin}
        badge={
          duplicates && (
            <span
              className="ui2-dup-badge"
              data-duplicates={duplicates.join(",")}
              title={`Held by both ${duplicates.join(" and ")} — ${duplicates[0]}'s copy is the one read`}
            >
              <Icon name="warning" /> duplicate id
            </span>
          )
        }
        actions={actions}
        onRefresh={id ? () => setReloads(n => n + 1) : undefined}
      />
      {!create && <RecordDisplayLine row={row} fields={all} record={current} subtitle={subtitle} />}
      {!create && id && <NextNotes collection={collection} id={id} />}

      <div className="ui2-record-body">
        <div className="ui2-record-main">
          {!create && fields.length > 0 && !editsFields && (
            <p className="ui2-note">
              <Icon name="info" /> Nothing here is edited by hand — every field is read from the record&rsquo;s file or
              computed.
            </p>
          )}
          {changedUnder && (
            <p className="ui2-note" data-changed-under>
              <Icon name="warning" /> This record changed on disk while you were editing — Save writes your edits over
              it; Cancel takes the new version.
            </p>
          )}
          {error && (
            <p className="ui2-error" role="alert">
              {error}
            </p>
          )}
          {savesTo && <SaveTarget {...savesTo} />}
          {create && fields.length > 0 && (
            <TemplatePicker
              collection={collection}
              fields={fields}
              onPick={values => {
                for (const [k, v] of Object.entries(values)) setField(k, v)
              }}
            />
          )}
          {/* Enter in a field does not save (as in ui) — Save and Mod-S do */}
          <form className="ui2-record-form" onSubmit={e => e.preventDefault()}>
            <ErrorBoundary
              key={layoutId}
              name={`record:${layoutId}`}
              fallback={err => (
                <p className="ui2-error">
                  The {layoutId} layout failed: {err.message}
                </p>
              )}
            >
              <Layout {...layoutProps} />
            </ErrorBoundary>
          </form>
          {!create && after}
        </div>
        {tabs.length > 0 && <RecordSidebar tabs={tabs} />}
      </div>

      {dialog === "delete" && (
        <Dialog title="Delete this record?" onClose={() => setDialog(null)}>
          <p className="ui2-subtle">
            {referenced
              ? "Other records point at this one. Deleting it anyway leaves their references naming a record that is gone."
              : "This removes its file. It is recoverable from git history, not from here."}
          </p>
          {dialogError && <p className="ui2-error">{dialogError}</p>}
          <div className="ui2-dialog-actions">
            <button type="button" className="ui2-button" onClick={() => setDialog(null)}>
              Cancel
            </button>
            {referenced ? (
              <button
                type="button"
                className="ui2-button is-danger"
                disabled={busy}
                data-force
                onClick={() => void remove(true)}
              >
                {busy ? "Deleting…" : "Delete anyway"}
              </button>
            ) : (
              <button type="button" className="ui2-button is-danger" disabled={busy} onClick={() => void remove(false)}>
                {busy ? "Deleting…" : "Delete"}
              </button>
            )}
          </div>
        </Dialog>
      )}
      {dialog === "rename" && id && (
        <Dialog title="Rename this record" onClose={() => setDialog(null)}>
          <form
            className="ui2-stack"
            onSubmit={e => {
              e.preventDefault()
              void rename()
            }}
          >
            <label className="ui2-subtle" htmlFor="ui2-rename-id">
              New id — every reference to <code>{id}</code> is rewritten.
            </label>
            <input
              id="ui2-rename-id"
              className="ui2-input ui2-mono"
              value={newId}
              onChange={e => setNewId(e.target.value)}
              spellCheck={false}
            />
            {newId !== id && renameProblem(id, newId) && (
              <p className="ui2-hint is-error">{renameProblem(id, newId)}</p>
            )}
            {dialogError && <p className="ui2-error">{dialogError}</p>}
            <div className="ui2-dialog-actions">
              <button type="button" className="ui2-button" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button type="submit" className="ui2-button is-primary" disabled={busy || !!renameProblem(id, newId)}>
                {busy ? "Renaming…" : "Rename"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  )
}

function Problem({ collection, text }: { collection: string; text: string }) {
  const { schema } = useApp()
  const base = useRouteBase()
  return (
    <section className="ui2-page">
      <p className="ui2-crumbs">
        <Link to={listRoute(collection, base)}>{schema.collection(collection)?.title ?? collection}</Link>
      </p>
      <p className="ui2-error">{text}</p>
    </section>
  )
}
