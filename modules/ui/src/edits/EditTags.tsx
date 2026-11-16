/**
 * `tags` — a chip list for a `many` field of scalars, reached by that SHAPE (resolve.ts). Enter or a comma
 * commits the draft (a trailing comma stripped, a duplicate ignored); Backspace on an empty draft drops the last
 * chip; leaving the field commits what was typed. Removing the last chip clears the field to null.
 */
import { useState, type KeyboardEvent } from "react"
import { Icon } from "../components/Icon.tsx"
import { addTag, listOrNull, tagsOf } from "../lib/edit-values.ts"
import type { EditProps } from "../registry/props.ts"
import { bareInput, controlFrame } from "../components/looks.ts"
import { chip, chipRemove, cx } from "../styles/classes.ts"

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
    <div className={cx(controlFrame, "flex flex-wrap items-center gap-1 min-h-[30px] py-[3px] px-1.5")}>
      {tags.map((tag, i) => (
        <span key={`${tag}-${i}`} className={chip}>
          {tag}
          <button
            type="button"
            className={chipRemove}
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
        className={cx(bareInput, "flex-[1_1_80px] min-w-20 p-0.5")}
        value={draft}
        placeholder="Add tag…"
        onChange={e => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
      />
    </div>
  )
}
