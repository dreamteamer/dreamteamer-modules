/**
 * `image` — a picture field drawn as a thumbnail that opens the full picture. The value is a FILE-CODEC
 * reference (`lib/fileRecord.ts`: its bytes are served under the host's file base, the extension read from the
 * record), or a URL. Anything else — a value no `<img>` can load — reads as its text, never a broken icon.
 * Opt-in only: an image id is a string like any other. Square pictures get a circle in a comfortable table
 * (`lib/rowSize.ts#isSquarish`), decided by the picture's own size once loaded. The source comes from
 * `useImageSrc` (components/FileThumb.tsx), the resolver a card's cover shares.
 */
import { useState } from "react"
import { useImageSrc } from "../components/FileThumb.tsx"
import { isSquarish } from "../lib/rowSize.ts"
import type { ViewProps } from "../registry/props.ts"
import { Empty } from "./Empty.tsx"
import { cx, subtle } from "../styles/classes.ts"

export function ViewImage({ value, context }: ViewProps) {
  const raw = typeof value === "string" ? value.trim() : ""
  const src = useImageSrc(raw)
  const [square, setSquare] = useState(false)

  if (!raw) return <Empty />
  if (!src) return <span className={subtle}>{raw}</span>
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block leading-[0]"
      onClick={e => e.stopPropagation()}
    >
      <img
        src={src}
        alt=""
        className={cx(
          "object-cover border border-border",
          context === "record" ? "w-auto h-auto max-w-[240px] max-h-[180px]" : "w-8 h-8",
          square ? "rounded-full" : "rounded"
        )}
        data-image
        onLoad={e => setSquare(isSquarish(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight))}
      />
    </a>
  )
}
