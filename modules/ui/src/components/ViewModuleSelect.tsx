/**
 * WHERE A VIEW OR A COLLECTION GOES — the module choice as ONE dropdown (ported from the Vue ui's
 * ViewModuleSelect.vue, cr-vscode-010): Save as…, New collection and a ui-view's record page draw it. The label,
 * the app's dropdown, the SELECTED module's path on one line under it (each option carries its own as a hover),
 * and — only when some module is installed by npm — one sentence saying those are not offered, their names on
 * hover. A list of every module with a path under each ran a popover past the window. Presentational.
 */
import { lockedNote, moduleChoices, whereOf, type ViewModuleTarget } from "../lib/view-module-targets.ts"
import { Select } from "./Select.tsx"
import { hint } from "../styles/classes.ts"

export function ViewModuleSelect({
  value,
  targets,
  onChange,
  disabled,
}: {
  value: string | null
  targets: ViewModuleTarget[]
  onChange(value: string | null): void
  disabled?: boolean
}) {
  const split = moduleChoices(targets)
  const selected = targets.find(t => !t.locked && t.id === value) ?? null
  return (
    <div className="grid gap-1 [&_p]:m-0" data-view-module-select>
      <p className="font-semibold">Module</p>
      <Select
        value={value}
        choices={split.choices}
        disabled={disabled}
        ariaLabel="Module"
        onChange={v => onChange(typeof v === "string" ? v : null)}
      />
      {selected && (
        <p className={hint} data-module-where>
          {whereOf(selected)}
        </p>
      )}
      {split.locked.length > 0 && (
        <p className={hint} title={split.locked.map(t => t.label).join(", ")}>
          {lockedNote(split.locked.length)}
        </p>
      )}
    </div>
  )
}
