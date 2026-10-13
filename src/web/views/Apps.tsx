import { Fragment, useMemo, useState } from 'react'
import { Bar } from '../charts'
import { bytes, pct, rate } from '../format'
import { CpuCell, KindBadge, KindFilter, PeakCell, Th, useSort, useStableOrder } from '../table'
import { GroupDetail } from './Detail'
import type { Smooth } from '../App'
import type { Kind, Snapshot } from '../../shared/types'

type Key = 'name' | 'cpu' | 'peak' | 'mem' | 'power' | 'net' | 'procs'

export function AppsView({ snap, smooth }: { snap: Snapshot; smooth: Smooth }) {
  const { sort, toggle, apply } = useSort<Key>('cpu')
  const [kinds, setKinds] = useState<Set<Kind>>(new Set(['app', 'thirdparty', 'cli', 'system']))
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const procsByGroup = useMemo(() => {
    const m = new Map<string, Snapshot['procs']>()
    for (const p of snap.procs) m.set(p.group, [...(m.get(p.group) ?? []), p])
    return m
  }, [snap])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const live = new Set(snap.groups.map(g => g.name))
    // Groups that burned CPU in the last minute but have no process left: short-lived spikes.
    const exited = [...smooth.groupTrend]
      .filter(([name, t]) => !live.has(name) && t.peak >= 1)
      .map(([name]) => ({ name, kind: smooth.seen.groups.get(name)?.kind ?? ('cli' as Kind), cpu: 0, mem: 0, power: 0, netIn: 0, netOut: 0, pids: [] as number[], exited: true }))
    return [...snap.groups.map(g => ({ ...g, exited: false })), ...exited]
      .filter(g => kinds.has(g.kind) && (!needle || g.name.toLowerCase().includes(needle)))
      .map(g => {
        const a = smooth.groups.get(g.name)
        const warm = smooth.groups.size > 0
        return { ...g, cpu: a?.avg ?? (warm ? 0 : g.cpu), power: a?.power ?? (warm ? 0 : g.power), net: a?.net ?? (warm ? 0 : g.netIn + g.netOut), peak: smooth.groupTrend.get(g.name)?.peak ?? 0 }
      })
  }, [snap, kinds, q, smooth])

  const sorted = apply(rows, (g, k) => (k === 'name' ? g.name : k === 'procs' ? g.pids.length : g[k]))
  const ordered = useStableOrder(sorted, g => g.name, `${sort.key}:${sort.dir}:${q}:${[...kinds].join()}:${smooth.ms}`)
  const shown = ordered.slice(0, 200)
  const maxMem = Math.max(...shown.map(g => g.mem), 1)

  return (
    <section>
      <div className="toolbar">
        <input type="search" placeholder="Filter apps…" value={q} onChange={e => setQ(e.target.value)} aria-label="Filter apps" />
        <KindFilter value={kinds} onChange={setKinds} />
        <span className="muted small">{rows.length} groups · helpers and child processes roll up into the app that started them</span>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <Th k="name" sort={sort} toggle={toggle}>Name</Th>
              <Th k="cpu" sort={sort} toggle={toggle} num>CPU % <span className="muted">({smooth.label})</span></Th>
              <Th k="peak" sort={sort} toggle={toggle} num>Peak 1m</Th>
              <Th k="mem" sort={sort} toggle={toggle} num>Memory</Th>
              <Th k="power" sort={sort} toggle={toggle} num>Energy</Th>
              <Th k="net" sort={sort} toggle={toggle} num>Network</Th>
              <Th k="procs" sort={sort} toggle={toggle} num>Procs</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map(g => (
              <Fragment key={g.name}>
                <tr className={`row ${open === g.name ? 'open' : ''}`} onClick={() => setOpen(open === g.name ? null : g.name)} aria-expanded={open === g.name}>
                  <td>
                    <div className="name-cell">
                      <span className="chev" aria-hidden>{open === g.name ? '▾' : '▸'}</span>
                      <span className={`ellipsis ${g.exited ? 'muted' : ''}`}>{g.name}</span>
                      <KindBadge kind={g.kind} />
                      {g.exited && <span className="badge exited" title="All its processes have exited. It stays listed for a minute so short spikes don't vanish.">exited</span>}
                    </div>
                  </td>
                  <td className="num"><CpuCell avg={g.cpu} trend={smooth.groupTrend.get(g.name)} /></td>
                  <td className="num"><PeakCell trend={smooth.groupTrend.get(g.name)} /></td>
                  <td className="num">{g.exited ? <span className="mono muted">-</span> : <><span className="mono">{bytes(g.mem)}</span><Bar value={g.mem} max={maxMem} color="var(--series-2)" /></>}</td>
                  <td className="num mono">{pct(g.power)}</td>
                  <td className="num mono">{g.net >= 1 ? rate(g.net) : '-'}</td>
                  <td className="num mono muted">{g.pids.length}</td>
                </tr>
                {open === g.name && (
                  <tr className="detail-row">
                    <td colSpan={7}><GroupDetail name={g.name} procs={procsByGroup.get(g.name)} allowKill={snap.allowKill} /></td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
