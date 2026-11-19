/**
 * THE LAYOUT OPTIONS PANEL — beside the list: the layout, the sort, the active List's own options, the columns in
 * their real order (reorder by drag or by the arrows, hide, add one back), and the saved-view actions in its title
 * bar (ported from the Vue ui's browse/LayoutOptionsSection.vue and ViewSaveActions.vue; ui draws it in the
 * right rail, which ui does not have yet).
 *
 * SAVE writes what the screen shows to whichever governs the page (descriptor v2 §3.5, `lib/viewWrite.ts`):
 *  - a NAMED ui-view → the view record, rewritten whole: its route, scope, collection, every display block it
 *    carried, `display.list` from the screen, and the builder's filter — except an opaque stored filter, which
 *    is kept as stored rather than flattened;
 *  - the bare collection → its own `display.list` (`dt set collections/<c>`): columns, sort, the layout and each
 *    option where they differ. A collection's display holds no filter, so one on screen is named as unsaved and
 *    the page stays dirty, rather than reading as saved and reverting on the next compile.
 * SAVE AS… writes a NEW ui-view at `/views/<collection>/<slug>`, titled in the nav. The answer — the engine's
 * sentence verbatim and the one next action it implies (`lib/saveAnswer.ts`) — drops down under the buttons, in
 * view by construction. The form picks the view's icon (components/IconPicker.tsx) and the module it is written into
 * (components/ViewModuleSelect.tsx — `?module=`, the workspace module by default).
 */
import { useMemo, useState, type DragEvent, type FormEvent } from "react"
import { saveUiView, setCollectionKeys } from "../api/client.ts"
import { useSignal } from "../AppContext.tsx"
import { Icon } from "../components/Icon.tsx"
import { IconPicker } from "../components/IconPicker.tsx"
import { Link } from "../components/Link.tsx"
import { Select } from "../components/Select.tsx"
import { ViewModuleSelect } from "../components/ViewModuleSelect.tsx"
import { computedReason } from "../lib/fieldRow.ts"
import { compileFilter } from "../lib/filterQuery.ts"
import { labelOf } from "../lib/formatTitle.ts"
import { refusalAnswer, savedAnswer, type SaveAnswer } from "../lib/saveAnswer.ts"
import { signal } from "../lib/signal.ts"
import { slugify } from "../lib/slugify.ts"
import { SOURCE_FIELD } from "../lib/sources.ts"
import { loadUiViews, uiViews } from "../lib/uiViews.ts"
import { filterToWrite } from "../lib/viewFilter.ts"
import { collectionListWrite, namedViewWrite, newViewWrite, type ListPresentation } from "../lib/viewWrite.ts"
import { viewModuleTargets } from "../lib/viewModuleTargets.ts"
import { lists } from "../registry/index.ts"
import { FieldContext } from "../render/FieldContext.tsx"
import { OptionsForm } from "../render/OptionsForm.tsx"
import { useModules } from "../settings/useModules.ts"
import type { BrowseState } from "./useBrowseState.ts"
import { button, buttonSize, buttonTone, cx, hint, iconButton, subtle } from "../styles/classes.ts"
import { floatingPanel, panelHead, panelLabel, panelTitle, sidePanel } from "./looks.ts"

// ---- the looks (was dt-lo-*) -----------------------------------------------------------------------------------
/** A quiet text button in the title bar; `strong` while there is something to save. */
const barButton = (strong?: boolean) =>
  cx(
    "inline-flex items-center gap-1 h-6 px-1.5 py-0 border-0 rounded bg-transparent text-small cursor-pointer whitespace-nowrap enabled:hover:bg-bg-hover enabled:hover:text-fg disabled:opacity-40 disabled:cursor-default",
    strong ? "text-fg" : "text-fg-subtle"
  )
/** The Save as… form and the save's answer drop under the buttons. */
const popCls = cx(floatingPanel, "absolute top-[calc(100%+6px)] right-0 z-10 w-[280px] flex flex-col gap-2 p-2.5")
const rowCls = "flex items-center gap-2"
/** One block of the panel: a label, its control. */
const sectionCls = "flex flex-col gap-1"
/** The small icon buttons of the sort direction and of a column row. */
const tinyButton = (on = false) =>
  cx(
    "border-0 cursor-pointer px-1.5 py-0 disabled:opacity-35 disabled:cursor-default",
    on ? "bg-bg-active text-fg" : "bg-transparent text-fg-subtle"
  )

const lastAnswer = signal<{ key: string; a: SaveAnswer; route?: string } | null>(null)

export function LayoutOptions({ state, onClose }: { state: BrowseState; onClose(): void }) {
  const views = useSignal(uiViews) ?? []
  const collection = state.collection
  const entry = lists.get(state.layout)
  const options = entry?.options ?? []
  const selfHeaded = options.length > 0 && options.every(o => !!o.group || o.field === "page_size")
  const drawsTable = !entry || state.layout === "table"

  const layoutChoices = lists.all().map(e => ({ text: e.name, value: e.id }))
  if (!entry) layoutChoices.push({ text: `${state.layout} (not in ui yet)`, value: state.layout })

  // ---- saving ----------------------------------------------------------------------------------------------
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  // kept outside the component: a Save rewrites the record, which remounts the browse (and this panel) on it
  const answerKey = `${collection}::${state.viewId ?? ""}`
  const kept = useSignal(lastAnswer)
  const answer = kept?.key === answerKey ? kept : null
  const setAnswer = (a: { a: SaveAnswer; route?: string } | null) => lastAnswer.set(a ? { ...a, key: answerKey } : null)
  const [name, setName] = useState("")
  const [icon, setIcon] = useState("")
  /** Save as…'s module: `null` is the workspace module, the engine's default (no `?module=`). */
  const [module, setModule] = useState<string | null>(null)
  const { modules, workspaceModule } = useModules()
  const targets = useMemo(() => viewModuleTargets(modules, workspaceModule), [modules, workspaceModule])
  const slug = slugify(name)

  /** What the screen contributes to a list block. `sort: ''` is written as such: explicitly unsorted.
   *  ⚠ The Source column is left out: compile refuses `$source` in `display.list.columns` ("not a field of
   *  collections/<c>"), and it joins the default columns of a mixed-source list on its own — written, it made
   *  every Save on such a list fail (ui writes it, and fails the same way). */
  const presentation = (): ListPresentation => {
    const snap = state.snapshot()
    return {
      layout: snap.layout,
      columns: snap.columns.filter(c => c !== SOURCE_FIELD),
      sort: snap.sort,
      options: { ...(snap.listOptions[snap.layout] ?? {}) },
    }
  }

  async function save(): Promise<void> {
    if (saving) return
    setSaving(true)
    setAnswer(null)
    try {
      const existing = views.find(v => v.id === state.viewId)
      const p = presentation()
      const filter = filterToWrite(state.filterGroup, { opaque: state.filterOpaque, stored: existing?.filter })
      if (existing) {
        const out = await saveUiView(existing.id, namedViewWrite(existing, collection, p, filter))
        state.markSaved()
        setAnswer({ a: savedAnswer("view", out ?? undefined) })
        await loadUiViews()
        return
      }
      const { changes, unsaved } = collectionListWrite(state.row?.list, p, filter)
      const out = await setCollectionKeys(collection, changes)
      if (!unsaved.length) state.markSaved()
      setAnswer({ a: savedAnswer("collection", out ?? undefined, { unsaved }) })
    } catch (err) {
      setAnswer({ a: refusalAnswer(err, { saveAs: false }) })
    } finally {
      setSaving(false)
    }
  }

  async function saveAs(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!slug || saving) return
    setSaving(true)
    setAnswer(null)
    try {
      const view = newViewWrite(
        `/views/${collection.replace(/\//g, "-")}/${slug}`,
        collection,
        { title: name.trim(), icon: icon.trim() || undefined },
        presentation(),
        compileFilter(state.filterGroup) ?? undefined
      )
      await saveUiView(undefined, view, module ?? undefined)
      await loadUiViews()
      setFormOpen(false)
      setAnswer({ a: savedAnswer("new-view", undefined, { route: view.route }), route: view.route })
    } catch (err) {
      // the form stays open: every next step a refusal names (another name) is in it
      setAnswer({ a: refusalAnswer(err, { saveAs: true }) })
    } finally {
      setSaving(false)
    }
  }

  const openForm = () => {
    setAnswer(null)
    setName("")
    setIcon("")
    setModule(null)
    setFormOpen(true)
  }

  // ---- columns ----------------------------------------------------------------------------------------------
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const onDragStart = (i: number, e: DragEvent) => {
    setDragFrom(i)
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", String(i))
  }
  const onDrop = (i: number) => {
    if (dragFrom !== null) state.moveColumn(dragFrom, i)
    setDragFrom(null)
    setDragOver(null)
  }

  return (
    <aside className={sidePanel} aria-label="Layout options">
      <header className={panelHead}>
        <span className={panelTitle}>Layout options</span>
        <div className="relative flex items-center gap-0.5" data-view-save-actions>
          {state.dirty && (
            <span className="text-chart-orange text-3xs" title="Unsaved changes to this view">
              ●
            </span>
          )}
          <button
            type="button"
            className={barButton(state.dirty)}
            data-action="save"
            disabled={!state.dirty || saving}
            title={
              state.viewId
                ? "Save this presentation to the current view record"
                : "Save the layout, its options, the columns and the sort to the collection's own display"
            }
            onClick={() => void save()}
          >
            <Icon name="save" /> {saving && !formOpen ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className={barButton()}
            data-action="save-as"
            title="Save as a new named view"
            onClick={openForm}
          >
            <Icon name="bookmark" /> Save as…
          </button>
          <button
            type="button"
            className={barButton()}
            data-action="reset"
            disabled={!state.dirty}
            title="Discard unsaved changes"
            onClick={() => {
              state.resetToView()
              setAnswer(null)
            }}
          >
            <Icon name="discard" />
          </button>
          <button
            type="button"
            className={barButton()}
            title="Close"
            aria-label="Close layout options"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>

          {(formOpen || answer) && (
            <div className={popCls}>
              {formOpen && (
                <form className="flex flex-col gap-1.5" data-save-as-form onSubmit={e => void saveAs(e)}>
                  <p className={panelLabel}>Save as a new view</p>
                  <input
                    autoFocus
                    value={name}
                    placeholder="View name…"
                    aria-label="View name"
                    onChange={e => setName(e.target.value)}
                  />
                  <IconPicker value={icon} onChange={setIcon} placeholder="Icon (optional)" />
                  <ViewModuleSelect value={module} targets={targets} onChange={setModule} />
                  <p className={cx(hint, "m-0")}>
                    Appears in the nav
                    {slug && (
                      <>
                        {" "}
                        at{" "}
                        <code>
                          /views/{collection.replace(/\//g, "-")}/{slug}
                        </code>
                      </>
                    )}
                  </p>
                  <div className={rowCls}>
                    <button
                      type="submit"
                      className={cx(button, buttonTone.primary, buttonSize.small)}
                      disabled={!slug || saving}
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      className={cx(button, buttonTone.default, buttonSize.small)}
                      onClick={() => setFormOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              {answer && (
                <div
                  className={cx(
                    "pl-2 border-l-[3px] [&_p]:mt-0 [&_p]:mx-0 [&_p]:mb-1 [&_pre]:mt-0 [&_pre]:mx-0 [&_pre]:mb-1 [&_pre]:whitespace-pre-wrap [&_pre]:text-small [&_pre]:text-fg-subtle",
                    answer.a.tone === "error" ? "border-l-danger [&_p]:text-danger" : "border-l-chart-green"
                  )}
                  role={answer.a.tone === "error" ? "alert" : "status"}
                  data-save-answer
                >
                  <p>{answer.a.sentence}</p>
                  {answer.a.detail && <pre>{answer.a.detail}</pre>}
                  <div className={rowCls}>
                    {answer.route && <Link to={answer.route}>Open it</Link>}
                    {answer.a.next?.action ? (
                      <button
                        type="button"
                        className={cx(button, buttonTone.default, buttonSize.small)}
                        onClick={openForm}
                      >
                        {answer.a.next.label}
                      </button>
                    ) : (
                      answer.a.next && <span>{answer.a.next.label}</span>
                    )}
                    <button
                      type="button"
                      className={cx(iconButton, "ml-auto")}
                      title="Dismiss"
                      onClick={() => setAnswer(null)}
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <section className={sectionCls}>
        <p className={panelLabel}>Layout</p>
        <Select
          value={state.layout}
          choices={layoutChoices}
          ariaLabel="Layout"
          onChange={v => state.setLayout(String(v))}
        />
      </section>

      <section className={sectionCls}>
        <p className={panelLabel}>Sort</p>
        <div className="flex gap-1.5 [&>div:first-child]:flex-1">
          <Select
            value={state.sortField}
            choices={state.fields.map(f => ({ text: labelOf(f), value: f.field }))}
            placeholder="Unsorted"
            ariaLabel="Sort"
            onChange={v => {
              const f = String(v ?? "")
              state.setSort(f ? (state.sortDesc ? `-${f}` : f) : "")
            }}
          />
          <div
            className="inline-flex border border-input-border rounded-dt overflow-hidden"
            role="group"
            aria-label="Sort direction"
          >
            {([false, true] as const).map(desc => (
              <button
                key={String(desc)}
                type="button"
                title={desc ? "Descending" : "Ascending"}
                className={tinyButton(!!state.sortField && state.sortDesc === desc)}
                disabled={!state.sortField}
                onClick={() => state.setSort(desc ? `-${state.sortField}` : state.sortField)}
              >
                <Icon name={desc ? "arrow-down" : "arrow-up"} />
              </button>
            ))}
          </div>
        </div>
      </section>

      {options.length > 0 && (
        <section className={sectionCls}>
          {!selfHeaded && <p className={panelLabel}>Options</p>}
          <FieldContext.Provider value={{ collection, fields: state.fields }}>
            <OptionsForm
              options={options}
              value={state.listOptions[state.layout] ?? {}}
              onChange={v => state.setListOptions(state.layout, v)}
            />
          </FieldContext.Provider>
        </section>
      )}

      {drawsTable && (
        <section className={sectionCls}>
          <p className={panelLabel}>Columns</p>
          <ul className="list-none m-0 p-0">
            {state.columns.map((f, i) => {
              const reason = computedReason(f, { create: false })
              return (
                <li
                  key={f.field}
                  className={cx(
                    "flex items-center gap-1 py-[3px] px-1 rounded cursor-grab hover:bg-bg-hover",
                    dragFrom === i && "opacity-40",
                    dragOver === i && dragFrom !== i && "shadow-[inset_0_2px_0_var(--dt-focus)]"
                  )}
                  draggable
                  onDragStart={e => onDragStart(i, e)}
                  onDragOver={e => {
                    e.preventDefault()
                    if (dragFrom !== null) setDragOver(i)
                  }}
                  onDrop={e => {
                    e.preventDefault()
                    onDrop(i)
                  }}
                  onDragEnd={() => {
                    setDragFrom(null)
                    setDragOver(null)
                  }}
                >
                  <Icon name="gripper" />
                  <span
                    className={cx(
                      "flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
                      reason !== null && "opacity-65 italic"
                    )}
                    title={reason ?? undefined}
                  >
                    {labelOf(f)}
                  </span>
                  <button
                    type="button"
                    className={tinyButton()}
                    title="Move up"
                    disabled={i === 0}
                    onClick={() => state.moveColumn(i, i - 1)}
                  >
                    <Icon name="chevron-up" />
                  </button>
                  <button
                    type="button"
                    className={tinyButton()}
                    title="Move down"
                    disabled={i === state.columns.length - 1}
                    onClick={() => state.moveColumn(i, i + 1)}
                  >
                    <Icon name="chevron-down" />
                  </button>
                  <button
                    type="button"
                    className={tinyButton()}
                    title="Hide column"
                    onClick={() => state.toggleColumn(f.field)}
                  >
                    <Icon name="close" />
                  </button>
                </li>
              )
            })}
          </ul>
          {!state.columns.length && <p className={subtle}>No columns shown</p>}
          {state.hiddenFields.length > 0 && (
            <Select
              value=""
              choices={state.hiddenFields.map(f => ({ text: labelOf(f), value: f.field }))}
              placeholder="+ Add column…"
              ariaLabel="Add column"
              onChange={v => v && state.toggleColumn(String(v))}
            />
          )}
        </section>
      )}
    </aside>
  )
}
