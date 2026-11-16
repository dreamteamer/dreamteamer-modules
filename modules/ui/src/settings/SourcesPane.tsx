/**
 * THE SOURCES PAGE of the Schema tab (ported from the Vue ui's pages/SourcesPane.vue): the stack of roots this
 * workspace reads, top to bottom as `dt status` prints it — the workspace's own data, each record layer (its clone,
 * installed or not, the collections it contributes and the records read from each), each module-owned collection
 * under its module (`GET /sources`). A layer whose clone is absent is greyed, says *not installed*, and shows no
 * counts.
 *
 * REMOTE ACCESS (cr-vscode-012): once the stack is on screen, `GET /sources/access` says what each source's remote
 * grants as the account that pushes — the mark beside the local one. Re-check asks again (`fresh=1`); Who has
 * access asks for one source's people, teams and groups (`/sources/access/members`), or the provider's reason it
 * will not say. Computed live by the host, never stored.
 */
import { useEffect, useState, type ReactNode } from "react"
import { getSources, getSourceMembers, getSourcesAccess } from "../api/client.ts"
import type { OwnAccess, RemoteMembers } from "../api/types.ts"
import { useApp, useAsync } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { RemoteAccessMark } from "../components/RemoteAccessMark.tsx"
import { SourceMark } from "../components/SourceMark.tsx"
import { recordCount, recordsIn, type StackEntry } from "../lib/sources-stack.ts"
import {
  button,
  buttonSmall,
  cx,
  error,
  hint,
  linkButton,
  mono,
  page,
  pageHead,
  subtle,
  toolbar,
} from "../styles/classes.ts"
import { num, table } from "./looks.ts"

/** A block of the stack: its heading, its line, its entries. (was dt-sources-block, -heading, -line) */
const block = "mb-6"
const heading = "flex items-center gap-1.5 mt-0 mx-0 mb-2 text-[14px]"
const line = "flex flex-wrap items-center gap-x-3.5 gap-y-1.5 mb-1.5"

export function SourcesPane() {
  const { version } = useApp()
  const stack = useAsync(getSources, [version])
  const [access, setAccess] = useState<Record<string, OwnAccess> | null>(null)
  const [accessError, setAccessError] = useState(false)
  const [checking, setChecking] = useState(false)
  const [members, setMembers] = useState<Record<string, RemoteMembers | "loading">>({})
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const loadAccess = async (fresh = false) => {
    setChecking(true)
    setAccessError(false)
    if (fresh) {
      setAccess(null)
      setMembers({})
      setOpen({})
    }
    try {
      setAccess((await getSourcesAccess(fresh)).access ?? {})
    } catch {
      setAccessError(true)
    } finally {
      setChecking(false)
    }
  }
  // the stack is on screen first; the remotes are asked after it, so the network never holds it back
  const ready = !!stack.data
  useEffect(() => {
    if (ready) void loadAccess()
  }, [ready])

  const askable = (name: string) => !!access?.[name] && access[name]!.state !== "not-checked"
  const toggleWho = async (name: string) => {
    const opening = !open[name]
    setOpen(o => ({ ...o, [name]: opening }))
    if (!opening || members[name]) return
    setMembers(m => ({ ...m, [name]: "loading" }))
    let answer: RemoteMembers
    try {
      answer = await getSourceMembers(name)
    } catch {
      answer = { state: "unknown", members: [], reason: "could not be read" }
    }
    setMembers(m => ({ ...m, [name]: answer }))
  }

  const remote = (e: StackEntry) => (
    <>
      {!accessError && <RemoteAccessMark source={e.name} access={access?.[e.name]} local={e.access} />}
      {askable(e.name) && (
        <button type="button" className={linkButton} data-source={e.name} onClick={() => void toggleWho(e.name)}>
          Who has access
        </button>
      )}
    </>
  )
  const who = (name: string) => {
    if (!open[name]) return null
    const m = members[name]
    if (m === "loading") return <p className={subtle}>Asking…</p>
    if (!m) return null
    return (
      <div className="mt-1 mx-0 mb-2">
        {m.reason && <p className={subtle}>{m.reason}</p>}
        {m.members.length > 0 && (
          <table className={table}>
            <tbody>
              {m.members.map(p => (
                <tr key={p.kind + p.name} title={p.role}>
                  <td>{p.name}</td>
                  <td>{p.kind}</td>
                  <td>{p.level}</td>
                  {p.via && <td>{p.via}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    )
  }
  const s = stack.data

  return (
    <section className={page}>
      <header className={pageHead}>
        <div>
          <h1>Sources</h1>
          <p className={subtle}>
            Where this workspace reads its records from, top to bottom — the first root to hold an id is the one read.
          </p>
        </div>
        {s && (
          <div className={toolbar}>
            <span className={hint}>
              Remote access is asked live, as the account each remote pushes as — never stored.
            </span>
            <button
              type="button"
              className={cx(button, buttonSmall)}
              disabled={checking}
              onClick={() => void loadAccess(true)}
            >
              <Icon name="refresh" /> Re-check
            </button>
          </div>
        )}
      </header>
      {accessError && <p className={error}>remote access could not be read</p>}
      {stack.error && <p className={error}>{stack.error}</p>}
      {!s && !stack.error && <p className={subtle}>Loading…</p>}
      {s && (
        <>
          <section className={block} data-kind="own">
            <h2 className={heading}>
              <Icon name="root-folder" /> {s.workspace.name}{" "}
              <span className={cx(subtle, "font-normal")}>this workspace</span>
            </h2>
            <div className={line}>{remote(s.workspace)}</div>
            {who(s.workspace.name)}
            {s.workspace.collections.length ? (
              <table className={table}>
                <thead>
                  <tr>
                    <th>Collection</th>
                    <th>Folder</th>
                    <th className={num}>Records</th>
                  </tr>
                </thead>
                <tbody>
                  {s.workspace.collections.map(c => (
                    <tr key={c.collection}>
                      <td>{c.collection}</td>
                      <td className={cx(mono, subtle)}>{c.path}</td>
                      <td className={num}>{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className={subtle}>No collection keeps records in the workspace's own folder.</p>
            )}
          </section>

          <section className={block} data-kind="layers">
            <h2 className={heading}>
              <Icon name="layers" /> Record layers{" "}
              <span className={cx(subtle, "font-normal")}>{s.layers.length || "none declared"}</span>
            </h2>
            {s.layers.map(layer => (
              <Entry
                key={layer.name}
                entry={layer}
                absent={!layer.installed}
                remote={remote(layer)}
                who={who(layer.name)}
              >
                <span className={cx(mono, subtle)}>{layer.repo}</span>
                {layer.installed ? (
                  <span className={subtle}>{recordCount(recordsIn(layer), " read")}</span>
                ) : (
                  <span className="text-warning">
                    not installed — run <code>dreamteamer install</code>
                  </span>
                )}
              </Entry>
            ))}
          </section>

          <section className={block} data-kind="modules">
            <h2 className={heading}>
              <Icon name="package" /> Module-owned collections{" "}
              <span className={cx(subtle, "font-normal")}>{s.modules.length || "none"}</span>
            </h2>
            {s.modules.map(mod => (
              <Entry key={mod.name} entry={mod} remote={mod.via !== "package" ? remote(mod) : null} who={who(mod.name)}>
                <span className={cx(mono, subtle)}>{mod.repo === "." ? "commits to this workspace" : mod.repo}</span>
                <span className={subtle}>{recordCount(recordsIn(mod))}</span>
              </Entry>
            ))}
          </section>
        </>
      )}
    </section>
  )
}

function Entry({
  entry,
  absent,
  remote,
  who,
  children,
}: {
  entry: StackEntry
  absent?: boolean
  remote: ReactNode
  who: ReactNode
  children: ReactNode
}) {
  return (
    <article
      className={cx("mb-3 py-2.5 px-3 border border-border rounded-dt [&_p]:my-1", absent && "opacity-60")}
      data-source={entry.name}
    >
      <div className={line}>
        <SourceMark
          name={entry.name}
          record={entry.record}
          context="record"
          access={entry.access}
          via={entry.via}
          note={entry.note}
        />
        {children}
        {remote}
      </div>
      {who}
      {entry.url && <p className={cx(mono, subtle)}>{entry.url}</p>}
      {entry.collections.length ? (
        <ul className="mt-1 mx-0 mb-0 p-0 list-none [&_li]:flex [&_li]:gap-3 [&_li]:py-0.5 [&_li]:px-0">
          {entry.collections.map(c => (
            <li key={c.collection}>
              <span>{c.collection}</span>
              <span className={cx(mono, subtle)}>{c.path}</span>
              {!absent && <span className="ml-auto tabular-nums">{c.count}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className={subtle}>
          Contributes to no compiled collection — its <code>records</code> list names none this workspace has.
        </p>
      )}
    </article>
  )
}
