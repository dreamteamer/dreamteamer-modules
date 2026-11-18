/**
 * COMMANDS — the commands bound to this collection and this record's state against each (ported from
 * the Vue ui's sidebar/CommandsSection.vue): `GET /commands/:c?ids=<id>` is `dt next`'s answer, one row per
 * binding with a state word (available · done · not applicable; a collection-scope command is always
 * runnable). Picking a runnable row writes its ready-to-paste invocation (`/name <ref> …`, eligible ids only)
 * into the box; Copy puts it on the clipboard. Running a command is a coding-agent turn, and stays the person's.
 *
 * Where a chat of this workspace reads the page (GET /host `chat: true`), Ask in chat queues the picked command
 * for the chat's next prompt (`POST /queue`), and the queue's items for this collection are listed, re-read on
 * `dt:queue`.
 */
import { useEffect, useRef, useState } from "react"
import { getCommands, getQueue, queueCommand } from "../api/client.ts"
import { useApp, useAsync, useSignal } from "../AppContext.tsx"
import { Icon } from "../components/Icon.tsx"
import { commandAllDone, commandIcon, commandStatus, type CommandRow } from "../lib/commandRows.ts"
import { hostInfo } from "../lib/host.ts"
import { canAsk, itemLabel, type QueueItem } from "../lib/queueItems.ts"
import { button, buttonSize, buttonTone, code, cx, error, subtle, textarea, toolbar } from "../styles/classes.ts"

export function RecordCommands({ collection, ids }: { collection: string; ids: string[] }) {
  const { version } = useApp()
  const host = useSignal(hostInfo)
  const answer = useAsync(() => getCommands(collection, ids), [collection, ids.join(","), version])
  const rows = answer.data?.commands ?? []
  const [picked, setPicked] = useState<CommandRow | null>(null)
  const [invocation, setInvocation] = useState("")
  const [copied, setCopied] = useState(false)
  const [askError, setAskError] = useState("")
  const [asking, setAsking] = useState(false)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const box = useRef<HTMLTextAreaElement>(null)
  const chat = host?.chat === true

  const loadQueue = () => {
    if (!chat) return
    getQueue().then(
      a => setQueue(Array.isArray(a?.items) ? a.items : []),
      () => {} // a convenience: a failed read keeps the last list
    )
  }
  useEffect(() => {
    loadQueue()
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === "dt:queue") loadQueue()
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-subscribed when the chat flag moves
  }, [chat])

  const pick = (row: CommandRow) => {
    if (row.invocation === null) return
    setPicked(row)
    setInvocation(row.invocation)
    setCopied(false)
    setAskError("")
  }

  const copy = async () => {
    if (!invocation) return
    try {
      await navigator.clipboard.writeText(invocation)
    } catch {
      // a webview may withhold the clipboard — the classic fallback
      box.current?.select()
      document.execCommand("copy")
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const ask = async () => {
    if (!picked || asking) return
    const targets = picked.eligible ?? (picked.scope === "collection" ? ids : [])
    setAsking(true)
    setAskError("")
    try {
      await queueCommand(
        picked.command,
        targets.map(id => `${collection}/${id}`)
      )
      loadQueue()
    } catch (err) {
      setAskError(err instanceof Error ? err.message : String(err))
    } finally {
      setAsking(false)
    }
  }

  const here = queue.filter(i => i.refs.some(r => r.startsWith(`${collection}/`)))
  return (
    <div className="flex flex-col gap-2.5" data-commands>
      {answer.error && <p className={error}>{answer.error}</p>}
      {!answer.loading && !answer.error && rows.length === 0 && (
        <p className={subtle}>
          No commands bound to <strong>{collection}</strong> — add a <code>command-bindings</code> record.
        </p>
      )}
      <ul className="list-none m-0 p-0">
        {rows.map(row => (
          <li key={row.binding}>
            <button
              type="button"
              className={cx(
                "w-full flex items-center gap-2 py-1.5 px-2 border-0 rounded-dt text-fg text-left",
                row.invocation !== null ? "cursor-pointer opacity-100 hover:bg-bg-hover" : "cursor-default opacity-60",
                picked?.binding === row.binding ? "bg-bg-hover" : "bg-transparent",
                commandAllDone(row, ids) && "[&_.codicon]:text-chart-green"
              )}
              disabled={row.invocation === null}
              title={row["argument-hint"] ? `/${row.name} ${row["argument-hint"]}` : `/${row.name}`}
              data-command={row.name}
              onClick={() => pick(row)}
            >
              <Icon name={commandIcon(row)} />
              <span className="flex-1 min-w-0 grid">
                <span className="font-mono text-[12px]">/{row.name}</span>
                <span className={subtle}>{row.description}</span>
              </span>
              <span className="text-small text-fg-subtle whitespace-nowrap">{commandStatus(row, ids)}</span>
            </button>
          </li>
        ))}
      </ul>
      <textarea
        ref={box}
        className={cx(textarea, code)}
        rows={3}
        value={invocation}
        onChange={e => setInvocation(e.target.value)}
        placeholder="pick a command — its invocation lands here, ready to paste into your session"
        spellCheck={false}
      />
      <div className={toolbar}>
        {picked && canAsk({ chat }, picked) && (
          <button
            type="button"
            className={cx(button, buttonTone.default, buttonSize.default)}
            disabled={asking}
            onClick={() => void ask()}
          >
            <Icon name="comment-discussion" /> Ask in chat
          </button>
        )}
        <button
          type="button"
          className={cx(button, buttonTone.default, buttonSize.default)}
          disabled={!invocation}
          onClick={() => void copy()}
        >
          <Icon name={copied ? "check" : "copy"} /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {askError && <p className={error}>{askError}</p>}
      {here.length > 0 && (
        <ul className="list-none m-0 p-0">
          {here.map(item => (
            <li key={item.id} data-state={item.state}>
              <code>{item.invocation}</code> <span className={subtle}>{itemLabel(item)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
