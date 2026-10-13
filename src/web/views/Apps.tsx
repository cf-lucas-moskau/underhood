import { Fragment, useMemo, useState } from 'react'
import { Bar } from '../charts'
import { bytes, pct, rate } from '../format'
import { KindBadge, KindFilter, Th, useSort } from '../table'
import { GroupDetail } from './Detail'
import type { Kind, Snapshot } from '../../shared/types'

type Key = 'name' | 'cpu' | 'mem' | 'power' | 'net' | 'procs'

export function AppsView({ snap }: { snap: Snapshot }) {
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
    const filtered = snap.groups.filter(g => kinds.has(g.kind) && (!needle || g.name.toLowerCase().includes(needle)))
    return apply(filtered, (g, k) => (k === 'name' ? g.name : k === 'net' ? g.netIn + g.netOut : k === 'procs' ? g.pids.length : g[k]))
  }, [snap, kinds, q, apply])

  const shown = rows.slice(0, 200)
  const maxCpu = Math.max(...shown.map(g => g.cpu), 1)
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
              <Th k="cpu" sort={sort} toggle={toggle} num>CPU %</Th>
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
                      <span className="ellipsis">{g.name}</span>
                      <KindBadge kind={g.kind} />
                    </div>
                  </td>
                  <td className="num"><span className="mono">{pct(g.cpu)}</span><Bar value={g.cpu} max={maxCpu} /></td>
                  <td className="num"><span className="mono">{bytes(g.mem)}</span><Bar value={g.mem} max={maxMem} color="var(--series-2)" /></td>
                  <td className="num mono">{pct(g.power)}</td>
                  <td className="num mono">{g.netIn + g.netOut > 0 ? rate(g.netIn + g.netOut) : '-'}</td>
                  <td className="num mono muted">{g.pids.length}</td>
                </tr>
                {open === g.name && (
                  <tr className="detail-row">
                    <td colSpan={6}><GroupDetail name={g.name} procs={procsByGroup.get(g.name)} allowKill={snap.allowKill} /></td>
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
