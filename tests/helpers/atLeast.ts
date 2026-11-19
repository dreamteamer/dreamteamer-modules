// A test written at one release names the version it proved; a later release keeps what it proved, so the check
// is "this version or later", never the exact number the bump will change.
export function atLeast(version: string, minimum: string): boolean {
  const a = version.split("-")[0].split(".").map(Number)
  const b = minimum.split(".").map(Number)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return true
}
