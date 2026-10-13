import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** Tiny trend line for tiles and table rows. Decorative: the number next to it carries the value. */
export function Spark({ values, max, height = 28, color = 'var(--series-1)' }: { values: (number | null)[]; max?: number; height?: number; color?: string }) {
  const n = values.length
  const idx = values.flatMap((v, i) => (v == null ? [] : [i]))
  if (n < 2 || idx.length < 2) return <svg className="spark" height={height} aria-hidden />
  const top = Math.max(max ?? 0, ...idx.map(i => values[i]!), 1e-9)
  const x = (i: number) => (i / (n - 1)) * 100
  const pts = idx.map(i => `${x(i)},${height - 1 - (values[i]! / top) * (height - 2)}`)
  return (
    <svg className="spark" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" height={height} aria-hidden>
      <polygon points={`${x(idx[0])},${height} ${pts.join(' ')} ${x(idx[idx.length - 1])},${height}`} fill={color} opacity={0.14} />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

export interface Series { name: string; color: string; values: (number | null)[] }

/**
 * Time series with a shared y-scale, crosshair and tooltip. Never dual-axis:
 * series in one chart must share a unit.
 */
export function TimeChart({ ts, series, format, max, height = 140, label, timeFormat }: {
  ts: number[]
  series: Series[]
  format: (v: number) => string
  max?: number
  height?: number
  label: string
  timeFormat: (ts: number) => string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const padL = 52
  const padR = 8
  const padT = 8
  const padB = 22
  const plotW = Math.max(10, width - padL - padR)
  const plotH = height - padT - padB
  const all = series.flatMap(s => s.values.filter((v): v is number => v != null))
  const top = niceMax(Math.max(max ?? 0, ...all, 1e-9))
  const n = ts.length
  const x = (i: number) => padL + (n <= 1 ? plotW : (i / (n - 1)) * plotW)
  const y = (v: number) => padT + plotH - (v / top) * plotH
  const ticks = [0, 0.5, 1].map(f => f * top)

  const path = (vals: (number | null)[]) => {
    let d = ''
    let pen = false
    vals.forEach((v, i) => {
      if (v == null) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
      pen = true
    })
    return d
  }

  const onMove = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const px = e.clientX - r.left - padL
    if (n === 0) return
    setHover(Math.max(0, Math.min(n - 1, Math.round((px / plotW) * (n - 1)))))
  }

  const xLabels = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1] : []
  let tooltip: ReactNode = null
  if (hover != null && n) {
    const left = x(hover)
    tooltip = (
      <div className="tip" style={{ left: Math.min(left + 10, width - 170), top: 4 }}>
        <div className="tip-time">{timeFormat(ts[hover])}</div>
        {series.map(s => (
          <div key={s.name} className="tip-row">
            <span className="key" style={{ background: s.color }} />
            <span>{s.name}</span>
            <b>{s.values[hover] == null ? '-' : format(s.values[hover]!)}</b>
          </div>
        ))}
      </div>
    )
  }

  return (
    <figure className="chart" aria-label={label}>
      {series.length > 1 && (
        <div className="legend">
          {series.map(s => (
            <span key={s.name}><span className="key" style={{ background: s.color }} />{s.name}</span>
          ))}
        </div>
      )}
      <div ref={ref} className="chart-area" style={{ height }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={label}>
            {ticks.map(t => (
              <g key={t}>
                <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
                <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="tick">{format(t)}</text>
              </g>
            ))}
            {xLabels.map((i, k) => (
              <text key={i} x={x(i)} y={height - 6} textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'} className="tick">{timeFormat(ts[i])}</text>
            ))}
            {series.map(s => (
              <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {hover != null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} className="crosshair" />
                {series.map(s => s.values[hover] != null && (
                  <circle key={s.name} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
        )}
        {tooltip}
      </div>
    </figure>
  )
}

function niceMax(v: number): number {
  const exp = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * exp >= v) return m * exp
  return 10 * exp
}

/** Horizontal meter for table cells: share of the column's maximum. */
export function Bar({ value, max, color = 'var(--series-1)' }: { value: number; max: number; color?: string }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <span className="bar" aria-hidden>
      <span style={{ width: `${w}%`, background: color }} />
    </span>
  )
}
