/**
 * A render that throws draws its `fallback` and leaves the rest of the page standing — one broken View in
 * one cell never blanks a list. Reset by remounting (a `key`).
 */
import { Component, type ReactNode } from "react"

interface Props {
  name: string
  fallback: ReactNode | ((error: Error) => ReactNode)
  children: ReactNode
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.warn(`dreamteamer: ${this.props.name} failed to render — ${error.message}`)
  }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const f = this.props.fallback
    return typeof f === "function" ? f(error) : f
  }
}
