export function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g
  const pa = a.match(re) ?? [],
    pb = b.match(re) ?? []
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const x = pa[i],
      y = pb[i]
    const nx = /^\d/.test(x),
      ny = /^\d/.test(y)
    if (nx && ny) {
      const d = Number(x) - Number(y)
      if (d) return d
    } else {
      const d = x.localeCompare(y)
      if (d) return d
    }
  }
  return pa.length - pb.length
}
