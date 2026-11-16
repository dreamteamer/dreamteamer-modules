/**
 * `markdown-body` — the record's body in CodeMirror 6 with Obsidian-style live preview (ported from
 * the Vue ui's EditMarkdownBody.vue). The text stays source-canonical markdown; the decorations
 * (`lib/editor-preview.ts`) are visual only, revealed under the cursor.
 *
 * Two modes, one document: LIVE PREVIEW (markers hide until the cursor reaches them) and SOURCE (raw markdown).
 * The toggle swaps the preview extension through a Compartment, so switching never remounts the editor or loses
 * its undo history; the choice is remembered per browser. The toolbar (`lib/editor-commands.ts`) edits the
 * source text and works the same in both; Mod-b / Mod-i / Mod-k are bold, italic and link.
 *
 * The incoming value is ECHO-GUARDED (`lib/editor-guard.ts`): every keystroke goes out through `onChange` and
 * comes back as `value`; only a text this editor never emitted itself (a re-read, Revert) resets the document —
 * a stale render's value must never "correct" text typed since.
 */
import { useEffect, useRef, useState } from "react"
import { Compartment, EditorState } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { Icon } from "../components/Icon.tsx"
import { insertLink, setHeading, toggleFence, toggleInline, toggleLinePrefix } from "../lib/editor-commands.ts"
import { pushEmitted, shouldReset } from "../lib/editor-guard.ts"
import { livePreview } from "../lib/editor-preview.ts"
import type { EditProps } from "../registry/props.ts"
import { controlFrame } from "../components/looks.ts"
import { cx } from "../styles/classes.ts"

/** A toolbar button: a quiet icon or label, tinted while its mode is on (and still tinted under the pointer). */
const toolButton = (active: boolean) =>
  cx(
    "inline-flex items-center justify-center min-w-[26px] h-[26px] py-0 px-1 border-0 rounded [font:600_11px/1_var(--dt-font)] cursor-pointer",
    active
      ? "bg-[color-mix(in_srgb,var(--dt-accent)_16%,transparent)] text-accent"
      : "bg-transparent text-fg-subtle hover:bg-bg-hover hover:text-fg"
  )

const SOURCE_MODE_KEY = "ui.mdSource"

function readSourceMode(): boolean {
  try {
    return localStorage.getItem(SOURCE_MODE_KEY) === "1"
  } catch {
    return false
  }
}

const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--dt-fg)", fontSize: "13px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--dt-mono)", lineHeight: "1.6", minHeight: "260px" },
  ".cm-content": { padding: "14px", caretColor: "var(--dt-accent)" },
  ".cm-gutters": { display: "none" },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--dt-accent) 22%, transparent) !important",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--dt-accent)" },
})

type Tool = { label: string; icon?: string; title: string; run: (v: EditorView) => unknown }
const TOOLBAR: (Tool | "gap")[] = [
  { label: "H1", title: "Heading 1", run: v => setHeading(v, 1) },
  { label: "H2", title: "Heading 2", run: v => setHeading(v, 2) },
  { label: "H3", title: "Heading 3", run: v => setHeading(v, 3) },
  "gap",
  { label: "", icon: "bold", title: "Bold (⌘B)", run: v => toggleInline(v, "**") },
  { label: "", icon: "italic", title: "Italic (⌘I)", run: v => toggleInline(v, "*") },
  { label: "", icon: "strikethrough", title: "Strikethrough", run: v => toggleInline(v, "~~") },
  { label: "", icon: "code", title: "Inline code", run: v => toggleInline(v, "`") },
  "gap",
  { label: "", icon: "link", title: "Link (⌘K)", run: v => insertLink(v) },
  "gap",
  { label: "", icon: "list-unordered", title: "Bullet list", run: v => toggleLinePrefix(v, "bullet") },
  { label: "", icon: "list-ordered", title: "Numbered list", run: v => toggleLinePrefix(v, "ordered") },
  { label: "", icon: "checklist", title: "Task list", run: v => toggleLinePrefix(v, "task") },
  { label: "", icon: "quote", title: "Quote", run: v => toggleLinePrefix(v, "quote") },
  { label: "", icon: "json", title: "Code block", run: v => toggleFence(v) },
]

export function EditMarkdownBody({ value, onChange, id }: EditProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const emitted = useRef<string[]>([])
  const preview = useRef(new Compartment())
  // the listener is built once; it must always reach the CURRENT onChange
  const change = useRef(onChange)
  change.current = onChange
  const [sourceMode, setSourceMode] = useState(readSourceMode)

  useEffect(() => {
    const state = EditorState.create({
      doc: value === null || value === undefined ? "" : String(value),
      extensions: [
        history(),
        keymap.of([
          { key: "Mod-b", run: v => toggleInline(v, "**") },
          { key: "Mod-i", run: v => toggleInline(v, "*") },
          { key: "Mod-k", run: v => insertLink(v) },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        // GFM, not bare CommonMark: the Task / Strikethrough / Table nodes the preview keys off need it
        markdown({ base: markdownLanguage }),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ id, "aria-multiline": "true" }),
        theme,
        preview.current.of(sourceMode ? [] : livePreview()),
        EditorView.updateListener.of(update => {
          if (!update.docChanged) return
          const text = update.state.doc.toString()
          // synchronous with the same dispatch, so it never lags a same-tick keystroke
          emitted.current = pushEmitted(emitted.current, text)
          change.current(text === "" ? null : text)
        }),
      ],
    })
    view.current = new EditorView({ state, parent: host.current! })
    return () => {
      view.current?.destroy()
      view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one editor per mount; value and mode arrive below
  }, [])

  useEffect(() => {
    const v = view.current
    if (!v || value === undefined) return
    const incoming = value === null ? "" : String(value)
    const current = v.state.doc.toString()
    if (shouldReset(incoming, current, emitted.current))
      v.dispatch({ changes: { from: 0, to: current.length, insert: incoming } })
  }, [value])

  const toggleMode = () => {
    const on = !sourceMode
    setSourceMode(on)
    try {
      localStorage.setItem(SOURCE_MODE_KEY, on ? "1" : "0")
    } catch {
      // a private window: the mode lasts this page only
    }
    view.current?.dispatch({ effects: preview.current.reconfigure(on ? [] : livePreview()) })
    view.current?.focus()
  }

  return (
    <div className={controlFrame}>
      <div className="flex flex-wrap items-center gap-0.5 py-1 px-1.5 border-b border-border">
        {TOOLBAR.map((tool, i) =>
          tool === "gap" ? (
            <span key={i} className="w-2" />
          ) : (
            // mousedown is prevented so the editor keeps its selection through the click
            <button
              key={i}
              type="button"
              tabIndex={-1}
              className={toolButton(false)}
              title={tool.title}
              aria-label={tool.title}
              onMouseDown={e => e.preventDefault()}
              onClick={() => view.current && tool.run(view.current)}
            >
              {tool.icon ? <Icon name={tool.icon} /> : tool.label}
            </button>
          )
        )}
        <span className="flex-1" />
        <button
          type="button"
          tabIndex={-1}
          className={toolButton(sourceMode)}
          title={sourceMode ? "Switch to live preview" : "Switch to source (raw markdown)"}
          aria-label={sourceMode ? "Switch to live preview" : "Switch to source"}
          onMouseDown={e => e.preventDefault()}
          onClick={toggleMode}
        >
          <Icon name={sourceMode ? "open-preview" : "markdown"} />
        </button>
      </div>
      <div ref={host} />
    </div>
  )
}
