/**
 * THE SOURCE PICKER — beside the filter button, on a collection that reads anything shared (a
 * module-owned list): closed it shows the selection — All sources, the one source picked, or the dots of several;
 * open it lists every source with the records each holds and whether a write lands there (ported from
 * the Vue ui's browse/SourcePicker.vue).
 *
 * It writes the ORDINARY filter — one `$source` rule (`lib/sources.ts`) — so Save, the URL and the chips all see it, and nothing narrows the rows outside the filter. Counts are the
 * host's, over the rows the other rules leave. A source not installed is listed greyed, with nothing to pick.
 */
import type { Dispatch, SetStateAction } from "react"
import type { SourceEntry } from "../api/types.ts"
import { Icon } from "../components/Icon.tsx"
import { Menu } from "../components/Menu.tsx"
import { SourceMark } from "../components/SourceMark.tsx"
import type { FilterGroup } from "../lib/filterQuery.ts"
import { selectedSources, sourceColor, toggleSource, viaWord, withSourceSelection } from "../lib/sources.ts"
import { usePopover } from "./usePopover.ts"
import {
  button,
  buttonSize,
  buttonTone,
  cx,
  menu,
  menuCheck,
  menuItem,
  menuItemTone,
  menuLabel,
  popoverAnchor,
  subtle,
} from "../styles/classes.ts"
import { sourceDot } from "./looks.ts"

/** A row's class and writability in words: `linked clone · writes`, `installed package · read-only`. */
function pickerWords(f: SourceEntry): string {
  const access =
    f.access === "write" ? "writes" : f.access === "edit" ? "edits only" : f.access === "read" ? "read-only" : ""
  return [viaWord(f.via), access].filter(Boolean).join(" · ")
}

export function SourcePicker({
  facets,
  filterGroup,
  setFilterGroup,
  open: openProp,
}: {
  facets: readonly SourceEntry[]
  filterGroup: FilterGroup
  setFilterGroup: Dispatch<SetStateAction<FilterGroup>>
  /** The Source chip opens the picker — it is the chip's editor. */
  open?: [boolean, (open: boolean) => void]
}) {
  const { open, setOpen, anchor } = usePopover(openProp)
  const available = facets.filter(f => f.installed).map(f => f.name)
  const selected = selectedSources(filterGroup)
  const all = selected.length === 0
  const total = facets.reduce((n, f) => n + (f.installed ? (f.count ?? 0) : 0), 0)
  const ticked = (name: string) => selected.includes(name) || (all && available.length === 1)

  return (
    <div ref={anchor} className={popoverAnchor}>
      <button
        type="button"
        className={cx(button, buttonTone[open ? "active" : "default"], buttonSize.default)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={all ? "Sources — showing all" : `Sources — showing ${selected.join(", ")}`}
        onClick={() => setOpen(!open)}
      >
        {all ? (
          <>
            <Icon name="layers" /> All sources
          </>
        ) : selected.length === 1 ? (
          <SourceMark name={selected[0]!} />
        ) : (
          <>
            <span className="inline-flex gap-0.5" aria-hidden="true">
              {selected.map(n => (
                <span key={n} className={sourceDot} style={{ background: sourceColor(n) }} />
              ))}
            </span>
            {selected.length} sources
          </>
        )}
        <Icon name="chevron-down" />
      </button>
      {open && (
        <Menu
          className={menu}
          role="listbox"
          multiselectable
          label="Sources"
          align="end"
          onClose={() => setOpen(false)}
        >
          <button
            type="button"
            role="option"
            aria-selected={all}
            className={cx(menuItem, menuItemTone.default)}
            onClick={() => setFilterGroup(g => withSourceSelection(g, null))}
          >
            <span className={menuCheck}>{all && <Icon name="check" />}</span>
            <span className={menuLabel}>All sources</span>
            <span className={subtle}>{total}</span>
          </button>
          {facets.map(f =>
            f.installed ? (
              <button
                key={f.name}
                type="button"
                role="option"
                aria-selected={ticked(f.name)}
                data-source={f.name}
                className={cx(menuItem, menuItemTone.default)}
                onClick={() => {
                  // one source: picking it is picking all, which is what is shown
                  if (available.length > 1) setFilterGroup(g => toggleSource(g, f.name, available))
                }}
              >
                <span className={menuCheck}>{ticked(f.name) && <Icon name="check" />}</span>
                <span className={menuLabel}>
                  <SourceMark name={f.name} access={f.access} via={f.via} note={f.note} />
                </span>
                {f.access && (
                  <span className={subtle} title={f.note}>
                    {pickerWords(f)}
                  </span>
                )}
                <span className={subtle}>{f.count}</span>
              </button>
            ) : (
              <span
                key={f.name}
                className={cx(menuItem, menuItemTone.absent)}
                data-source={f.name}
                title={`${f.name} is not installed — its records are not read`}
              >
                <span className={menuCheck} />
                <span className={menuLabel}>
                  <SourceMark name={f.name} access={f.access} via={f.via} note={f.note} />
                </span>
                <span className={subtle}>not installed</span>
              </span>
            )
          )}
        </Menu>
      )}
    </div>
  )
}
