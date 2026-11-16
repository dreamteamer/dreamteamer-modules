/**
 * What only a MODULE has, under its record page in the Schema tab (ported from the Vue ui's
 * ModuleCollections.vue): New collection… TARGETED AT IT — the dialog posts `?module=<id>`. A `node_modules` module
 * takes no new collection (the next `npm install` would erase it), so the action is disabled and says why.
 */
import { useState } from "react"
import { Icon } from "../components/Icon.tsx"
import { isUnwritableModule } from "../lib/module-writable.ts"
import { CreateCollectionDialog } from "./CreateCollectionDialog.tsx"
import { useModules } from "./use-modules.ts"

export function ModuleCollections({ moduleId }: { moduleId: string }) {
  const { modules } = useModules()
  const [open, setOpen] = useState(false)
  const entry = modules.find(m => m.id === moduleId)
  if (!entry) return null
  const readOnly = isUnwritableModule(entry)
  return (
    <section className="dt-module-collections">
      <button
        type="button"
        className="dt-button"
        data-action="new-collection-in-module"
        disabled={readOnly}
        title={
          readOnly
            ? "This module lives under node_modules — a new collection would be erased by the next npm install"
            : `New collection in ${moduleId}`
        }
        onClick={() => setOpen(true)}
      >
        <Icon name="add" /> New collection in this module…
      </button>
      {open && <CreateCollectionDialog module={moduleId} onClose={() => setOpen(false)} />}
    </section>
  )
}
