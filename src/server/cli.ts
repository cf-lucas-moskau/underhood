#!/usr/bin/env node
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { Collector } from './collector.js'
import { History } from './history.js'
import { startServer } from './server.js'

const { values: a } = parseArgs({
  options: {
    host: { type: 'string', default: process.env.UNDERHOOD_HOST ?? '127.0.0.1' },
    port: { type: 'string', default: process.env.UNDERHOOD_PORT ?? '7777' },
    interval: { type: 'string', default: process.env.UNDERHOOD_INTERVAL ?? '2' },
    'data-dir': { type: 'string', default: process.env.UNDERHOOD_DATA_DIR ?? join(homedir(), '.underhood') },
    token: { type: 'string', default: process.env.UNDERHOOD_TOKEN },
    'allow-kill': { type: 'boolean', default: process.env.UNDERHOOD_ALLOW_KILL === '1' },
    help: { type: 'boolean', short: 'h' },
  },
})

if (a.help) {
  console.log(`underhood - see what is really eating your Mac

  --host <addr>      bind address (default 127.0.0.1; use 0.0.0.0 or your Tailscale IP for remote access)
  --port <n>         port (default 7777)
  --interval <sec>   sample interval (default 2)
  --data-dir <dir>   where history lives (default ~/.underhood)
  --token <secret>   require this token (open the UI once with ?token=<secret>)
  --allow-kill       enable quit/kill buttons in the UI

Every flag also reads UNDERHOOD_<NAME> from the environment.`)
  process.exit(0)
}

process.title = 'underhood'

if (process.platform !== 'darwin') {
  console.error('underhood only runs on macOS.')
  process.exit(1)
}
// Tailscale addresses (100.64.0.0/10) are only reachable from your own tailnet.
const tailnet = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.host!)
if (a.host !== '127.0.0.1' && a.host !== 'localhost' && !tailnet && !a.token) {
  console.warn(`underhood: listening on ${a.host} without --token. Anyone who can reach this port sees your process list${a['allow-kill'] ? ' and can kill your processes' : ''}.`)
}

const interval = Math.max(1, Number(a.interval) || 2)
const history = new History(join(a['data-dir']!, 'history'))
history.load(Date.now())
const collector = new Collector(interval, a['allow-kill']!)
collector.on('snapshot', snap => {
  const s = snap.system
  history.add(snap.ts, interval, { cpu: s.cpuUser + s.cpuSys, mem: s.memUsed, swap: s.swapUsed, pressure: s.pressure }, snap.groups)
})
await collector.start()

const webDir = join(dirname(fileURLToPath(import.meta.url)), '../web')
const port = Number(a.port)
const server = startServer({ host: a.host!, port, token: a.token ?? null, allowKill: a['allow-kill']!, webDir }, collector, history)
server.on('listening', () => console.log(`underhood listening on http://${a.host}:${port}`))
server.on('error', e => {
  console.error(`underhood: ${e.message}`)
  process.exit(1)
})

const shutdown = () => {
  collector.stop()
  history.flush()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
