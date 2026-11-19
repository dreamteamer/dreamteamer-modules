/**
 * The open page says its title, so its tab (lib/tabs.ts) shows it. `provisional`: a title that is only a placeholder
 * (a record page before its record and its collection's row have arrived names the id) — it never replaces the tab's.
 */
import { useEffect } from "react"
import { useApp } from "../AppContext.tsx"
import { titleTab } from "../lib/tabs.ts"

export function useTabTitle(title: string | undefined, icon?: string, provisional = false): void {
  const { route } = useApp()
  useEffect(() => {
    if (title) titleTab(route, title, icon, provisional)
  }, [route, title, icon, provisional])
}
