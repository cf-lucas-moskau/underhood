import { Fragment, useMemo, useState } from 'react'
import { usePoll } from '../api'
import { Spark, TimeChart } from '../charts'
import { bytes, clock, dayClock, duration, pct } from '../format'
import { KindBadge, KindFilter, Th, useSort } from '../table'
import { GroupDetail } from './Detail'
import type { Culprit, Kind, Pressure } from '../../shared/types'

const WINDOWS = ['15m', '1h', '6h', '24h', '7d'] as const
type Win = (typeof WINDOWS)[number]
type Key = 'name' | 'cpuSeconds' | 'cpuAvg' | 'memAvg' | 'memMax' | 'powerAvg' | 'netBytes'

interface TimelinePoint { ts: number; span: number; cpu: number; mem: number; swap: number; pressure: Pressure }

export function HistoryView() {
  const [win, setWin] = useState<Win>('1h')
  const [kinds, setKinds] = useState<Set<Kind>>(new Set(['app', 'thirdparty', 'cli', 'system']))
  const [open, setOpen] = useState<string | null>(null)
  const { sort, toggle, apply } = useSort<Key>('cpuSeconds')
  const culprits = usePoll<Culprit[]>(`/api/culprits?window=${win}`, 20_000)
  const timeline = usePoll<TimelinePoint[]>(`/api/timeline?window=${win}`, 20_000)
  const fmtTime = win === '7d' || win === '24h' ? dayClock : clock

  const rows = useMemo(() => apply((culprits.data ?? []).filter(c => kinds.has(c.kind)), (c, k) => c[k]), [culprits.data, kinds, apply])
  const tl = timeline.data ?? []
  const pressured = tl.filter(p => p.pressure !== 'normal').length

  return (
    <section>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Window">
          {WINDOWS.map(w => (
            <button key={w} className={w === win ? 'on' : ''} aria-pressed={w === win} onClick={() => setWin(w)}>{w}</button>
          ))}
        </div>
        <KindFilter value={kinds} onChange={setKinds} />
        <span className="muted small">Ranked by CPU time burned in the window. History keeps minutes for 24h and hours for 7 days.</span>
      </div>

      {tl.length > 1 && (
        <div className="grid2 charts-row">
          <TimeChart label="System CPU" ts={tl.map(p => p.ts)} series={[{ name: 'CPU', color: 'var(--series-1)', values: tl.map(p => p.cpu) }]} format={v => `${pct(v)}%`} max={100} timeFormat={fmtTime} />
          <TimeChart
            label="Memory and swap"
            ts={tl.map(p => p.ts)}
            series={[
              { name: 'Memory used', color: 'var(--series-2)', values: tl.map(p => p.mem) },
              { name: 'Swap used', color: 'var(--series-3)', values: tl.map(p => p.swap) },
            ]}
            format={v => bytes(v)}
            timeFormat={fmtTime}
          />
        </div>
      )}
      {pressured > 0 && (
        <p className="callout"><span aria-hidden>▲</span> Memory pressure was elevated in {pressured} of {tl.length} samples in this window. Look at the memory columns below.</p>
      )}

      {culprits.error && <p className="error">{culprits.error}</p>}
      {culprits.data && culprits.data.length === 0 && <p className="muted pad">Nothing recorded yet. Culprits show up after the first minute.</p>}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <Th k="name" sort={sort} toggle={toggle}>Name</Th>
                <Th k="cpuSeconds" sort={sort} toggle={toggle} num>CPU time</Th>
                <Th k="cpuAvg" sort={sort} toggle={toggle} num>Avg CPU %</Th>
                <th>CPU over window</th>
                <Th k="memAvg" sort={sort} toggle={toggle} num>Avg memory</Th>
                <Th k="memMax" sort={sort} toggle={toggle} num>Peak memory</Th>
                <Th k="powerAvg" sort={sort} toggle={toggle} num>Avg energy</Th>
                <Th k="netBytes" sort={sort} toggle={toggle} num>Network</Th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 100).map(c => (
                <Fragment key={c.name}>
                  <tr className={`row ${open === c.name ? 'open' : ''}`} onClick={() => setOpen(open === c.name ? null : c.name)} aria-expanded={open === c.name}>
                    <td><div className="name-cell"><span className="chev" aria-hidden>{open === c.name ? '▾' : '▸'}</span><span className="ellipsis">{c.name}</span><KindBadge kind={c.kind} /></div></td>
                    <td className="num mono">{duration(c.cpuSeconds)}</td>
                    <td className="num mono">{pct(c.cpuAvg)}</td>
                    <td className="spark-cell"><Spark values={c.spark} height={22} /></td>
                    <td className="num mono">{bytes(c.memAvg)}</td>
                    <td className="num mono">{bytes(c.memMax)}</td>
                    <td className="num mono">{pct(c.powerAvg)}</td>
                    <td className="num mono">{c.netBytes > 0 ? bytes(c.netBytes) : '-'}</td>
                  </tr>
                  {open === c.name && (
                    <tr className="detail-row"><td colSpan={8}><GroupDetail name={c.name} allowKill={false} /></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
