/** THE WORKSPACE'S FIRST PAGE — its own collections (not the engine's runtime ones) as cards to open. */
import { useApp } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { Link } from "../components/Link.tsx"
import { listRoute } from "../lib/route.ts"
import { page, pageHead, subtle } from "../styles/classes.ts"

/** The collections as a grid of cards. (was dt-cards / dt-card) */
const cards = "list-none p-0 m-0 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3"
const card =
  "grid gap-1.5 px-4 py-3.5 border border-border rounded-dt text-inherit h-full hover:bg-bg-hover hover:no-underline"

export function HomePage() {
  const { schema } = useApp()
  const own = schema.collections
    .filter(c => !c.runtime && !c.internal)
    .sort((a, b) => (a.nav.order ?? 1e9) - (b.nav.order ?? 1e9) || a.title.localeCompare(b.title))
  return (
    <section className={page}>
      <header className={pageHead}>
        <h1>Collections</h1>
      </header>
      <ul className={cards}>
        {own.map(c => (
          <li key={c.collection}>
            <Link to={listRoute(c.collection)} className={card}>
              <strong>
                <Icon name={c.nav.icon ?? "table"} /> {c.title}
              </strong>
              <span className={subtle}>{c.collection}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
