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
        <button type="button" className="dt-link-button" data-source={e.name} onClick={() => void toggleWho(e.name)}>
          Who has access
        </button>
      )}
    </>
  )
  const who = (name: string) => {
    if (!open[name]) return null
    const m = members[name]
    if (m === "loading") return <p className="dt-subtle">Asking…</p>
    if (!m) return null
    return (
      <div className="dt-remote-members">
        {m.reason && <p className="dt-subtle">{m.reason}</p>}
        {m.members.length > 0 && (
          <table className="dt-table">
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
    <section className="dt-page dt-sources">
      <header className="dt-page-head">
        <div>
          <h1>Sources</h1>
          <p className="dt-subtle">
            Where this workspace reads its records from, top to bottom — the first root to hold an id is the one read.
          </p>
        </div>
        {s && (
          <div className="dt-toolbar">
            <span className="dt-hint">
              Remote access is asked live, as the account each remote pushes as — never stored.
            </span>
            <button
              type="button"
              className="dt-button is-small"
              disabled={checking}
              onClick={() => void loadAccess(true)}
            >
              <Icon name="refresh" /> Re-check
            </button>
          </div>
        )}
      </header>
      {accessError && <p className="dt-error">remote access could not be read</p>}
      {stack.error && <p className="dt-error">{stack.error}</p>}
      {!s && !stack.error && <p className="dt-subtle">Loading…</p>}
      {s && (
        <>
          <section className="dt-sources-block" data-kind="own">
            <h2 className="dt-sources-heading">
              <Icon name="root-folder" /> {s.workspace.name} <span className="dt-subtle">this workspace</span>
            </h2>
            <div className="dt-sources-line">{remote(s.workspace)}</div>
            {who(s.workspace.name)}
            {s.workspace.collections.length ? (
              <table className="dt-table">
                <thead>
                  <tr>
                    <th>Collection</th>
                    <th>Folder</th>
                    <th className="is-num">Records</th>
                  </tr>
                </thead>
                <tbody>
                  {s.workspace.collections.map(c => (
                    <tr key={c.collection}>
                      <td>{c.collection}</td>
                      <td className="dt-mono dt-subtle">{c.path}</td>
                      <td className="is-num">{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="dt-subtle">No collection keeps records in the workspace's own folder.</p>
            )}
          </section>

          <section className="dt-sources-block" data-kind="layers">
            <h2 className="dt-sources-heading">
              <Icon name="layers" /> Record layers{" "}
              <span className="dt-subtle">{s.layers.length || "none declared"}</span>
            </h2>
            {s.layers.map(layer => (
              <Entry
                key={layer.name}
                entry={layer}
                absent={!layer.installed}
                remote={remote(layer)}
                who={who(layer.name)}
              >
                <span className="dt-mono dt-subtle">{layer.repo}</span>
                {layer.installed ? (
                  <span className="dt-subtle">{recordCount(recordsIn(layer), " read")}</span>
                ) : (
                  <span className="dt-warning-text">
                    not installed — run <code>dreamteamer install</code>
                  </span>
                )}
              </Entry>
            ))}
          </section>

          <section className="dt-sources-block" data-kind="modules">
            <h2 className="dt-sources-heading">
              <Icon name="package" /> Module-owned collections{" "}
              <span className="dt-subtle">{s.modules.length || "none"}</span>
            </h2>
            {s.modules.map(mod => (
              <Entry key={mod.name} entry={mod} remote={mod.via !== "package" ? remote(mod) : null} who={who(mod.name)}>
                <span className="dt-mono dt-subtle">{mod.repo === "." ? "commits to this workspace" : mod.repo}</span>
                <span className="dt-subtle">{recordCount(recordsIn(mod))}</span>
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
    <article className={`dt-sources-entry${absent ? " is-absent" : ""}`} data-source={entry.name}>
      <div className="dt-sources-line">
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
      {entry.url && <p className="dt-mono dt-subtle">{entry.url}</p>}
      {entry.collections.length ? (
        <ul className="dt-sources-list">
          {entry.collections.map(c => (
            <li key={c.collection}>
              <span>{c.collection}</span>
              <span className="dt-mono dt-subtle">{c.path}</span>
              {!absent && <span className="is-num">{c.count}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="dt-subtle">
          Contributes to no compiled collection — its <code>records</code> list names none this workspace has.
        </p>
      )}
    </article>
  )
}
