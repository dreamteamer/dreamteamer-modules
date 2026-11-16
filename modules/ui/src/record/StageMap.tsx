/**
 * THE STAGE MAP on a record page (ported from the Vue ui's components/StageMap.vue) — the lifecycle a collection
 * declares under `display.record.options.stages`, drawn above the properties on the READ as two lines at most
 * (cr-vscode-015): one row of numbered stages, each checked when its gate passed, the current one marked, the rest
 * muted; under it one short subtitle naming the current stage's next command, which copies its invocation on one
 * click (never runs it). Each stage's fields, reviews and gate open in a card on hover or keyboard focus.
 *
 * What it knows comes from two reads: the engine's commands for this record (`GET /commands/:c?ids=` — the gate
 * states, the same call the Commands panel makes) and the reviews whose owning field names this record (the
 * `stage_reviews` mirror's `mirror_of`). Every reading — stage state, current stage, marks, where the card goes and
 * which card is open (a reducer over enter/leave/focus/blur/escape with a 200 ms grace) — is lib/stage-map.ts.
 * Draws nothing for a collection that declares no stages.
 */
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react"
import { getCommands, listRecords } from "../api/client.ts"
import type { FieldRow } from "../api/types.ts"
import { useApp, useRouteBase } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { Link } from "../components/Link.tsx"
import type { CommandRow } from "../lib/command-rows.ts"
import { labelOf } from "../lib/format-title.ts"
import { recordRoute } from "../lib/route.ts"
import {
  bareRef,
  CARD_CLOSED,
  cardLeft,
  cardState,
  currentStage,
  gateEntries,
  isEmptyValue,
  STAGE_STATE_LABEL,
  stageMark,
  stageReviews,
  stageReviewsField,
  stageSpecs,
  stageState,
  type CardEvent,
  type CardState,
} from "../lib/stage-map.ts"
import { RenderView } from "../render/Render.tsx"
import { cx } from "../styles/classes.ts"
import {
  stageCardCls,
  stageCardTitleCls,
  stageChipCls,
  stageCls,
  stageIconCls,
  stagesCls,
  stagesCmdCls,
  stagesListCls,
  stagesNextCls,
  stageTitleCls,
} from "./stage-map-looks.ts"

/** A card's term and its value. */
const keyCls = "mt-1 text-small text-fg-subtle"
const valueCls = "m-0 min-w-0 [overflow-wrap:anywhere]"

const MARK_ICON = {
  passed: "pass-filled",
  current: "circle-large-filled",
  skipped: "circle-slash",
  ahead: "circle-large-outline",
} as const

const commandName = (name: string) => `/${name.replace("/", ":")}`

export function StageMap({
  collection,
  record,
  fields,
  options,
}: {
  collection: string
  record: Record<string, unknown> | null
  fields: FieldRow[]
  /** The record display's options — where `stages` and `stage_reviews` are declared. */
  options: Record<string, unknown>
}) {
  const { schema, version } = useApp()
  const base = useRouteBase()
  const specs = stageSpecs(options) ?? []
  const id = String(record?.["id"] ?? "")
  const self = `${collection}/${id}`
  const reviewsField = stageReviewsField(options)
  const reviewsRow = reviewsField ? fields.find(f => f.field === reviewsField) : undefined
  const reviewsTarget = reviewsRow ? (schema.target(reviewsRow)?.collection ?? "") : ""

  const [commands, setCommands] = useState<CommandRow[]>([])
  // no mark is claimed before the gate answer, nor after a refused one
  const [gates, setGates] = useState<"loading" | "loaded" | "failed">("loading")
  const [reviews, setReviews] = useState<Record<string, unknown>[]>([])
  const hasStages = specs.length > 0

  useEffect(() => {
    if (!hasStages || !id) return
    let live = true
    setGates("loading")
    getCommands(collection, [id]).then(
      answer => {
        if (!live) return
        setCommands(answer.commands ?? [])
        setGates("loaded")
      },
      () => {
        if (!live) return
        setCommands([])
        setGates("failed")
      }
    )
    if (reviewsRow?.mirror_of && reviewsTarget) {
      listRecords(reviewsTarget, { limit: 100000, filter: { [reviewsRow.mirror_of]: { _eq: self } } }).then(
        page => live && setReviews(page.records),
        () => live && setReviews([])
      )
    } else setReviews([])
    return () => {
      live = false
    }
  }, [hasStages, id, collection, self, reviewsRow?.mirror_of, reviewsTarget, version])

  const gateLists = specs.map(spec => gateEntries(spec, commands, id))
  const loaded = gates === "loaded"
  const currentIndex = loaded ? currentStage(gateLists) : -1
  const stages = specs.map((spec, i) => {
    const gate = gateLists[i]!
    const state = stageState(gate)
    return {
      i,
      spec,
      state,
      mark: loaded ? stageMark(i, currentIndex, state) : ("ahead" as const),
      gate,
      reviews: stageReviews(spec, reviews, record ?? {}, self),
    }
  })
  const current = stages.find(s => s.mark === "current") ?? null

  // ── line 2 ──
  let next:
    { kind: "loading" } | { kind: "text"; text: string } | { kind: "command"; name: string; invocation: string | null }
  if (gates === "loading") next = { kind: "loading" }
  else if (gates === "failed") next = { kind: "text", text: "stages unavailable" }
  else if (current) {
    const entry = current.gate.find(g => g.state === "available")
    const row = entry ? commands.find(r => r.binding.replace(/^command-bindings\//, "") === entry.binding) : undefined
    next = entry
      ? { kind: "command", name: commandName(entry.name), invocation: row?.invocation ?? null }
      : { kind: "text", text: "no command available" }
  } else if (stages.length && stages[stages.length - 1]!.mark === "passed") {
    const skipped = stages.filter(s => s.mark === "skipped").length
    next = { kind: "text", text: skipped ? `done · ${skipped} skipped` : "all stages passed" }
  } else next = { kind: "text", text: "no command available" }

  // ── the card: which stage's is open (the reducer), and where it goes ──
  const [card, setCard] = useState<CardState>(CARD_CLOSED)
  const [cardX, setCardX] = useState(0)
  const section = useRef<HTMLElement | null>(null)
  const chips = useRef<Array<HTMLButtonElement | null>>([])
  const cardEls = useRef<Array<HTMLDivElement | null>>([])
  const grace = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cardNow = useRef(card)
  cardNow.current = card
  useEffect(() => () => clearTimeout(grace.current), [])

  const cardHasFocus = () => {
    const open = cardNow.current.open
    const el = open === null ? null : cardEls.current[open]
    return !!(el && document.activeElement && el.contains(document.activeElement))
  }
  const send = (e: CardEvent) => {
    const before = cardNow.current.open
    const after = cardState(cardNow.current, e)
    cardNow.current = after
    setCard(after)
    if (after.open !== null && after.open !== before) setCardX(0)
  }
  // place an opened card under its chip, clamped inside the map, once it has drawn and can be measured
  useEffect(() => {
    if (card.open === null) return
    const chip = chips.current[card.open]
    const el = cardEls.current[card.open]
    const map = section.current?.getBoundingClientRect()
    if (!chip || !el || !map) return
    setCardX(cardLeft(chip.getBoundingClientRect().left - map.left, el.getBoundingClientRect().width, map.width))
  }, [card.open])

  const onEnter = (i: number) => {
    clearTimeout(grace.current)
    send({ type: "enter", i, cardHasFocus: cardHasFocus() })
  }
  const onLeave = (i: number) => {
    send({ type: "leave", i })
    clearTimeout(grace.current)
    grace.current = setTimeout(() => send({ type: "grace", cardHasFocus: cardHasFocus() }), 200)
  }
  const onFocus = (i: number, e: FocusEvent<HTMLLIElement>) => {
    const target = e.target as Element
    const el = cardEls.current[i]
    send({ type: "focus", i, keyboard: target.matches(":focus-visible"), inCard: !!el?.contains(target) })
  }
  const onBlur = (i: number, e: FocusEvent<HTMLLIElement>) => {
    const to = e.relatedTarget as Node | null
    if (to && e.currentTarget.contains(to)) return
    send({ type: "blur", i })
  }
  const onKey = (i: number, e: KeyboardEvent) => {
    if (e.key !== "Escape") return
    send({ type: "escape", i })
    chips.current[i]?.focus()
  }

  // ── line 2's one click: the invocation on the clipboard ──
  const [copied, setCopied] = useState(false)
  const copy = async (invocation: string) => {
    try {
      await navigator.clipboard.writeText(invocation)
    } catch {
      // a webview may withhold the clipboard — the classic fallback
      const area = document.createElement("textarea")
      area.value = invocation
      document.body.appendChild(area)
      area.select()
      document.execCommand("copy")
      area.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!stages.length) return null
  const stateWord = (s: (typeof stages)[number]) => (s.mark === "skipped" ? "skipped" : STAGE_STATE_LABEL[s.state])
  const cardId = (i: number) => `dt-stage-card-${id}-${i}`

  return (
    <section ref={section} className={stagesCls} aria-label="Lifecycle">
      <ol className={stagesListCls}>
        {stages.map(stage => (
          <li
            key={stage.spec.title}
            className={stageCls}
            data-stage={stage.spec.title}
            data-state={stage.state}
            data-mark={stage.mark}
            data-current={stage.mark === "current" ? "true" : undefined}
            onMouseEnter={() => onEnter(stage.i)}
            onMouseLeave={() => onLeave(stage.i)}
            onFocus={e => onFocus(stage.i, e)}
            onBlur={e => onBlur(stage.i, e)}
            onKeyDown={e => onKey(stage.i, e)}
          >
            <button
              ref={el => {
                chips.current[stage.i] = el
              }}
              type="button"
              className={stageChipCls(stage.mark)}
              aria-current={stage.mark === "current" ? "step" : undefined}
              aria-expanded={card.open === stage.i}
              aria-controls={cardId(stage.i)}
              aria-label={`${stage.i + 1} ${stage.spec.title} — ${stateWord(stage)}`}
            >
              <Icon name={MARK_ICON[stage.mark]} className={stageIconCls(stage.mark)} />
              <span className="tabular-nums">{stage.i + 1}</span>{" "}
              <span className={stageTitleCls(stage.mark === "current")}>{stage.spec.title}</span>
            </button>
            {card.open === stage.i && (
              <div
                id={cardId(stage.i)}
                ref={el => {
                  cardEls.current[stage.i] = el
                }}
                className={stageCardCls}
                role="group"
                aria-label={stage.spec.title}
                style={{ left: cardX }}
              >
                <header className="flex items-baseline gap-1 mb-1">
                  <span className={stageCardTitleCls}>{stage.spec.title}</span>
                  <span className="text-fg-subtle text-small">· {stateWord(stage)}</span>
                </header>
                <dl className="m-0">
                  {stage.spec.fields.map(name => {
                    const row = fields.find(f => f.field === name)
                    const value = record?.[name]
                    return (
                      <div key={name}>
                        <dt className={keyCls}>{row ? labelOf(row) : name}</dt>
                        <dd className={valueCls} data-field={name}>
                          {isEmptyValue(value) || !row ? (
                            <span className="text-fg-subtle">Empty</span>
                          ) : (
                            <RenderView field={row} value={value} context="record" {...(record ? { record } : {})} />
                          )}
                        </dd>
                      </div>
                    )
                  })}
                  <div>
                    <dt className={keyCls}>Reviews</dt>
                    <dd className={valueCls} data-field="$reviews">
                      {!stage.reviews.length ? (
                        <span className="text-fg-subtle">No review yet</span>
                      ) : (
                        stage.reviews.map(r => (
                          <span key={String(r["id"])} className="block" data-verdict={String(r["verdict"] ?? "")}>
                            <Link to={recordRoute(reviewsTarget, bareRef(r["id"]), base)}>
                              {String(r["name"] ?? r["id"] ?? "")}
                            </Link>
                            <span className="text-fg-subtle text-small ml-1.5">
                              {r["verdict"] ? String(r["verdict"]) : "no verdict"}
                            </span>
                          </span>
                        ))
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className={keyCls}>Gate</dt>
                    <dd className={valueCls} data-field="$gate">
                      {stage.gate.map(g => (
                        <span
                          key={g.binding}
                          className={cx("block text-small", g.state === "available" ? "text-accent" : "text-fg-subtle")}
                          data-binding={g.binding}
                          data-state={g.state}
                          title={g.binding}
                        >
                          {commandName(g.name)} · {g.state === "not-applicable" ? "not yet" : g.state}
                        </span>
                      ))}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </li>
        ))}
      </ol>
      <p className={stagesNextCls}>
        {next.kind === "loading" ? (
          " "
        ) : next.kind === "text" ? (
          next.text
        ) : (
          <>
            {next.invocation ? (
              <button
                type="button"
                className={stagesCmdCls}
                title={next.invocation}
                onClick={() => void copy(next.invocation!)}
              >
                {copied ? "Copied" : next.name}
              </button>
            ) : (
              <span>{next.name}</span>
            )}{" "}
            available
          </>
        )}
      </p>
    </section>
  )
}
