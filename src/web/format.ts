export function bytes(n: number, digits = 1): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / 1024 ** i
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(digits)} ${u[i]}`
}

export const rate = (n: number) => (n < 1 ? '0 B/s' : `${bytes(n)}/s`)

export function pct(n: number): string {
  if (n < 0.05) return '0'
  return n >= 10 ? n.toFixed(0) : n.toFixed(1)
}

export function duration(sec: number): string {
  if (sec < 1) return '<1s'
  if (sec < 60) return `${Math.round(sec)}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`
  return `${Math.floor(sec / 86400)}d ${Math.round((sec % 86400) / 3600)}h`
}

export const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
export const clockSec = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
export const dayClock = (ts: number) => new Date(ts).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
