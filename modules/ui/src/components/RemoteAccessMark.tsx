/**
 * THE REMOTE MARK (cr-vscode-012; ported from the Vue ui's RemoteAccessMark.vue): what a source's REMOTE
 * grants, in words, beside the local source mark — a cloud, or a warning where a push would be refused. The words
 * and when they warn are `lib/remoteAccess.ts`'s.
 */
import type { OwnAccess, SourceAccess } from "../api/types.ts"
import { remoteMark } from "../lib/remoteAccess.ts"
import { Icon } from "./Icon.tsx"
import { cx } from "../styles/classes.ts"

export function RemoteAccessMark({
  source,
  access,
  local,
}: {
  source: string
  access?: OwnAccess | null
  local?: SourceAccess
}) {
  const view = remoteMark(access, local)
  return (
    <span
      className={cx("inline-flex items-center gap-1 text-small", view.warning ? "text-warning" : "text-fg-subtle")}
      data-source={source}
      data-state={view.state}
      title={view.title}
    >
      <Icon name={view.warning ? "warning" : "cloud"} />
      <span>{view.words}</span>
    </span>
  )
}
