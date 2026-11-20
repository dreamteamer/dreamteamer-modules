/**
 * THE NAV — the tree `GET /nav` answers (the workspace's `nav.yaml` resolved by the host: collections, namespaces,
 * folders, saved views), ported from the Vue ui's NavSidebar.vue + AppNav.vue. Re-read on every
 * invalidation, so a collection added in a terminal appears without a reload.
 *
 * A 32 px TOOLBAR above the rows never scrolls (the rows scroll beneath it, a thin shadow under it while they are
 * scrolled): the workspace's name (on a pane host, the workspace switcher), Back and Forward, and at the right end the
 * ARRANGE LOCK and, on a pane host, the level. The workspace node is NOT a row: its children are the top level.
 *
 * The lock starts locked on every load and is kept nowhere: locked, the nav only navigates; unlocked, rows drag and
 * have a right-click menu, and the toolbar offers New folder and Show hidden…. Every gesture is ONE NavOp sent as
 * `PATCH /nav` (lib/navTree.ts decides which), then the nav is read again; a refusal shows the host's sentence.
 * Arranging needs Edit: on a pane host at Read the lock is disabled saying so, and a lower to Read while unlocked
 * locks it.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react"
import { getNav, request } from "../api/client.ts"
import { useApp, useSignal } from "../AppContext.tsx"
import { appShell } from "../lib/appShell.ts"
import { hostInfo, paneHost } from "../lib/host.ts"
import { menuUnder, rectOf, viewportWidth } from "../lib/menuPlace.ts"
import { canBack, canForward, navHistory } from "../lib/navHistory.ts"
import {
  NAV_DRAG_TYPE,
  TAIL,
  currentKey,
  dropOp,
  dropWhere,
  foldersAbove,
  hiddenIn,
  hoverHint,
  navIndex,
  rowMenu,
  tailLine,
  tailOp,
  toolbarMenu,
  type DropHint,
  type NavIndex,
  type NavNode,
  type NavOp,
} from "../lib/navTree.ts"
import { dragWidth, keyWidth, loadNavWidth, navWidthBounds, saveNavWidth } from "../lib/navWidth.ts"
import { openMenu } from "../lib/openMenu.ts"
import { seedTitle } from "../lib/tabs.ts"
import { Icon } from "./Icon.tsx"
import { NavMenu } from "./NavMenu.tsx"
import { PaneLevel } from "./PaneLevel.tsx"
import { PaneSwitcher } from "./PaneSwitcher.tsx"
import { cx, iconButton } from "../styles/classes.ts"
import { navTool } from "./looks.ts"

/** The sentence the disabled arrange lock says at Read on a pane host. */
const NEEDS_EDIT = "Arranging the nav needs Edit"
/** The menu key of the toolbar's own buttons (New folder, Show hidden…). */
const TOOLBAR = "::toolbar"
/** The width a toolbar menu is placed for (the text ask is 220 px wide plus its border). */
const MENU_WIDTH = 224

/**
 * The nav column, `--dt-nav-w` wide (a width a person chose) or the token's default. On a narrow window it stacks above
 * the page. In the browser shell it sits on the canvas with no ground of its own and no line — the sheet beside it
 * carries the edge; in an editor it keeps its quiet panel and the line.
 */
const navCls = cx(
  "relative flex flex-col min-h-0 overflow-hidden w-(--dt-nav-w,var(--dt-nav-width)) max-[720px]:w-auto max-[720px]:max-h-[40vh]",
  appShell ? "bg-transparent" : "bg-bg-subtle border-r border-border max-[720px]:border-r-0 max-[720px]:border-b"
)
const toolbarCls = cx(
  "relative z-[2] flex-none flex flex-wrap justify-end items-center gap-1 min-h-8 pt-[3px] pr-1 pb-[3px] pl-2 [transition:box-shadow_var(--dt-dur-fast)_var(--dt-ease)]",
  appShell ? "bg-canvas" : "bg-bg-subtle"
)
/**
 * THE EDGE (browser shell): a 6 px strip on the nav's inline end — col-resize, a hairline on hover, the focus colour while
 * focused or dragged. Nothing animates while a drag is on: the edge follows the pointer, not a transition.
 */
const resizeCls =
  "absolute inset-y-0 end-0 z-[3] w-1.5 cursor-col-resize touch-none outline-none after:content-[''] after:absolute after:inset-y-0 after:end-0 after:w-0.5 after:bg-transparent after:[transition:background-color_var(--dt-dur-fast)_var(--dt-ease)] hover:after:bg-ink-4 focus-visible:after:bg-focus max-[720px]:hidden"
const toolbarLabel = "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-fg"
const toolbarLabelButton =
  "max-w-full h-6 px-1 py-0 border-0 rounded-dt bg-transparent font-[inherit] text-[length:inherit] leading-[inherit] text-left hover:bg-bg-hover"
const TAIL_CLS = "flex-[1_0_24px]"
/**
 * ROWS: 30 px tall on one x-grid — a 14 px twisty slot, a 16 px icon box and the label, then ONE right-hand column for
 * marks and counts — so at one depth every icon starts at one x and every label at another, whatever the row carries.
 * The highlight is a ::before layer inset 6 px from each side, so hover (a light accent tint) and the current row (a
 * surface card with a hairline ring, weight 600) never move the icon or the label.
 */
const rowCls =
  "relative isolate flex items-center gap-1.5 h-[30px] pr-3.5 cursor-pointer whitespace-nowrap text-fg outline-none [&[draggable=true]]:cursor-grab before:content-[''] before:absolute before:inset-y-px before:inset-x-1.5 before:-z-10 before:rounded-lg before:bg-transparent before:[transition:background-color_var(--dt-dur-fast)_var(--dt-ease),box-shadow_var(--dt-dur-fast)_var(--dt-ease)] focus-visible:before:shadow-[0_0_0_2px_var(--dt-focus)]"
const rowCurrent = "font-semibold before:bg-surface before:shadow-card [&_[data-nav-icon]]:text-accent"
const rowHover = "hover:before:bg-accent-tint"
/** A SECTION — a folder or namespace row at the top level: a small uppercase, letter-spaced, muted label. */
const rowSection =
  "mt-0.5 text-fg-subtle [&_[data-nav-label]]:text-small [&_[data-nav-label]]:font-semibold [&_[data-nav-label]]:uppercase [&_[data-nav-label]]:tracking-[0.05em] [&_[data-nav-icon]]:text-fg-muted"
/** The line (or the frame) a row shows where a dragged row would land. */
const DROP_HINT: Record<DropHint["where"], string> = {
  after: "shadow-[inset_0_-2px_0_var(--dt-accent)]",
  before: "shadow-[inset_0_2px_0_var(--dt-accent)]",
  into: "before:bg-accent-tint before:shadow-[0_0_0_1px_var(--dt-accent)]",
}

type MenuAt = { key: string; x: number; y: number; start?: string; trigger?: HTMLElement | null }

export function Nav() {
  const { version, navigate, go, route } = useApp()
  const host = useSignal(hostInfo)
  const history = useSignal(navHistory)
  const pane = paneHost(host)
  const blocked = pane && (host?.level ?? "read") === "read" ? NEEDS_EDIT : null

  const [nodes, setNodes] = useState<NavNode[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reads, setReads] = useState(0)
  const ix = useMemo(() => navIndex(nodes), [nodes])
  // ui draws every folder open until it is closed; the set holds the closed ones
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  const isOpen = useCallback((key: string) => !closed.has(key), [closed])
  const [arranging, setArranging] = useState(false)
  const dragging = useRef<string | null>(null)
  const [hint, setHint] = useState<DropHint | null>(null)
  const [menuAt, setMenuAtRaw] = useState<MenuAt | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const [hiddenNames, setHiddenNames] = useState<string[]>([])
  const which = useSignal(openMenu)
  const current = useMemo(() => currentKey(ix, route), [ix, route])

  // the current row is never hidden inside a closed folder: its folders open when the page changes
  useEffect(() => {
    if (!current) return
    const above = foldersAbove(ix, current)
    setClosed(s => (above.some(k => s.has(k)) ? new Set([...s].filter(k => !above.includes(k))) : s))
  }, [current, ix])

  // the nav's width (browser shell): a drag on the edge, the arrow keys on it (Home/End: the bounds) or a double-click
  // (the default). With nothing kept the token's default governs, so the stylesheet alone draws a fresh nav.
  const navEl = useRef<HTMLElement | null>(null)
  const [bounds, setBounds] = useState(navWidthBounds)
  const [chosen, setChosen] = useState<number | null>(() => (appShell ? loadNavWidth(navWidthBounds()) : null))
  const [resizing, setResizing] = useState(false)
  const drag = useRef<{ x: number; w: number } | null>(null)
  const navWidth = chosen ?? bounds.def
  useEffect(() => {
    // the stylesheet is in by now: read the bounds it declares, and keep a kept width inside them
    const b = navWidthBounds()
    setBounds(b)
    if (appShell) setChosen(c => (c == null ? c : loadNavWidth(b)))
  }, [])
  const navDir = (): "ltr" | "rtl" => {
    try {
      return navEl.current && getComputedStyle(navEl.current).direction === "rtl" ? "rtl" : "ltr"
    } catch {
      return "ltr"
    }
  }
  const setWidth = (w: number) => {
    setChosen(w)
    saveNavWidth(w)
  }
  const resize = {
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      const next = keyWidth(navWidth, e.key, bounds, { shift: e.shiftKey, dir: navDir() })
      if (next == null) return
      e.preventDefault()
      setWidth(next)
    },
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      drag.current = { x: e.clientX, w: navWidth }
      setResizing(true)
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // no capture: moves still arrive while over the edge
      }
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (drag.current) setChosen(dragWidth(drag.current.w, drag.current.x, e.clientX, bounds, navDir()))
    },
    onEnd: () => {
      if (!drag.current) return
      drag.current = null
      setResizing(false)
      setChosen(c => {
        if (c != null) saveNavWidth(c)
        return c
      })
    },
    onReset: () => {
      drag.current = null
      setResizing(false)
      setChosen(null)
      saveNavWidth(null)
    },
  }

  useEffect(() => {
    let live = true
    getNav().then(
      list => {
        if (!live) return
        setNodes(list)
        const said = list.find(n => n.kind === "workspace")?.notice ?? list[0]?.notice
        if (said) setNotice(said)
        setError(null)
      },
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e))
    )
    return () => {
      live = false
    }
  }, [version, reads])

  // one nav menu at a time (lib/openMenu.ts): a row menu or a toolbar ask closes a pane menu, and the other way
  const setMenuAt = useCallback((m: MenuAt | null) => {
    setMenuAtRaw(m)
    if (m) openMenu.set("nav")
    else if (openMenu.get() === "nav") openMenu.set(null)
  }, [])
  useEffect(() => {
    if (which !== "nav" && menuAt) setMenuAtRaw(null)
  }, [which, menuAt])
  useEffect(() => {
    if (!menuAt) return
    const away = () => setMenuAt(null)
    window.addEventListener("click", away)
    return () => window.removeEventListener("click", away)
  }, [menuAt, setMenuAt])

  const lock = useCallback(() => {
    setArranging(false)
    setMenuAt(null)
    dragging.current = null
    setHint(null)
  }, [setMenuAt])
  useEffect(() => {
    if (blocked) lock()
  }, [blocked, lock])

  /** One gesture: one PATCH /nav, then the nav as the host now draws it — or the host's refusal, shown. */
  const send = async (op: NavOp | null) => {
    setMenuAt(null)
    if (!op) return
    try {
      const res = (await request("PATCH", "/nav", op)) as { doc?: { tree?: unknown; hidden?: unknown } } | null
      if (res?.doc) setHiddenNames(hiddenIn(res.doc))
      setError(null)
      setReads(r => r + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const toggle = (key: string) =>
    setClosed(s => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const menu = !menuAt ? null : menuAt.key === TOOLBAR ? toolbarMenu(hiddenNames) : rowMenu(ix, menuAt.key)
  const workspace = ix.workspace

  const openToolbarMenu = (id: "new-folder" | "show-hidden", e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (!arranging) return
    if (menuAt?.key === TOOLBAR && menuAt.start === id) return setMenuAt(null)
    setMenuAt({
      key: TOOLBAR,
      ...menuUnder(rectOf(e.currentTarget), "start", MENU_WIDTH, viewportWidth()),
      start: id,
      trigger: e.currentTarget,
    })
  }

  const rows: RowCtx = {
    ix,
    isOpen,
    current,
    hint: arranging ? hint : null,
    arranging,
    toggle,
    activate: n => {
      if (n.route) {
        // the tab opens already named (lib/tabs.ts): the nav entry's label
        seedTitle(n.route, n.label, n.icon)
        navigate(n.route)
      } else if (n.children?.length) toggle(n.key)
    },
    dragStart: key => {
      dragging.current = key
    },
    hover: h => setHint(hoverHint(ix, h)),
    drop: (key, targetKey, where) => {
      const op = dropOp(ix, key ?? dragging.current, targetKey, where, isOpen)
      dragging.current = null
      setHint(null)
      void send(op)
    },
    menu: (key, x, y) => {
      const n = ix.byKey.get(key)
      setMenuAt(arranging && n && rowMenu(ix, key) ? { key, x, y } : null)
    },
  }

  const tail = tailLine(ix)
  const lockTitle = blocked
    ? blocked
    : arranging
      ? "Arranging the nav: rows drag and have menus — click to lock it"
      : "The nav is locked — click to arrange it (drag rows, row menus)"

  return (
    <nav
      ref={navEl}
      className={cx(
        navCls,
        resizing && "select-none cursor-col-resize **:before:transition-none! **:after:transition-none!"
      )}
      style={chosen == null ? undefined : ({ "--dt-nav-w": `${chosen}px` } as CSSProperties)}
      aria-label="Workspace"
      onDragEnd={() => {
        setHint(null)
        dragging.current = null
      }}
    >
      {appShell && (
        <div
          className={cx(resizeCls, resizing && "after:bg-focus")}
          role="separator"
          aria-orientation="vertical"
          aria-label="Nav width"
          aria-valuenow={navWidth}
          aria-valuemin={bounds.min}
          aria-valuemax={bounds.max}
          tabIndex={0}
          title="Drag to resize the nav — double-click to reset"
          onPointerDown={resize.onPointerDown}
          onPointerMove={resize.onPointerMove}
          onPointerUp={resize.onEnd}
          onPointerCancel={resize.onEnd}
          onLostPointerCapture={resize.onEnd}
          onKeyDown={resize.onKeyDown}
          onDoubleClick={resize.onReset}
        />
      )}
      <div className={cx(toolbarCls, scrolled && "shadow-card")} role="toolbar" aria-label="Nav">
        <div className="flex-[1_0_30px] min-w-[30px] flex items-center overflow-hidden">
          {pane ? (
            <PaneSwitcher label={workspace?.label} />
          ) : workspace?.route ? (
            <button
              type="button"
              className={cx(toolbarLabel, toolbarLabelButton)}
              title={`${workspace.label} — Workspace settings`}
              onClick={e => {
                e.stopPropagation()
                navigate(workspace.route!)
              }}
            >
              {workspace.label}
            </button>
          ) : (
            <span className={toolbarLabel} title={workspace?.label}>
              {workspace?.label ?? ""}
            </span>
          )}
        </div>
        <div className="contents">
          <button
            type="button"
            className={navTool}
            data-tool="back"
            title="Back"
            aria-label="Back"
            disabled={!canBack(history)}
            onClick={() => go(-1)}
          >
            <Icon name="arrow-left" />
          </button>
          <button
            type="button"
            className={navTool}
            data-tool="forward"
            title="Forward"
            aria-label="Forward"
            disabled={!canForward(history)}
            onClick={() => go(1)}
          >
            <Icon name="arrow-right" />
          </button>
          {arranging && (
            <>
              <button
                type="button"
                className={navTool}
                data-tool="new-folder"
                title="New folder…"
                aria-label="New folder"
                onClick={e => openToolbarMenu("new-folder", e)}
              >
                <Icon name="new-folder" />
              </button>
              <button
                type="button"
                className={navTool}
                data-tool="show-hidden"
                title="Show hidden…"
                aria-label="Show hidden"
                onClick={e => openToolbarMenu("show-hidden", e)}
              >
                <Icon name="eye-closed" />
              </button>
            </>
          )}
          <button
            type="button"
            className={navTool}
            data-tool="arrange"
            aria-pressed={arranging}
            aria-label="Arrange the nav"
            data-nav-lock
            title={lockTitle}
            disabled={!!blocked && !arranging}
            onClick={e => {
              e.stopPropagation()
              if (arranging) lock()
              else if (!blocked) setArranging(true)
            }}
          >
            <Icon name="list-tree" />
            <i
              className={cx(
                "codicon absolute right-px bottom-px text-2xs! leading-[10px]! rounded-xs",
                arranging
                  ? "bg-bg-active codicon-unlock"
                  : cx(appShell ? "bg-canvas" : "bg-bg-subtle", "codicon-lock-small")
              )}
              aria-hidden="true"
            />
          </button>
          {pane && <PaneLevel />}
        </div>
      </div>
      {notice && (
        <p className="flex-none flex items-start gap-1.5 mx-1.5 my-1 px-2 py-1.5 rounded-dt bg-bg-active text-small">
          <span className="flex-1">{notice}</span>
          <button type="button" className={iconButton} title="Dismiss" onClick={() => setNotice(null)}>
            <Icon name="close" />
          </button>
        </p>
      )}
      {error && <p className="flex-none m-0 px-2 py-1.5 text-danger">{error}</p>}
      <div
        className="flex-[1_1_auto] min-h-0 overflow-y-auto flex flex-col"
        onScroll={e => setScrolled(e.currentTarget.scrollTop > 0)}
      >
        <ul className="flex-none list-none m-0 px-0 pt-0 pb-1" role="tree">
          {ix.top.map(n => (
            <NavRow key={n.key} node={n} depth={0} ctx={rows} />
          ))}
        </ul>
        {arranging ? (
          <div
            className={cx(TAIL_CLS, hint?.key === TAIL && "shadow-[inset_0_2px_0_var(--dt-accent)]")}
            data-key={TAIL}
            onDragOver={e => {
              e.preventDefault()
              setHint(tail)
            }}
            onDrop={e => {
              e.preventDefault()
              e.stopPropagation()
              const op = tailOp(ix, e.dataTransfer.getData(NAV_DRAG_TYPE) || dragging.current)
              dragging.current = null
              setHint(null)
              void send(op)
            }}
          />
        ) : (
          <div className={TAIL_CLS} data-key={TAIL} />
        )}
      </div>
      {menuAt && menu && (
        <NavMenu
          key={`${menuAt.key}:${menuAt.start ?? ""}`}
          x={menuAt.x}
          y={menuAt.y}
          items={menu.items}
          start={menuAt.start}
          trigger={menuAt.trigger}
          onPick={p => void send(menu.act(p.id, p.value))}
          onClose={() => setMenuAt(null)}
        />
      )}
    </nav>
  )
}

interface RowCtx {
  ix: NavIndex
  isOpen(key: string): boolean
  /** The key of the row the open page belongs to (lib/navTree.ts currentKey). */
  current: string | null
  hint: DropHint | null
  arranging: boolean
  toggle(key: string): void
  activate(n: NavNode): void
  dragStart(key: string): void
  hover(h: DropHint): void
  drop(key: string | null, targetKey: string, where: DropHint["where"]): void
  menu(key: string, x: number, y: number): void
}

/** Where on the row the pointer is: 0 its top edge, 1 its bottom. */
const pointerAt = (e: DragEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect()
  return r.height ? (e.clientY - r.top) / r.height : Number.NaN
}

/**
 * One row and, when open, its children. Locked, a row is a link and nothing else — not draggable, no drop handler (so
 * the browser shows no drop), and no context-menu handler (a right click is the browser's own).
 */
function NavRow({ node, depth, ctx }: { node: NavNode; depth: number; ctx: RowCtx }) {
  const kids = node.children ?? []
  const open = ctx.isOpen(node.key)
  const active = ctx.current === node.key
  const section = depth === 0 && kids.length > 0 && node.kind !== "collection"
  const hinted = ctx.hint?.key === node.key ? ctx.hint.where : null
  const gestures = ctx.arranging
    ? {
        draggable: node.target ? true : undefined,
        onDragStart: (e: DragEvent<HTMLDivElement>) => {
          if (!node.target) return
          e.dataTransfer.setData(NAV_DRAG_TYPE, node.key)
          e.dataTransfer.setData("text/plain", node.label ?? node.key)
          e.dataTransfer.effectAllowed = "move"
          // after the event: changing the DOM inside dragstart cancels the drag in Chrome
          setTimeout(() => ctx.dragStart(node.key), 0)
        },
        onDragOver: (e: DragEvent<HTMLDivElement>) => {
          e.preventDefault()
          ctx.hover({ key: node.key, where: dropWhere(node, pointerAt(e)) })
        },
        onDrop: (e: DragEvent<HTMLDivElement>) => {
          e.preventDefault()
          e.stopPropagation()
          ctx.drop(e.dataTransfer.getData(NAV_DRAG_TYPE) || null, node.key, dropWhere(node, pointerAt(e)))
        },
        onContextMenu: (e: MouseEvent<HTMLDivElement>) => {
          e.preventDefault()
          e.stopPropagation()
          ctx.menu(node.key, e.clientX, e.clientY)
        },
      }
    : {}
  return (
    <li role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={active}>
      <div
        className={cx(
          rowCls,
          section && rowSection,
          active && rowCurrent,
          !active && !hinted && rowHover,
          hinted && DROP_HINT[hinted]
        )}
        data-kind={node.kind}
        style={{ paddingLeft: 8 + depth * 12 }}
        title={node.tooltip}
        data-key={node.key}
        data-nav-row
        aria-current={active ? "page" : undefined}
        // every row is a tab stop — Enter or Space opens it, → and ← open and close a folder
        tabIndex={0}
        onClick={() => ctx.activate(node)}
        onKeyDown={e => {
          if (e.target !== e.currentTarget) return
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            ctx.activate(node)
          } else if (kids.length && ((e.key === "ArrowRight" && !open) || (e.key === "ArrowLeft" && open))) {
            e.preventDefault()
            ctx.toggle(node.key)
          }
        }}
        {...gestures}
      >
        <span
          className="flex-none w-3.5 inline-flex justify-center text-fg-muted [&_.codicon]:text-small!"
          onClick={e => {
            e.stopPropagation()
            if (kids.length) ctx.toggle(node.key)
          }}
        >
          {kids.length > 0 && <Icon name={open ? "chevron-down" : "chevron-right"} />}
        </span>
        <span
          className="flex-none w-4 h-4 inline-flex items-center justify-center text-fg-subtle"
          data-nav-icon
          aria-hidden="true"
        >
          {node.icon && <Icon name={node.icon} />}
        </span>
        <span className="flex-1 min-w-0 overflow-hidden text-ellipsis" data-nav-label>
          {node.label}
        </span>
        {(node.marks || node.description) && (
          <span className="flex-none min-w-6 inline-flex items-center justify-end gap-1 text-fg-muted text-small tabular-nums">
            {node.marks && <span>{node.marks}</span>}
            {node.description && <span>{node.description}</span>}
          </span>
        )}
      </div>
      {open && kids.length > 0 && (
        <ul className="list-none m-0 p-0" role="group">
          {kids.map(k => (
            <NavRow key={k.key} node={k} depth={depth + 1} ctx={ctx} />
          ))}
        </ul>
      )}
    </li>
  )
}
