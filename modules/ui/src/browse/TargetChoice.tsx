/**
 * WHERE A NEW RECORD GOES — asked BEFORE the form, under the header's +, on a list that reads two or more roots a
 * record can be added to (ported from the Vue ui's browse/TargetChoice.vue; `lib/sources.ts#targetChoice`
 * decides when it opens and what it lists). One row per target; then each narrowed source that is not offered,
 * with its reason; then one `+N not offered` line for the rest. A pick opens the create form with `?target=`.
 *
 * Simplified from ui: the words about a root ride on the row's tooltip rather than on the Vue ui's own hover card.
 */
import { SourceMark } from "../components/SourceMark.tsx"
import {
  excludedHoverLines,
  othersHoverLines,
  targetHoverLines,
  type HoverLine,
  type TargetChoice as Choice,
} from "../lib/sources.ts"
import { cx, menu, menuItem, menuItemAbsent, subtle } from "../styles/classes.ts"
import { capsLabel } from "./looks.ts"

const words = (lines: HoverLine[]) => lines.map(l => l.text).join("\n")

export function TargetChoice({
  choice,
  onPick,
}: {
  choice: Extract<Choice, { mode: "choose" }>
  onPick(name: string): void
}) {
  return (
    <div className={menu} role="menu" aria-label="New record in…" data-target-choice>
      <p className={capsLabel}>New record in…</p>
      {choice.targets.map(t => (
        <button
          key={t.name}
          type="button"
          role="menuitem"
          className={menuItem}
          data-target={t.name}
          title={words(targetHoverLines(t))}
          onClick={() => onPick(t.name)}
        >
          <SourceMark name={t.name} access={t.access} via={t.via} note={t.note} />
        </button>
      ))}
      {!choice.targets.length && <p className={subtle}>No source of this list takes a new record from here.</p>}
      {choice.excluded.length > 0 && <p className={capsLabel}>Not offered</p>}
      {choice.excluded.map(x => (
        <p key={x.source.name} className={cx(menuItem, menuItemAbsent)} title={words(excludedHoverLines(x))}>
          <SourceMark name={x.source.name} access={x.source.access} via={x.source.via} />
          <span className={subtle}>{x.reason}</span>
        </p>
      ))}
      {choice.others.length > 0 && (
        <p className={subtle} title={words(othersHoverLines(choice.others))}>
          +{choice.others.length} not offered
        </p>
      )}
    </div>
  )
}
