/**
 * NEW COLLECTION (ported from the Vue ui's CreateCollectionDialog.vue): a parent namespace (suggested from the
 * namespaces that exist) and a name, previewed as the collection path; the MIXINS it starts from — the compiled
 * `mixins` records, applied in the order they are ticked; an optional id template (`ids.from`); and, beyond ui, its
 * nav ICON and the MODULE it is written into.
 *
 * Posts `{ name, mixins?, idFrom? }` to `POST /collections/collections/records[?module=<id>]` — a compile-gated source
 * write. ⚠ The module is a SELECTOR, so it rides in the query, never in the body (a body `module` is a move). The
 * icon is no key of the create call: it is set right after, as `display.nav.icon` by the collection keys write —
 * two commits, and a refusal of the second leaves a collection without an icon, which the dialog says.
 */
import { useMemo, useState, type FormEvent } from "react"
import { createCollection, listRecords, setCollectionKeys } from "../api/client.ts"
import { useApp, useAsync } from "../AppContext.tsx"
import { Dialog } from "../components/Dialog.tsx"
import { IconPicker } from "../components/IconPicker.tsx"
import { ViewModuleSelect } from "../components/ViewModuleSelect.tsx"
import { createCollectionBody, mixinChoices, toggleMixin } from "../lib/createCollection.ts"
import { isOkfRow } from "../lib/okf.ts"
import { SCHEMA_BASE } from "../lib/createRoute.ts"
import { joinCollectionPath, slugify } from "../lib/slugify.ts"
import { viewModuleTargets } from "../lib/viewModuleTargets.ts"
import {
  button,
  buttonSize,
  buttonTone,
  check,
  cx,
  dialogActions,
  error as errorBox,
  formRow,
  hint,
  input,
  mono,
  subtle,
} from "../styles/classes.ts"
import { dialogForm } from "./looks.ts"
import { useModules } from "./useModules.ts"

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function CreateCollectionDialog({ module, onClose }: { module?: string; onClose(): void }) {
  const { schema, navigate, refresh } = useApp()
  const { modules, workspaceModule } = useModules()
  const [parent, setParent] = useState("")
  const [name, setName] = useState("")
  const [mixins, setMixins] = useState<string[]>([])
  const [idFrom, setIdFrom] = useState("")
  const [icon, setIcon] = useState("")
  const [target, setTarget] = useState<string | null>(module ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const slug = slugify(name)
  const path = joinCollectionPath(parent, slug)

  const choices = useAsync(
    () =>
      listRecords("mixins", { limit: 100 }).then(
        p => mixinChoices(p.records),
        () => []
      ),
    []
  )
  const namespaces = useMemo(() => {
    const set = new Set<string>()
    for (const row of schema.collections.filter(isOkfRow)) {
      const segments = row.collection.split("/")
      for (let i = 1; i < segments.length; i++) set.add(segments.slice(0, i).join("/"))
    }
    return [...set].sort()
  }, [schema.collections])
  const targets = useMemo(() => viewModuleTargets(modules, workspaceModule), [modules, workspaceModule])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!slug || busy) return
    setBusy(true)
    setError(null)
    try {
      await createCollection(createCollectionBody(path, mixins, idFrom), target)
      if (icon) {
        try {
          await setCollectionKeys(path, { "display.nav.icon": icon })
        } catch (err) {
          setError(`${path} was created, but its icon was refused: ${message(err)}`)
          refresh()
          return
        }
      }
      refresh()
      onClose()
      navigate(`${SCHEMA_BASE}/collections/${path}`)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="New collection" onClose={onClose}>
      <form className={dialogForm} data-create-collection onSubmit={e => void submit(e)}>
        <label className={formRow}>
          <span>Parent namespace</span>
          <input
            className={input}
            list="dt-namespaces"
            value={parent}
            placeholder="(root)"
            onChange={e => setParent(e.target.value)}
          />
          <datalist id="dt-namespaces">
            {namespaces.map(ns => (
              <option key={ns} value={ns} />
            ))}
          </datalist>
        </label>
        <label className={formRow}>
          <span>Name</span>
          <input
            className={input}
            value={name}
            placeholder="Contacts"
            aria-label="Collection name"
            onChange={e => setName(e.target.value)}
          />
        </label>
        <p className={hint}>
          Collection path: <code>{path || "—"}</code>
        </p>
        <fieldset className={formRow}>
          <legend>Mixins</legend>
          {!choices.data?.length && (
            <p className={hint}>None — the collection starts with a name field; grow it in the designer.</p>
          )}
          {choices.data?.map(m => (
            <label key={m.id} className={check} title={m.description}>
              <input
                type="checkbox"
                data-mixin={m.id}
                checked={mixins.includes(m.id)}
                onChange={() => setMixins(v => toggleMixin(v, m.id))}
              />
              <span>{m.label}</span>
              {mixins.includes(m.id) && <span className={subtle}>{mixins.indexOf(m.id) + 1}</span>}
            </label>
          ))}
        </fieldset>
        <label className={formRow}>
          <span>Id template</span>
          <input
            className={cx(input, mono)}
            value={idFrom}
            placeholder="the engine's default — e.g. {{ name | slug }}"
            onChange={e => setIdFrom(e.target.value)}
          />
        </label>
        <div className={formRow}>
          <span>Icon</span>
          <IconPicker value={icon} onChange={setIcon} placeholder="Icon (optional)" />
        </div>
        {!module && <ViewModuleSelect value={target} targets={targets} onChange={setTarget} />}
        {module && <p className={hint}>Written into the module {module}.</p>}
        {error && <p className={errorBox}>{error}</p>}
        <div className={dialogActions}>
          <button type="button" className={cx(button, buttonTone.default, buttonSize.default)} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={cx(button, buttonTone.primary, buttonSize.default)} disabled={busy || !slug}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
