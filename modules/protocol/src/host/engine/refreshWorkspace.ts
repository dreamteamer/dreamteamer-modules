import { declaredVarsOf, loaded, loadedApi } from "../engine.ts"

export async function refreshWorkspace(): Promise<void> {
  if (!loaded) return
  const ws = await loadedApi.openWorkspace(loaded.ws.root)
  loaded.ws = ws
  loaded.declaredVars = declaredVarsOf(ws.pkg)
  loaded.namespaces.splice(0, loaded.namespaces.length, ...loadedApi.namespaces(ws.root))
}
