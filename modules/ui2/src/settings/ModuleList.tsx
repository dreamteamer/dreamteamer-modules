/**
 * THE MODULES list of the Schema tab (ported from @dreamteamer/ui's pages/ModuleList.vue): the columns `dt list
 * modules` prints — id and title, location, path, package, namespaces, what it ships — so the page and the CLI
 * answer the same question the same way. A module is a ROW here, which is what makes "add a collection to THIS
 * module" expressible: its record page carries New collection….
 *
 * New module… is a HOST command (`dreamteamer.newModule`): creating a module scaffolds folders and a package, an
 * engine act whose refusals are what the operator should read. A browser host that has no such command ignores it.
 */
import { notify } from "../api/client.ts"
import { Icon } from "../components/Icon.tsx"
import { Link } from "../components/Link.tsx"
import { shipsOf } from "../lib/modules.ts"
import { SCHEMA_BASE } from "../lib/route.ts"
import { schemaRowContext } from "../lib/vscode-context.ts"
import { useModules } from "./use-modules.ts"

export function ModuleList({ only }: { only: readonly string[] | null }) {
  const { modules, loading, error } = useModules()
  const shown = modules.filter(m => !only || only.includes(m.id))
  return (
    <section className="ui2-page ui2-modules">
      <header className="ui2-page-head">
        <div>
          <h1>
            <Icon name="package" /> Modules
          </h1>
          <p className="ui2-subtle">
            What this workspace is compiled from — its own module, linked clones, installed packages.
          </p>
        </div>
        <button
          type="button"
          className="ui2-button"
          title="New module (a host command)"
          onClick={() => notify("dt:command", { command: "dreamteamer.newModule" })}
        >
          <Icon name="add" /> New module
        </button>
      </header>
      {error && <p className="ui2-error">{error}</p>}
      {loading && !modules.length && <p className="ui2-subtle">Loading…</p>}
      {shown.length > 0 && (
        <table className="ui2-table">
          <thead>
            <tr>
              <th>Module</th>
              <th>Location</th>
              <th>Path</th>
              <th>Package</th>
              <th>Namespaces</th>
              <th>Ships</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(m => (
              <tr key={m.id} data-vscode-context={schemaRowContext("modules", m.id, m.id, m.location)}>
                <td>
                  <Link to={`${SCHEMA_BASE}/modules/${m.id}`}>
                    <Icon name="package" /> {m.title || m.id}
                  </Link>
                </td>
                <td>
                  <span className={`ui2-chip${m.location === "node_modules" ? " is-readonly" : ""}`}>
                    {m.location || "—"}
                  </span>
                </td>
                <td className="ui2-mono ui2-subtle">{m.path || "—"}</td>
                <td className="ui2-mono">{m.name}</td>
                <td className="ui2-subtle">{m.namespaces.join(", ") || "—"}</td>
                <td className="ui2-subtle">{shipsOf(m) || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!loading && !shown.length && !error && <p className="ui2-empty">No modules{only ? " here" : ""}.</p>}
    </section>
  )
}
