/**
 * A ui-view's MODULE, on its record page in the Schema tab (ported from the Vue ui's ViewModulePanel.vue +
 * ViewModuleField.vue): the module the view is compiled from (`$module`), and the dropdown that MOVES its source to
 * another (`PATCH /collections/ui-views/records/<id> {module}` — compile-gated, committed in the repo that holds the
 * destination). A view an installed package ships does not move from here; the panel says why instead of offering a
 * choice the engine would refuse. After a move the record and the view table are re-read.
 */
import { useMemo, useState } from "react"
import { getRecord, moveUiView } from "../api/client.ts"
import { useApp, useAsync } from "../app-context.tsx"
import { ViewModuleSelect } from "../components/ViewModuleSelect.tsx"
import { isUnwritableModule } from "../lib/module-writable.ts"
import { refusalAnswer, type SaveAnswer } from "../lib/save-answer.ts"
import { loadUiViews } from "../lib/ui-views.ts"
import { recordPageTargets, viewModuleTargets } from "../lib/view-module-targets.ts"
import { cx, subtle } from "../styles/classes.ts"
import { useModules } from "./use-modules.ts"

export function ViewModulePanel({ viewId }: { viewId: string }) {
  const { version, refresh } = useApp()
  const { modules, workspaceModule } = useModules()
  const [moved, setMoved] = useState(0)
  const record = useAsync(() => getRecord("ui-views", viewId), [viewId, version, moved])
  const current =
    typeof record.data?.fields["$module"] === "string" ? (record.data.fields["$module"] as string) : undefined
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<SaveAnswer | null>(null)
  const targets = useMemo(
    () => recordPageTargets(viewModuleTargets(modules, workspaceModule), workspaceModule),
    [modules, workspaceModule]
  )
  const owner = modules.find(m => m.id === current)
  const readOnly = owner && isUnwritableModule(owner)

  const move = async (to: string | null) => {
    if (!to || to === current || busy) return
    setBusy(true)
    setAnswer(null)
    try {
      const out = await moveUiView(viewId, to)
      await loadUiViews()
      setMoved(n => n + 1)
      refresh()
      setAnswer({ tone: "ok", sentence: `Moved to ${to}${out?.["file"] ? ` — ${String(out["file"])}` : ""}.` })
    } catch (err) {
      setAnswer(refusalAnswer(err, { saveAs: true }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="grid gap-1 max-w-[420px] mt-5 [&_p]:m-0" data-view-module>
      {readOnly ? (
        <>
          <p className="font-semibold">Module</p>
          <p className={subtle} data-readonly>
            <strong>{current}</strong> — shipped by an installed package, so it moves with the package. Save it from its
            list to change it here (an overlay in the workspace module), or Save as… a new name and move that.
          </p>
        </>
      ) : (
        <ViewModuleSelect value={current ?? null} targets={targets} disabled={busy} onChange={v => void move(v)} />
      )}
      {busy && <p className={subtle}>Moving…</p>}
      {answer && (
        <div
          className={cx(
            "pl-2 border-l-[3px] border-solid [&_pre]:mt-0 [&_pre]:mx-0 [&_pre]:mb-1 [&_pre]:whitespace-pre-wrap [&_pre]:text-small [&_pre]:text-fg-subtle",
            answer.tone === "error" ? "border-l-danger [&_p]:text-danger" : "border-l-chart-green"
          )}
          role={answer.tone === "error" ? "alert" : "status"}
        >
          <p>{answer.sentence}</p>
          {answer.detail && <pre>{answer.detail}</pre>}
        </div>
      )}
    </section>
  )
}
