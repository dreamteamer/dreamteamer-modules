/**
 * An in-app link: a plain click routes in place; a modified click (cmd/ctrl, middle) is left to the browser,
 * which opens the hash in a new tab under dt web.
 */
import type { MouseEvent, ReactNode } from "react"
import { useApp } from "../AppContext.tsx"

export function Link({
  to,
  children,
  className,
  title,
  ...data
}: {
  to: string
  children: ReactNode
  className?: string
  title?: string
  /** `data-*` attributes, passed through (a driver or a test finds the link by them). */
  [data: `data-${string}`]: string | undefined
}) {
  const { navigate } = useApp()
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a href={`#${to}`} onClick={onClick} className={className} title={title} {...data}>
      {children}
    </a>
  )
}
