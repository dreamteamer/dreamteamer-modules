/** THE WORKSPACE'S FIRST PAGE — its own collections (not the engine's runtime ones) as cards to open. */
import { useApp } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { Link } from "../components/Link.tsx"
import { listRoute } from "../lib/route.ts"

export function HomePage() {
  const { schema } = useApp()
  const own = schema.collections
    .filter(c => !c.runtime && !c.internal)
    .sort((a, b) => (a.nav.order ?? 1e9) - (b.nav.order ?? 1e9) || a.title.localeCompare(b.title))
  return (
    <section className="dt-page">
      <header className="dt-page-head">
        <h1>Collections</h1>
      </header>
      <ul className="dt-cards">
        {own.map(c => (
          <li key={c.collection}>
            <Link to={listRoute(c.collection)} className="dt-card">
              <strong>
                <Icon name={c.nav.icon ?? "table"} /> {c.title}
              </strong>
              <span className="dt-subtle">{c.collection}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
