/**
 * THE NAV — the tree `GET /nav` answers (the workspace's `nav.yaml` resolved by the host: collections, namespaces,
 * folders, saved views, the layers), ported from the Vue ui's NavSidebar.vue + AppNav.vue. Re-read on every
 * invalidation, so a collection added in a terminal appears without a reload.
 *
 * A 32 px TOOLBAR above the rows never scrolls (the rows scroll beneath it, a thin shadow under it while they are
 * scrolled): the workspace's name (on a pane host, the workspace switcher), Back and Forward, and at the right end the
 * ARRANGE LOCK and, on a pane host, the level. The workspace node is NOT a row: its children are the top level.
 *
 * The lock starts locked on every load and is kept nowhere: locked, the nav only navigates; unlocked, rows drag and
 * have a right-click menu, and the toolbar offers New folder and Show hidden…. Every gesture is ONE NavOp sent as
 * `PATCH /nav` (lib/nav-tree.ts decides which), then the nav is read again; a refusal shows the host's sentence.
 * Arranging needs Edit: on a pane host at Read the lock is disabled saying so, and a lower to Read while unlocked
 * locks it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react"
import { getNav, request } from "../api/client.ts"
import { useApp, useSignal } from "../app-context.tsx"
import { hostInfo, paneHost } from "../lib/host.ts"
import { menuUnder, rectOf, viewportWidth } from "../lib/menu-place.ts"
import { canBack, canForward, navHistory } from "../lib/nav-history.ts"
import {
  NAV_DRAG_TYPE,
  TAIL,
  dropOp,
  dropWhere,
  hiddenIn,
  hoverHint,
  navIndex,
  rowActive,
  rowMenu,
  tailLine,
  tailOp,
  toolbarMenu,
  type DropHint,
  type NavIndex,
  type NavNode,
  type NavOp,
} from "../lib/nav-tree.ts"
import { openMenu } from "../lib/open-menu.ts"
import { Icon } from "./Icon.tsx"
import { NavMenu } from "./NavMenu.tsx"
import { PaneLevel } from "./PaneLevel.tsx"
import { PaneSwitcher } from "./PaneSwitcher.tsx"

/** The sentence the disabled arrange lock says at Read on a pane host. */
const NEEDS_EDIT = "Arranging the nav needs Edit"
/** The menu key of the toolbar's own buttons (New folder, Show hidden…). */
const TOOLBAR = "::toolbar"
/** The width a toolbar menu is placed for (the text ask is 220 px wide plus its border). */
const MENU_WIDTH = 224

type MenuAt = { key: string; x: number; y: number; start?: string }

export function Nav() {
  const { version, navigate, go } = useApp()
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

  // one nav menu at a time (lib/open-menu.ts): a row menu or a toolbar ask closes a pane menu, and the other way
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
    setMenuAt({ key: TOOLBAR, ...menuUnder(rectOf(e.currentTarget), "start", MENU_WIDTH, viewportWidth()), start: id })
  }

  const rows: RowCtx = {
    ix,
    isOpen,
    hint: arranging ? hint : null,
    arranging,
    toggle,
    activate: n => {
      if (n.route) navigate(n.route)
      else if (n.children?.length) toggle(n.key)
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
      className={`dt-nav${arranging ? " is-arranging" : ""}`}
      aria-label="Workspace"
      onDragEnd={() => {
        setHint(null)
        dragging.current = null
      }}
    >
      <div className={`dt-nav-toolbar${scrolled ? " is-scrolled" : ""}`} role="toolbar" aria-label="Nav">
        <div className="dt-nav-toolbar-name">
          {pane ? (
            <PaneSwitcher label={workspace?.label} />
          ) : workspace?.route ? (
            <button
              type="button"
              className="dt-nav-toolbar-label is-button"
              title={`${workspace.label} — Workspace settings`}
              onClick={e => {
                e.stopPropagation()
                navigate(workspace.route!)
              }}
            >
              {workspace.label}
            </button>
          ) : (
            <span className="dt-nav-toolbar-label" title={workspace?.label}>
              {workspace?.label ?? ""}
            </span>
          )}
        </div>
        <div className="dt-nav-toolbar-buttons">
          <button
            type="button"
            className="dt-nav-tool"
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
            className="dt-nav-tool"
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
                className="dt-nav-tool"
                data-tool="new-folder"
                title="New folder…"
                aria-label="New folder"
                onClick={e => openToolbarMenu("new-folder", e)}
              >
                <Icon name="new-folder" />
              </button>
              <button
                type="button"
                className="dt-nav-tool"
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
            className="dt-nav-tool dt-nav-lock"
            data-tool="arrange"
            aria-pressed={arranging}
            aria-label="Arrange the nav"
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
              className={`dt-nav-lock-badge codicon codicon-${arranging ? "unlock" : "lock-small"}`}
              aria-hidden="true"
            />
          </button>
          {pane && <PaneLevel />}
        </div>
      </div>
      {notice && (
        <p className="dt-nav-notice">
          <span>{notice}</span>
          <button type="button" className="dt-icon-button" title="Dismiss" onClick={() => setNotice(null)}>
            <Icon name="close" />
          </button>
        </p>
      )}
      {error && <p className="dt-nav-error">{error}</p>}
      <div className="dt-nav-rows" onScroll={e => setScrolled(e.currentTarget.scrollTop > 0)}>
        <ul className="dt-nav-tree" role="tree">
          {ix.top.map(n => (
            <NavRow key={n.key} node={n} depth={0} ctx={rows} />
          ))}
        </ul>
        {arranging ? (
          <div
            className={`dt-nav-tail${hint?.key === TAIL ? " is-drop-after" : ""}`}
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
          <div className="dt-nav-tail" data-key={TAIL} />
        )}
      </div>
      {menuAt && menu && (
        <NavMenu
          key={`${menuAt.key}:${menuAt.start ?? ""}`}
          x={menuAt.x}
          y={menuAt.y}
          items={menu.items}
          start={menuAt.start}
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
  const { route } = useApp()
  const kids = node.children ?? []
  const open = ctx.isOpen(node.key)
  const active = rowActive(node.route, route)
  const hinted = ctx.hint?.key === node.key ? ` is-drop-${ctx.hint.where}` : ""
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
        className={`dt-nav-row dt-nav-${node.kind}${active ? " is-active" : ""}${hinted}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={node.tooltip}
        data-key={node.key}
        onClick={() => ctx.activate(node)}
        {...gestures}
      >
        <span
          className="dt-nav-twisty"
          onClick={e => {
            e.stopPropagation()
            if (kids.length) ctx.toggle(node.key)
          }}
        >
          {kids.length > 0 && <Icon name={open ? "chevron-down" : "chevron-right"} />}
        </span>
        <Icon name={node.icon} />
        <span className="dt-nav-label">{node.label}</span>
        {node.marks && <span className="dt-nav-marks">{node.marks}</span>}
        {node.description && <span className="dt-nav-count">{node.description}</span>}
      </div>
      {open && kids.length > 0 && (
        <ul role="group">
          {kids.map(k => (
            <NavRow key={k.key} node={k} depth={depth + 1} ctx={ctx} />
          ))}
        </ul>
      )}
    </li>
  )
}
