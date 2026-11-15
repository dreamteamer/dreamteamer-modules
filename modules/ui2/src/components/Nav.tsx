/**
 * THE NAV — the tree `GET /nav` answers (the nav document resolved by the host: collections, namespaces,
 * folders, saved views), drawn as it comes. Re-read on every invalidation, so a collection added in a terminal
 * appears without a reload. Folders open and close; the row of the current route is marked.
 */
import { useState } from "react"
import { getNav, type NavNode } from "../api/client.ts"
import { useApp, useAsync } from "../app-context.tsx"
import { Icon } from "./Icon.tsx"
import { pathOf } from "../lib/route.ts"

export function Nav() {
  const { version } = useApp()
  const nav = useAsync(getNav, [version])
  const roots = nav.data ?? []
  const workspace = roots.find(n => n.kind === "workspace")
  const rows = workspace ? (workspace.children ?? []) : roots

  return (
    <nav className="ui2-nav" aria-label="Workspace">
      <header className="ui2-nav-head">
        <Icon name={workspace?.icon ?? "root-folder"} />
        <span className="ui2-nav-title">{workspace?.label ?? "Workspace"}</span>
      </header>
      {workspace?.notice && <p className="ui2-nav-notice">{workspace.notice}</p>}
      {nav.error && <p className="ui2-error">{nav.error}</p>}
      <ul className="ui2-nav-tree" role="tree">
        {rows.map(n => (
          <NavRow key={n.key} node={n} depth={0} />
        ))}
      </ul>
    </nav>
  )
}

function NavRow({ node, depth }: { node: NavNode; depth: number }) {
  const { route, navigate } = useApp()
  const [open, setOpen] = useState(true)
  const kids = node.children ?? []
  // a row naming a query (a layer's `?filter=`) is active on exactly that route; any other on its path and below
  const here = node.route?.includes("?") ? route : pathOf(route)
  const active = node.route !== undefined && (here === node.route || here.startsWith(`${node.route}/`))
  const click = () => {
    if (node.route) navigate(node.route)
    else if (kids.length) setOpen(o => !o)
  }
  return (
    <li role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={active}>
      <div
        className={`ui2-nav-row${active ? " is-active" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={node.tooltip}
        onClick={click}
      >
        <span
          className="ui2-nav-twisty"
          onClick={e => {
            e.stopPropagation()
            setOpen(o => !o)
          }}
        >
          {kids.length > 0 && <Icon name={open ? "chevron-down" : "chevron-right"} />}
        </span>
        <Icon name={node.icon} />
        <span className="ui2-nav-label">{node.label}</span>
        {node.marks && <span className="ui2-nav-marks">{node.marks}</span>}
        {node.description && <span className="ui2-nav-count">{node.description}</span>}
      </div>
      {open && kids.length > 0 && (
        <ul role="group">
          {kids.map(k => (
            <NavRow key={k.key} node={k} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}
