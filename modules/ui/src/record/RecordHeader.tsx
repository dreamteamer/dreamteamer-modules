/**
 * THE RECORD PAGE'S HEADER — three bands, each one idea (ported from the Vue ui's PageHeader.vue and
 * RecordHeaderDisplay.vue):
 *
 *   row 1   tasks / 2026 / 07 / kickoff                       ↻   where you are: the collection, then the id's path
 *   row 2   ⬤ Kickoff with Northwind      [dup]     actions      what this is, and what you can do to it
 *   ─────
 *           DO  Dana Oren   fixture: Northwind   2 hours ago   ● lab · uncommitted
 *
 * The third band is a footnote about the file: the last commit touching it, then where the record is READ FROM
 * and its repo state (`lib/record-origin.ts`) — the one place a record page says its source; a read-only root
 * says why there, and a stub says what it shadows. Under it, the collection's `display.record` line: the
 * `subtitle` template (a reference in it reads as the target's title), the `badge` field as chips decorated by
 * their enum choice, and the `color_by` tint as a rail — nothing at all for a collection that asks for none.
 */
import type { CSSProperties, ReactNode } from "react"
import type { CollectionRow, FieldRow, SourceEntry } from "../api/types.ts"
import { Icon } from "../components/Icon.tsx"
import { Link } from "../components/Link.tsx"
import { SourceMark, StubNote } from "../components/SourceMark.tsx"
import { badgeChips, themeColor, tintOf, tintStyle } from "../lib/collection-display.ts"
import { initialsOf } from "../lib/initials.ts"
import { originClassWord, type RecordOrigin } from "../lib/record-origin.ts"
import type { CommitInfo, Crumb } from "../lib/record-page.ts"
import { relativeTime } from "../lib/relative-time.ts"

export type HeaderOrigin = RecordOrigin & {
  record?: string | null
  access?: SourceEntry["access"]
  via?: SourceEntry["via"]
  note?: string
  stub?: { stubs: string[]; self: boolean; winner: string | null } | null
  stubSources?: readonly SourceEntry[]
}

export function RecordHeader({
  icon,
  title,
  crumbs,
  commit,
  origin,
  badge,
  actions,
  onRefresh,
}: {
  icon?: string
  title: string
  crumbs: Crumb[]
  commit: CommitInfo | null
  origin: HeaderOrigin | null
  /** Beside the title — the duplicate-id badge. */
  badge?: ReactNode
  actions?: ReactNode
  onRefresh?: () => void
}) {
  const when = commit ? new Date(commit.date) : null
  const whenText = commit ? (when && !Number.isNaN(when.getTime()) ? relativeTime(when) : commit.date) : ""
  const classWord = origin ? originClassWord(origin.kind, origin.via) : ""
  return (
    <header className="dt-record-header">
      <div className="dt-record-nav">
        <nav className="dt-record-path" aria-label="Path">
          {crumbs.map((c, i) => (
            <span key={i} className="dt-record-crumb">
              {i > 0 && (
                <span className="dt-subtle" aria-hidden="true">
                  {" / "}
                </span>
              )}
              {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
            </span>
          ))}
        </nav>
        {onRefresh && (
          <button type="button" className="dt-icon-button" title="Refresh" onClick={onRefresh}>
            <Icon name="refresh" />
          </button>
        )}
      </div>
      <div className="dt-record-title-row">
        <div className="dt-record-title">
          <span className="dt-record-icon">
            <Icon name={icon || "file"} />
          </span>
          <h1 title={title}>{title}</h1>
          {badge}
        </div>
        <div className="dt-toolbar">{actions}</div>
      </div>
      {(commit || origin) && (
        <div className="dt-record-commit">
          {commit ? (
            <>
              <span className="dt-avatar" title={commit.author}>
                {initialsOf(commit.author)}
              </span>
              <span>{commit.author}</span>
              <span className="dt-record-commit-message dt-subtle" title={commit.message}>
                {commit.message}
              </span>
              <span className="dt-subtle" title={commit.date}>
                {whenText}
              </span>
            </>
          ) : (
            <span className="dt-record-commit-message dt-subtle">
              {origin?.inRepo ? "no commit holds this record yet" : ""}
            </span>
          )}
          {origin && (
            <span className="dt-record-origin" title={origin.tooltip} data-origin-kind={origin.kind}>
              {origin.name && (
                <SourceMark
                  name={origin.name}
                  record={origin.record ?? null}
                  context="record"
                  access={origin.access}
                  via={origin.via}
                  note={origin.note}
                />
              )}
              {classWord && <span className="dt-subtle">{classWord}</span>}
              {origin.access === "read" && (
                <>
                  <span className="dt-subtle" aria-hidden="true">
                    ·
                  </span>
                  <span className="dt-record-readonly" data-read-only>
                    read-only{origin.note ? ` — ${origin.note}` : ""}
                  </span>
                </>
              )}
              {origin.stub && (
                <>
                  <span className="dt-subtle" aria-hidden="true">
                    ·
                  </span>
                  <StubNote
                    stubs={origin.stub.stubs}
                    self={origin.stub.self}
                    winner={origin.stub.winner}
                    sources={origin.stubSources}
                  />
                </>
              )}
              {origin.state.map(part => (
                <span key={part} className={`dt-record-state is-${part.split(" ")[0]}`}>
                  <span className="dt-subtle" aria-hidden="true">
                    ·{" "}
                  </span>
                  {part}
                </span>
              ))}
            </span>
          )}
        </div>
      )}
    </header>
  )
}

/** The collection's `display.record` line under the header: subtitle, badge chips, `color_by` tint. */
export function RecordDisplayLine({
  row,
  fields,
  record,
  subtitle,
}: {
  row: CollectionRow | undefined
  fields: readonly FieldRow[]
  record: Record<string, unknown> | null
  /** The `subtitle` template, already rendered (references resolved by the page). */
  subtitle: string
}) {
  const chips = badgeChips(row, fields, record)
  const tint = tintStyle(tintOf(row?.record.color_by, fields, record))
  if (!subtitle && !chips.length && !tint) return null
  return (
    <div className={`dt-record-display${tint ? " is-tinted" : ""}`} style={tint} data-record-display>
      {subtitle && (
        <span className="dt-record-subtitle" title={subtitle}>
          {subtitle}
        </span>
      )}
      {chips.map(chip => (
        <span
          key={chip.value}
          className={`dt-record-badge${chip.color ? " has-color" : ""}${chip.background ? " has-bg" : ""}`}
          style={
            chip.color || chip.background
              ? ({
                  ...(chip.color ? { "--dt-chip-color": themeColor(chip.color) } : {}),
                  ...(chip.background ? { "--dt-chip-bg": themeColor(chip.background) } : {}),
                } as CSSProperties)
              : undefined
          }
        >
          {chip.icon && <Icon name={chip.icon} />}
          {chip.label}
        </span>
      ))}
    </div>
  )
}
