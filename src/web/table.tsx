import { useState } from 'react'
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
