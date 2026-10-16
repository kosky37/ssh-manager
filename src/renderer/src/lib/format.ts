export function formatBytes(n: number, digits = 1): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let value = n
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${i === 0 ? value : value.toFixed(digits)} ${units[i]}`
}

export function percent(part: number, total: number): number {
  if (!total) return 0
  return Math.max(0, Math.min(100, (part / total) * 100))
}

export function errorMessage(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function relativeTime(iso: string): string {
  if (!iso || iso.startsWith('0001')) return '—'
  const d = new Date(iso)
  const t = d.getTime()
  if (Number.isNaN(t)) return iso
  const diff = (Date.now() - t) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`
  return d.toLocaleDateString()
}

export function levelClass(pct: number): string {
  if (pct >= 90) return 'level-high'
  if (pct >= 70) return 'level-mid'
  return 'level-low'
}
