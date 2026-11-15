/**
 * `tags` — a chip list for a `many` field of scalars, reached by that SHAPE (resolve.ts). Enter or a comma
 * commits the draft (a trailing comma stripped, a duplicate ignored); Backspace on an empty draft drops the last
 * chip; leaving the field commits what was typed. Removing the last chip clears the field to null.
 */
import { useState, type KeyboardEvent } from "react"
import { Icon } from "../components/Icon.tsx"
import { addTag, listOrNull, tagsOf } from "../lib/edit-values.ts"
import type { EditProps } from "../registry/props.ts"

export function EditTags({ value, onChange, id }: EditProps) {
  const tags = tagsOf(value)
  const [draft, setDraft] = useState("")

  const commit = () => {
    const next = addTag(tags, draft)
    setDraft("")
    if (next) onChange(next)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      commit()
    } else if (e.key === "Backspace" && draft === "" && tags.length) {
      onChange(listOrNull(tags.slice(0, -1)))
    }
  }

  return (
    <div className="ui2-tags-edit">
      {tags.map((tag, i) => (
        <span key={`${tag}-${i}`} className="ui2-chip">
          {tag}
          <button
            type="button"
            className="ui2-chip-remove"
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(listOrNull(tags.filter((_, j) => j !== i)))}
          >
            <Icon name="close" />
          </button>
        </span>
      ))}
      <input
        id={id}
        dir="auto"
        type="text"
        value={draft}
        placeholder="Add tag…"
        onChange={e => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
      />
    </div>
  )
}
