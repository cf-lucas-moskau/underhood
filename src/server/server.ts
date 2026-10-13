import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { createGzip, gzipSync, constants as zc } from 'node:zlib'
import type { Collector } from './collector.js'
import type { History } from './history.js'
import { startupItems } from './startup.js'

export interface ServerOptions {
  host: string
  port: number
  token: string | null
  allowKill: boolean
  webDir: string
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
}
// Things that take the session or the machine down with them.
const PROTECTED = new Set(['launchd', 'loginwindow', 'WindowServer', 'kernel_task', 'logd', 'opendirectoryd', 'securityd'])

export function parseWindow(w: string | null, fallback = 3_600_000): number {
  const m = /^(\d+)([mhd])$/.exec(w ?? '')
  if (!m) return fallback
  return +m[1] * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 'm' | 'h' | 'd']
}

function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export function startServer(opts: ServerOptions, collector: Collector, history: History) {
  const authorized = (req: IncomingMessage, url: URL) => {
    if (!opts.token) return true
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    const candidate = bearer ?? readCookie(req, 'uh_token') ?? url.searchParams.get('token')
    return !!candidate && safeEqual(candidate, opts.token)
  }

  const json = (req: IncomingMessage, res: ServerResponse, status: number, body: unknown) => {
    const data = Buffer.from(JSON.stringify(body))
    const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) && data.length > 1024
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...(gzip ? { 'content-encoding': 'gzip' } : {}) })
    res.end(gzip ? gzipSync(data) : data)
  }

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      let s = ''
      req.on('data', c => {
        s += c
        if (s.length > 10_000) reject(new Error('body too large'))
      })
      req.on('end', () => resolve(s))
      req.on('error', reject)
    })

  const kill = async (req: IncomingMessage, res: ServerResponse) => {
    if (!opts.allowKill) return json(req, res, 403, { error: 'Killing is disabled. Start underhood with --allow-kill to enable it.' })
    const body = JSON.parse((await readBody(req)) || '{}') as { pid?: number; group?: string; signal?: string }
    const signal = body.signal === 'KILL' ? 'SIGKILL' : 'SIGTERM'
    const snap = collector.latest
    if (!snap) return json(req, res, 503, { error: 'No data yet' })
    const targets = body.group != null
      ? snap.procs.filter(p => p.group === body.group)
      : snap.procs.filter(p => p.pid === body.pid)
    if (!targets.length) return json(req, res, 404, { error: 'No such process' })
    const results = targets.map(p => {
      if (p.pid <= 1 || p.pid === process.pid || PROTECTED.has(p.name)) return { pid: p.pid, ok: false, error: 'protected' }
      try {
        process.kill(p.pid, signal)
        return { pid: p.pid, ok: true }
      } catch (e) {
        return { pid: p.pid, ok: false, error: (e as NodeJS.ErrnoException).code ?? String(e) }
      }
    })
    json(req, res, 200, { signal, results })
  }

  const stream = (req: IncomingMessage, res: ServerResponse) => {
    const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))
    res.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive',
      'x-accel-buffering': 'no', ...(gzip ? { 'content-encoding': 'gzip' } : {}),
    })
    const out = gzip ? createGzip({ flush: zc.Z_SYNC_FLUSH }) : null
    out?.pipe(res)
    const write = (s: string) => {
      if (out) {
        out.write(s)
        out.flush()
      } else res.write(s)
    }
    const send = (snap: unknown) => write(`data: ${JSON.stringify(snap)}\n\n`)
    if (collector.latest) send(collector.latest)
    collector.on('snapshot', send)
    const ping = setInterval(() => write(': ping\n\n'), 15_000)
    req.on('close', () => {
      collector.off('snapshot', send)
      clearInterval(ping)
      out?.end()
    })
  }

  const serveStatic = (res: ServerResponse, pathname: string) => {
    let file = normalize(join(opts.webDir, pathname))
    if (!file.startsWith(opts.webDir)) {
      res.writeHead(400).end()
      return
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(opts.webDir, 'index.html')
    if (!existsSync(file)) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end('Web UI not built. Run `npm run build`.')
      return
    }
    const immutable = pathname.startsWith('/assets/')
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' })
    createReadStream(file).pipe(res)
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    try {
      if (!authorized(req, url)) {
        res.writeHead(401, { 'content-type': 'text/plain' }).end('Unauthorized. Open the dashboard once with ?token=<your token>.')
        return
      }
      if (opts.token && url.searchParams.get('token')) {
        url.searchParams.delete('token')
        res.writeHead(302, {
          'set-cookie': `uh_token=${encodeURIComponent(opts.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
          location: url.pathname + url.search,
        }).end()
        return
      }
      const now = Date.now()
      const win = parseWindow(url.searchParams.get('window'))
      switch (`${req.method} ${url.pathname}`) {
        case 'GET /api/snapshot': return collector.latest ? json(req, res, 200, collector.latest) : json(req, res, 503, { error: 'Warming up, try again in a few seconds' })
        case 'GET /api/stream': return stream(req, res)
        case 'GET /api/live': return json(req, res, 200, collector.live)
        case 'GET /api/recent': return json(req, res, 200, collector.recent)
        case 'GET /api/culprits': return json(req, res, 200, history.culprits(win, now))
        case 'GET /api/series': return json(req, res, 200, history.series(url.searchParams.get('group') ?? '', win, now))
        case 'GET /api/timeline': return json(req, res, 200, history.timeline(win, now))
        case 'GET /api/startup': return json(req, res, 200, await startupItems(collector.latest))
        case 'POST /api/kill': return await kill(req, res)
      }
      if (url.pathname.startsWith('/api/')) return json(req, res, 404, { error: 'Not found' })
      if (req.method !== 'GET') return json(req, res, 405, { error: 'Method not allowed' })
      serveStatic(res, url.pathname)
    } catch (e) {
      console.error('underhood: request failed', e)
      if (!res.headersSent) json(req, res, 500, { error: String(e) })
      else res.end()
    }
  })
  server.listen(opts.port, opts.host)
  return server
}
