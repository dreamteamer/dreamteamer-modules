/**
 * The table's ROW DENSITY, from the browse header: one button, a three-item menu (Compact, Cozy, Comfortable)
 * with the one in force checked (ported from @dreamteamer/ui's browse/DensityMenu.vue). It writes the table
 * layout's `row_size` option through the same `setListOptions` the Layout options panel writes, merged over the
 * rest of that slice — so the panel, Save and the modified dot all see the pick, and it never drops the grouping
 * or the page size the same slice holds.
 */
import { Icon } from "../components/Icon.tsx"
import { ROW_SIZES, ROW_SIZE_LABELS, resolveRowSize } from "../lib/row-size.ts"
import type { BrowseState } from "./browse-state.ts"
import { usePopover } from "./use-popover.ts"

const LAYOUT = "table"

export function DensityMenu({ state }: { state: BrowseState }) {
  const { open, setOpen, anchor } = usePopover()
  const current = resolveRowSize(state.listOptions[LAYOUT])
  return (
    <div ref={anchor} className="ui2-popover-anchor">
      <button
        type="button"
        className={`ui2-button is-icon${open ? " is-active" : ""}`}
        title={`Row density — ${ROW_SIZE_LABELS[current]}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="list-flat" />
      </button>
      {open && (
        <div className="ui2-menu" role="menu" aria-label="Row density">
          {ROW_SIZES.map(size => (
            <button
              key={size}
              type="button"
              className="ui2-menu-item"
              role="menuitemradio"
              aria-checked={size === current}
              data-size={size}
              onClick={() => {
                state.setListOptions(LAYOUT, { ...(state.listOptions[LAYOUT] ?? {}), row_size: size })
                setOpen(false)
              }}
            >
              <span className="ui2-menu-check">{size === current && <Icon name="check" />}</span>
              {ROW_SIZE_LABELS[size]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
