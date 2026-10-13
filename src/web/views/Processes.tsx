import { useMemo, useState } from 'react'
import { Bar } from '../charts'
import { bytes, pct, rate } from '../format'
import { KindBadge, KindFilter, Th, useSort } from '../table'
import { KillButtons } from './Detail'
import type { Kind, Snapshot } from '../../shared/types'

type Key = 'pid' | 'name' | 'cpu' | 'mem' | 'power' | 'threads' | 'net' | 'group' | 'user'

export function ProcessesView({ snap }: { snap: Snapshot }) {
  const { sort, toggle, apply } = useSort<Key>('cpu')
  const [kinds, setKinds] = useState<Set<Kind>>(new Set(['app', 'thirdparty', 'cli', 'system']))
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const filtered = snap.procs.filter(p => kinds.has(p.kind) && (!needle || String(p.pid) === needle || p.args.toLowerCase().includes(needle) || p.group.toLowerCase().includes(needle)))
    return apply(filtered, (p, k) => (k === 'net' ? p.netIn + p.netOut : p[k]))
  }, [snap, kinds, q, apply])

  const shown = rows.slice(0, 300)
  const maxCpu = Math.max(...shown.map(p => p.cpu), 1)
  const maxMem = Math.max(...shown.map(p => p.mem), 1)

  return (
    <section>
      <div className="toolbar">
        <input type="search" placeholder="Filter by name, path, args or PID…" value={q} onChange={e => setQ(e.target.value)} aria-label="Filter processes" />
        <KindFilter value={kinds} onChange={setKinds} />
        <span className="muted small">{rows.length} of {snap.procs.length} processes{rows.length > shown.length ? `, showing top ${shown.length}` : ''}</span>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <Th k="pid" sort={sort} toggle={toggle} num>PID</Th>
              <Th k="name" sort={sort} toggle={toggle}>Process</Th>
              <Th k="cpu" sort={sort} toggle={toggle} num>CPU %</Th>
              <Th k="mem" sort={sort} toggle={toggle} num>Memory</Th>
              <Th k="power" sort={sort} toggle={toggle} num>Energy</Th>
              <Th k="threads" sort={sort} toggle={toggle} num>Threads</Th>
              <Th k="net" sort={sort} toggle={toggle} num>Network</Th>
              <Th k="group" sort={sort} toggle={toggle}>Belongs to</Th>
              <Th k="user" sort={sort} toggle={toggle}>User</Th>
              {snap.allowKill && <th />}
            </tr>
          </thead>
          <tbody>
            {shown.map(p => (
              <tr key={p.pid}>
                <td className="num mono muted">{p.pid}</td>
                <td className="wide">
                  <div className="name-cell"><span className="ellipsis" title={p.args}>{p.name}</span><KindBadge kind={p.kind} /></div>
                  <div className="ellipsis muted small mono" title={p.args}>{p.args}</div>
                </td>
                <td className="num"><span className="mono">{pct(p.cpu)}</span><Bar value={p.cpu} max={maxCpu} /></td>
                <td className="num"><span className="mono">{bytes(p.mem)}</span><Bar value={p.mem} max={maxMem} color="var(--series-2)" /></td>
                <td className="num mono">{pct(p.power)}</td>
                <td className="num mono muted">{p.threads}</td>
                <td className="num mono">{p.netIn + p.netOut > 0 ? rate(p.netIn + p.netOut) : '-'}</td>
                <td className="ellipsis" style={{ maxWidth: 180 }}>{p.group}</td>
                <td className="muted">{p.user}</td>
                {snap.allowKill && <td className="num"><KillButtons target={{ pid: p.pid }} compact /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
