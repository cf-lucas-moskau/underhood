import { useRef, useState } from 'react'
import type { Kind } from '../shared/types'

export type Dir = 'asc' | 'desc'

export function useSort<K extends string>(initial: K, dir: Dir = 'desc') {
  const [sort, setSort] = useState<{ key: K; dir: Dir }>({ key: initial, dir })
  const toggle = (key: K) => setSort(s => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === ('name' as K) ? 'asc' : 'desc' }))
  const apply = <T,>(rows: T[], get: (r: T, k: K) => number | string) =>
    [...rows].sort((a, b) => {
      const x = get(a, sort.key)
      const y = get(b, sort.key)
      const c = typeof x === 'string' ? x.localeCompare(String(y)) : (x as number) - (y as number)
      return sort.dir === 'asc' ? c : -c
    })
  return { sort, toggle, apply }
}

export function Th<K extends string>({ k, sort, toggle, children, num }: { k: K; sort: { key: K; dir: Dir }; toggle: (k: K) => void; children: React.ReactNode; num?: boolean }) {
  const active = sort.key === k
  return (
    <th className={num ? 'num' : ''} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => toggle(k)}>
        {children}
        <span className="caret" aria-hidden>{active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  )
}

export const KIND_LABEL: Record<Kind, string> = { app: 'App', thirdparty: '3rd party', cli: 'CLI', system: 'Apple' }

export function KindBadge({ kind }: { kind: Kind }) {
  return <span className={`badge kind-${kind}`}>{KIND_LABEL[kind]}</span>
}

export function KindFilter({ value, onChange }: { value: Set<Kind>; onChange: (v: Set<Kind>) => void }) {
  const all: Kind[] = ['app', 'thirdparty', 'cli', 'system']
  return (
    <div className="chips" role="group" aria-label="Filter by kind">
      {all.map(k => (
        <button
          key={k}
          className={`chip ${value.has(k) ? 'on' : ''}`}
          aria-pressed={value.has(k)}
          onClick={() => {
            const next = new Set(value)
            if (next.has(k)) next.delete(k)
            else next.add(k)
            onChange(next.size ? next : new Set(all))
          }}
        >
          {KIND_LABEL[k]}
        </button>
      ))}
    </div>
  )
}

/**
 * Re-sort at most every `everyMs` so rows don't swap places on every sample.
 * Changing `resetKey` (sort column, filter) re-sorts immediately. Rows that
 * appear in between are appended until the next re-sort.
 */
export function useStableOrder<T>(sorted: T[], key: (r: T) => string, resetKey: string, everyMs = 6000): T[] {
  const state = useRef<{ order: string[]; at: number; reset: string }>({ order: [], at: 0, reset: '' })
  const now = Date.now()
  const st = state.current
  if (st.reset !== resetKey || now - st.at >= everyMs) {
    state.current = { order: sorted.map(key), at: now, reset: resetKey }
    return sorted
  }
  const byKey = new Map(sorted.map(r => [key(r), r]))
  const out: T[] = []
  for (const k of st.order) {
    const r = byKey.get(k)
    if (r) {
      out.push(r)
      byKey.delete(k)
    }
  }
  for (const r of byKey.values()) out.push(r)
  return out
}

const IDLE = { avg: 0, peak: 0, now: 0, power: 0, net: 0, spark: [] as number[], spiking: false }

/** Smoothed CPU number plus a one-minute sparkline that keeps short spikes visible. */
export function CpuCell({ avg, trend }: { avg: number; trend?: typeof IDLE }) {
  const t = trend ?? IDLE
  return (
    <span className="cpu-cell">
      <MiniSpark values={t.spark} max={Math.max(t.peak, 50)} spike={t.spiking} />
      <span className="mono">{fmtPct(avg)}</span>
    </span>
  )
}

export function PeakCell({ trend }: { trend?: typeof IDLE }) {
  const t = trend ?? IDLE
  if (t.peak < 0.05) return <span className="mono muted">-</span>
  return (
    <span className={`mono ${t.spiking ? 'spike' : 'muted'}`} title={t.spiking ? 'Short burst well above the average in the last minute' : undefined}>
      {t.spiking && <span aria-hidden>▲ </span>}
      {fmtPct(t.peak)}
    </span>
  )
}

function MiniSpark({ values, max, spike }: { values: number[]; max: number; spike: boolean }) {
  const n = values.length
  const w = 64
  const h = 16
  if (n < 2) return <svg className="mini-spark" width={w} height={h} aria-hidden />
  const pts = values.map((v, i) => `${((i / (n - 1)) * w).toFixed(1)},${(h - 1 - (Math.min(v, max) / max) * (h - 2)).toFixed(1)}`).join(' ')
  return (
    <svg className={`mini-spark ${spike ? 'spike' : ''}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={pts} fill="none" strokeWidth={1.25} strokeLinejoin="round" />
    </svg>
  )
}

const fmtPct = (n: number) => (n < 0.05 ? '0' : n >= 10 ? n.toFixed(0) : n.toFixed(1))
