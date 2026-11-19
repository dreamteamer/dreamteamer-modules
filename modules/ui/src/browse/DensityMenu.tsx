/**
 * The table's ROW DENSITY, from the browse header: one button, a three-item menu (Compact, Cozy, Comfortable)
 * with the one in force checked (ported from the Vue ui's browse/DensityMenu.vue). It writes the table
 * layout's `row_size` option through the same `setListOptions` the Layout options panel writes, merged over the
 * rest of that slice — so the panel, Save and the modified dot all see the pick, and it never drops the grouping
 * or the page size the same slice holds.
 */
import { useRef, useState } from "react"
import { Icon } from "../components/Icon.tsx"
import { Menu } from "../components/Menu.tsx"
import { ROW_SIZES, ROW_SIZE_LABELS, resolveRowSize } from "../lib/rowSize.ts"
import type { BrowseState } from "./useBrowseState.ts"
import {
  button,
  buttonSize,
  buttonTone,
  cx,
  menu,
  menuCheck,
  menuItem,
  menuItemTone,
  popoverAnchor,
} from "../styles/classes.ts"

const LAYOUT = "table"

export function DensityMenu({ state }: { state: BrowseState }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const current = resolveRowSize(state.listOptions[LAYOUT])
  return (
    <div className={popoverAnchor}>
      <button
        ref={trigger}
        type="button"
        className={cx(button, buttonTone[open ? "active" : "default"], buttonSize.icon)}
        title={`Row density — ${ROW_SIZE_LABELS[current]}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="list-flat" />
      </button>
      {open && (
        <Menu className={menu} label="Row density" align="end" trigger={trigger} onClose={() => setOpen(false)}>
          {ROW_SIZES.map(size => (
            <button
              key={size}
              type="button"
              className={cx(menuItem, menuItemTone.default)}
              role="menuitemradio"
              aria-checked={size === current}
              data-size={size}
              onClick={() => {
                state.setListOptions(LAYOUT, { ...(state.listOptions[LAYOUT] ?? {}), row_size: size })
                setOpen(false)
              }}
            >
              <span className={menuCheck}>{size === current && <Icon name="check" />}</span>
              {ROW_SIZE_LABELS[size]}
            </button>
          ))}
        </Menu>
      )}
    </div>
  )
}
