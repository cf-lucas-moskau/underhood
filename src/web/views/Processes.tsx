import { useMemo, useState } from 'react'
import { Bar } from '../charts'
import { bytes, pct, rate } from '../format'
import { CpuCell, KindBadge, KindFilter, PeakCell, Th, useSort, useStableOrder } from '../table'
import { KillButtons } from './Detail'
import type { Smooth } from '../App'
import type { Kind, Snapshot } from '../../shared/types'

type Key = 'pid' | 'name' | 'cpu' | 'peak' | 'mem' | 'power' | 'threads' | 'net' | 'group' | 'user'

export function ProcessesView({ snap, smooth }: { snap: Snapshot; smooth: Smooth }) {
  const { sort, toggle, apply } = useSort<Key>('cpu')
  const [kinds, setKinds] = useState<Set<Kind>>(new Set(['app', 'thirdparty', 'cli', 'system']))
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const warm = smooth.procs.size > 0
    const live = new Set(snap.procs.map(p => String(p.pid)))
    const exited = [...smooth.procTrend]
      .filter(([pid, t]) => !live.has(pid) && t.peak >= 1 && smooth.seen.procs.has(pid))
      .map(([pid]) => ({ ...smooth.seen.procs.get(pid)!.proc, cpu: 0, mem: 0, power: 0, netIn: 0, netOut: 0, threads: 0, exited: true }))
    return [...snap.procs.map(p => ({ ...p, exited: false })), ...exited]
      .filter(p => kinds.has(p.kind) && (!needle || String(p.pid) === needle || p.args.toLowerCase().includes(needle) || p.group.toLowerCase().includes(needle)))
      .map(p => {
        const a = smooth.procs.get(String(p.pid))
        return { ...p, cpu: a?.avg ?? (warm ? 0 : p.cpu), power: a?.power ?? (warm ? 0 : p.power), net: a?.net ?? (warm ? 0 : p.netIn + p.netOut), peak: smooth.procTrend.get(String(p.pid))?.peak ?? 0 }
      })
  }, [snap, kinds, q, smooth])

  const sorted = apply(rows, (p, k) => p[k])
  const ordered = useStableOrder(sorted, p => String(p.pid), `${sort.key}:${sort.dir}:${q}:${[...kinds].join()}:${smooth.ms}`)
  const shown = ordered.slice(0, 300)
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
              <Th k="cpu" sort={sort} toggle={toggle} num>CPU % <span className="muted">({smooth.label})</span></Th>
              <Th k="peak" sort={sort} toggle={toggle} num>Peak 1m</Th>
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
                  <div className="name-cell">
                    <span className={`ellipsis ${p.exited ? 'muted' : ''}`} title={p.args}>{p.name}</span>
                    <KindBadge kind={p.kind} />
                    {p.exited && <span className="badge exited" title="Exited in the last minute">exited</span>}
                  </div>
                  <div className="ellipsis muted small mono" title={p.args}>{p.args}</div>
                </td>
                <td className="num"><CpuCell avg={p.cpu} trend={smooth.procTrend.get(String(p.pid))} /></td>
                <td className="num"><PeakCell trend={smooth.procTrend.get(String(p.pid))} /></td>
                <td className="num">{p.exited ? <span className="mono muted">-</span> : <><span className="mono">{bytes(p.mem)}</span><Bar value={p.mem} max={maxMem} color="var(--series-2)" /></>}</td>
                <td className="num mono">{pct(p.power)}</td>
                <td className="num mono muted">{p.threads}</td>
                <td className="num mono">{p.net >= 1 ? rate(p.net) : '-'}</td>
                <td className="ellipsis" style={{ maxWidth: 180 }}>{p.group}</td>
                <td className="muted">{p.user}</td>
                {snap.allowKill && <td className="num">{!p.exited && <KillButtons target={{ pid: p.pid }} compact />}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
