/**
 * `image` — a picture field drawn as a thumbnail that opens the full picture. The value is a FILE-CODEC
 * reference (`lib/file-record.ts`: its bytes are served under the host's file base, the extension read from the
 * record), or a URL. Anything else — a value no `<img>` can load — reads as its text, never a broken icon.
 * Opt-in only: an image id is a string like any other. Square pictures get a circle in a comfortable table
 * (`lib/row-size.ts#isSquarish`), decided by the picture's own size once loaded. The source comes from
 * `useImageSrc` (components/FileThumb.tsx), the resolver a card's cover shares.
 */
import { useState } from "react"
import { useImageSrc } from "../components/FileThumb.tsx"
import { isSquarish } from "../lib/row-size.ts"
import type { ViewProps } from "../registry/props.ts"
import { Empty } from "./empty.tsx"

export function ViewImage({ value, context }: ViewProps) {
  const raw = typeof value === "string" ? value.trim() : ""
  const src = useImageSrc(raw)
  const [square, setSquare] = useState(false)

  if (!raw) return <Empty />
  if (!src) return <span className="dt-subtle">{raw}</span>
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="dt-image-link"
      onClick={e => e.stopPropagation()}
    >
      <img
        src={src}
        alt=""
        className={`dt-image${context === "record" ? " is-record" : ""}${square ? " is-square" : ""}`}
        onLoad={e => setSquare(isSquarish(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight))}
      />
    </a>
  )
}
