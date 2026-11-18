/**
 * THE MODULES list of the Schema tab (ported from the Vue ui's pages/ModuleList.vue): the columns `dt list
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
import { SCHEMA_BASE } from "../lib/createRoute.ts"
import { schemaRowContext } from "../lib/vscodeContext.ts"
import { useModules } from "./useModules.ts"
import {
  button,
  buttonSize,
  buttonTone,
  chip,
  cx,
  error as errorBox,
  mono,
  page,
  pageHead,
  pageHeadSpace,
  subtle,
} from "../styles/classes.ts"
import { table } from "./looks.ts"

export function ModuleList({ only }: { only: readonly string[] | null }) {
  const { modules, loading, error } = useModules()
  const shown = modules.filter(m => !only || only.includes(m.id))
  return (
    <section className={page}>
      <header className={cx(pageHead, pageHeadSpace.page)}>
        <div>
          <h1>
            <Icon name="package" /> Modules
          </h1>
          <p className={subtle}>
            What this workspace is compiled from — its own module, linked clones, installed packages.
          </p>
        </div>
        <button
          type="button"
          className={cx(button, buttonTone.default, buttonSize.default)}
          title="New module (a host command)"
          onClick={() => notify("dt:command", { command: "dreamteamer.newModule" })}
        >
          <Icon name="add" /> New module
        </button>
      </header>
      {error && <p className={errorBox}>{error}</p>}
      {loading && !modules.length && <p className={subtle}>Loading…</p>}
      {shown.length > 0 && (
        <table className={table}>
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
                  <span className={cx(chip, m.location === "node_modules" && "opacity-70")}>{m.location || "—"}</span>
                </td>
                <td className={cx(mono, subtle)}>{m.path || "—"}</td>
                <td className={mono}>{m.name}</td>
                <td className={subtle}>{m.namespaces.join(", ") || "—"}</td>
                <td className={subtle}>{shipsOf(m) || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!loading && !shown.length && !error && <p className={subtle}>No modules{only ? " here" : ""}.</p>}
    </section>
  )
}
