# underhood

See what is really eating your Mac.

underhood is a small daemon plus web dashboard for macOS. It samples the system every two seconds, rolls helper processes up into the app that owns them, remembers who burned the most CPU and memory over the last 7 days, and lists every third-party launch agent and daemon that starts behind your back. It runs fine on a headless Mac: install it as a LaunchAgent and open the dashboard from any browser on your network or tailnet.

## What you get

**Apps.** Live CPU, memory (physical footprint, same as Activity Monitor), energy impact, network and process count per app. Chrome's 30 helpers count as Chrome. Child processes count toward the app that spawned them, except that shells are a boundary, so whatever you run in a terminal shows up as its own entry (`claude`, `node vite`, `python3 server.py`). Expand a row for its CPU and memory history and its processes.

**Processes.** Every process, searchable by name, path, arguments or PID.

**Culprits.** Ranked by CPU time burned over 15 minutes to 7 days, with average and peak memory, energy and network. This is the tab for "my Mac was slow this afternoon, who did it". It also shows system CPU, memory and swap over the window and flags periods of memory pressure.

**Startup items.** Everything in `~/Library/LaunchAgents`, `/Library/LaunchAgents` and `/Library/LaunchDaemons`: what it is, whether it runs at login or is kept alive, whether it is running right now and what it costs. Each row has a copyable command to disable it.

**System tiles.** CPU, memory used (app + wired + compressed, not file cache) with memory pressure, GPU, network, disk throughput and free space, battery.

Optional: quit or force-kill a process or a whole app from the UI (`--allow-kill`).

## Requirements

macOS and Node 20.19 or newer. No native dependencies, no root. Everything comes from tools macOS ships with (`top`, `ps`, `vm_stat`, `nettop`, `netstat`, `ioreg`, `launchctl`).

## Run it

```sh
git clone https://github.com/cf-lucas-moskau/underhood.git
cd underhood
npm ci
npm run build
npm start
```

Open http://127.0.0.1:7777.

## Run it permanently (and on a headless Mac)

```sh
./scripts/install.sh
```

This builds, writes `~/Library/LaunchAgents/dev.underhood.plist` and starts it. It restarts on crash and at login. Arguments are passed through to underhood, so on a headless Mac you would bind to an address you can reach:

```sh
# Only reachable over Tailscale
./scripts/install.sh --host "$(tailscale ip -4)"

# Reachable on the LAN, protected by a token
./scripts/install.sh --host 0.0.0.0 --token "$(openssl rand -hex 16)"
```

With a token, open the dashboard once as `http://host:7777/?token=<token>`; it is stored in a cookie after that. API clients send `Authorization: Bearer <token>`.

Remove it with `./scripts/uninstall.sh`. History stays in `~/.underhood` until you delete it. Logs go to `~/.underhood/underhood.log`.

## Options

| Flag | Env | Default | |
|---|---|---|---|
| `--host` | `UNDERHOOD_HOST` | `127.0.0.1` | Bind address |
| `--port` | `UNDERHOOD_PORT` | `7777` | |
| `--interval` | `UNDERHOOD_INTERVAL` | `2` | Seconds between samples |
| `--data-dir` | `UNDERHOOD_DATA_DIR` | `~/.underhood` | History lives in `history/` |
| `--token` | `UNDERHOOD_TOKEN` | none | Require this token |
| `--allow-kill` | `UNDERHOOD_ALLOW_KILL=1` | off | Enable quit and force-kill buttons |

## API

Everything the UI shows is JSON, handy for scripts and agents:

```sh
curl -s localhost:7777/api/snapshot | jq '.groups[:5] | map({name, cpu, mem})'
curl -s 'localhost:7777/api/culprits?window=24h' | jq '.[:10] | map({name, cpuSeconds, memMax})'
```

| Endpoint | |
|---|---|
| `GET /api/snapshot` | Latest sample: system stats, every process, every app group |
| `GET /api/stream` | Server-sent events, one snapshot per interval |
| `GET /api/live` | System series for the last 15 minutes at full resolution |
| `GET /api/culprits?window=1h` | Ranking over `15m`, `1h`, `6h`, `24h`, `7d` (any `<n>m/h/d`) |
| `GET /api/series?group=<name>&window=6h` | CPU and memory history of one group |
| `GET /api/timeline?window=24h` | System CPU, memory, swap, pressure history |
| `GET /api/startup` | Launch agents and daemons with live cost |
| `POST /api/kill` | `{"pid": 123}` or `{"group": "Slack"}`, optional `"signal": "KILL"`. Needs `--allow-kill` |

## How it works

One long-running `top -l 0` provides per-process CPU, memory footprint and energy at Activity Monitor accuracy. Each sample is joined with `ps` for paths, parents and arguments, then grouped. `nettop` is polled every few seconds for per-process network (its continuous mode burns a full core, so it is not used). History is aggregated per minute, appended to one JSONL file per day, kept at minute resolution for 24 hours and rolled up hourly for 7 days.

Overhead is about 5% of one core, almost all of it `top` itself.

## Limits

Login items registered through `SMAppService` (System Settings > General > Login Items) are not listed, since reading them needs root. Processes owned by root can be seen but not killed. Per-process disk I/O is not available without root, so disk is shown system-wide.

## Development

```sh
npm run dev:server   # API on :7777
npm run dev          # Vite UI with hot reload, proxies /api
npm test
npm run check        # typecheck, tests, build
```

MIT licensed.
