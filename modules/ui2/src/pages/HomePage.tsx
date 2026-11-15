/** THE WORKSPACE'S FIRST PAGE — its own collections (not the engine's runtime ones) as cards to open. */
import { useApp } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { Link } from "../components/Link.tsx"
import { titleOf } from "../lib/fields.ts"
import { listRoute } from "../lib/route.ts"

export function HomePage() {
  const { descriptors } = useApp()
  const own = descriptors.filter(d => !d.compiled?.runtime).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <section className="ui2-page">
      <header className="ui2-page-head">
        <h1>Collections</h1>
      </header>
      <ul className="ui2-cards">
        {own.map(d => (
          <li key={d.name}>
            <Link to={listRoute(d.name)} className="ui2-card">
              <strong>
                <Icon name="table" /> {titleOf(d)}
              </strong>
              <span className="ui2-subtle">{d.description ?? d.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
