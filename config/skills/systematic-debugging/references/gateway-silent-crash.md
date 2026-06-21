# Gateway Silent Crash — Detection and Recovery

## The Problem

The gateway process (`hermes_cli.main gateway run`) can crash and exit without any
exception trace in `gateway.log`. When this happens:

- The process is dead (`ps aux` shows it gone)
- But the health endpoint (`localhost:3000/health`) still responds
- This leads to a false positive when an agent checks `curl localhost:3000/health`

## Why the Health Endpoint Lies

A stale subprocess (e.g. the WhatsApp bridge, running as an independent Node
process) inherits port 3000 when the Python gateway exits. It keeps responding:

```
curl -s http://localhost:3000/health
→ {"status":"disconnected","queueLength":0,"uptime":79616.095}
```

The `uptime` field is the WhatsApp bridge's uptime (hours/days), not the
gateway's — a sure sign the gateway has crashed and the bridge is the respondent.

## How to Confirm the Gateway Is Actually Alive

Check BOTH the process table AND the log:

```bash
# 1. Check process is running
ps aux | grep 'hermes.*gateway.*run' | grep -v grep
# Should show a python process for gateway run --replace

# 2. Check log is actively growing (recent MEMORY line)
tail -1 ~/.hermes/logs/gateway.log
# Recent MEMORY entry with uptime matching time since restart = alive
# No new entries for many minutes = crashed

# 3. Check for startup entry after your restart time
grep 'gateway.run: Starting Hermes Gateway' ~/.hermes/logs/gateway.log | tail -1
# Timestamp should be within the last few minutes
```

## Root Causes Seen in the Wild

- **WhatsApp unpaired + WHATSAPP_ENABLED=true** — gateway crashes on startup
  with a fatal conflict error, then restarts in a tight loop. Cron ticker
  never gets a chance to fire. Fix: `WHATSAPP_ENABLED=false` in `~/.hermes/.env`.
- **OOM / resource exhaustion** — gateway silently killed by the OS
- **segfault in native extension** — Python process dies without Python-level
  exception

## Recovery

```bash
# Confirm dead
ps aux | grep 'hermes.*gateway.*run' | grep -v grep
# (no output = dead)

# Restart
hermes gateway restart

# Verify it stayed up
sleep 5 && tail -3 ~/.hermes/logs/gateway.log
```

## Cron Interaction

The cron scheduler runs inside the gateway process as a background ticker
thread. If the gateway dies, cron jobs stop firing. Jobs that were
scheduled (`next_run_at` in the past) get their `next_run_at` advanced to
the next interval by the burst-prevention guard in `get_due_jobs()` — they
won't fire immediately on restart, only at the next scheduled time.
