/**
 * WHERE A NEW RECORD SAVES — said on the create form before the save (ported from the Vue ui's
 * SaveTarget.vue): `Saves to ● lab`. Drawn only when the question has more than one plausible answer — the
 * collection reads a root besides the workspace's own, the list it came from was narrowed by the Sources picker,
 * or the target choice named a root (`?target=`). A `?target=` the form cannot use is said beside the line, and
 * the save goes to the write root, so the line and the POST never disagree; a narrowed list that will not show
 * the new record says it will be widened to.
 */
import type { SourceAccess, SourceVia } from "../api/types.ts"
import { SourceMark } from "../components/SourceMark.tsx"

export function SaveTarget({
  root,
  excluded,
  access,
  via,
  dropped,
}: {
  root: string
  excluded: string[]
  access?: SourceAccess
  via?: SourceVia
  dropped?: { name: string; reason: string } | null
}) {
  return (
    <p
      className={`dt-save-target${excluded.length || dropped ? " is-warning" : ""}`}
      data-save-target
      data-save-root={root}
    >
      <span className="dt-subtle">Saves to</span>
      <SourceMark name={root} access={access} via={via} />
      {dropped && (
        <span data-save-target-dropped>
          — not {dropped.name}: {dropped.reason}.
        </span>
      )}
      {excluded.length > 0 && (
        <span>
          — not to {excluded.join(", ")}, which take{excluded.length === 1 ? "s" : ""} no new record from here. The list
          will show {root} too, so this record stays in view.
        </span>
      )}
    </p>
  )
}
