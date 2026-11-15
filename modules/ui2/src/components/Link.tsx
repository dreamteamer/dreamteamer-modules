/**
 * An in-app link: a plain click routes in place; a modified click (cmd/ctrl, middle) is left to the browser,
 * which opens the hash in a new tab under dt web.
 */
import type { MouseEvent, ReactNode } from "react"
import { useApp } from "../app-context.tsx"

export function Link({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  const { navigate } = useApp()
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a href={`#${to}`} onClick={onClick} className={className}>
      {children}
    </a>
  )
}
