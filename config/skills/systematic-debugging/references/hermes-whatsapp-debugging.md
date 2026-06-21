# Hermes WhatsApp Gateway Debugging

## Session Corruption Loop

**Symptom:** WhatsApp bridge connects successfully (`✅ WhatsApp connected!`) but immediately logs out with `device_removed` conflict. Gateway times out after 30s, restarts the bridge, bridge waits for scan — cycle repeats indefinitely.

**Root cause:** Disk full (or other session store corruption) breaks the WhatsApp session credentials. WhatsApp server rejects the stale session with a `device_removed` stream error.
**Evidence in bridge.log:**

```
{"type":"stream:error","attrs":{"code":"401"},"content":[{"tag":"conflict","attrs":{"type":"device_removed"}}]}
❌ Logged out. Delete session and restart to re-authenticate.
```

**Diagnostic command:**

```bash
curl -s http://localhost:3000/health
# {"status":"disconnected",...}  ← bridge running but not authenticated
# {"status":"connected",...}    ← bridge authenticated and working
```

**Fix:**

```bash
hermes gateway stop
rm -rf /root/.hermes/whatsapp/session
hermes gateway start
# Scan fresh QR code with WhatsApp
```

## Key Files

| Path                                                            | Purpose                                             |
| --------------------------------------------------------------- | --------------------------------------------------- |
| `/root/.hermes/whatsapp/session/`                               | WhatsApp session store (creds, keys, contacts)      |
| `/root/.hermes/whatsapp/bridge.log`                             | Bridge stdout — QR codes, connection events, errors |
| `/usr/local/lib/hermes-agent/gateway/platforms/whatsapp.py`     | Python gateway adapter                              |
| `/usr/local/lib/hermes-agent/scripts/whatsapp-bridge/bridge.js` | Node.js WhatsApp bridge (Baileys)                   |

## Gateway Timeout Behavior

The Python gateway waits 30s for the bridge to reach `status: connected` after starting. If the bridge is in the process of re-connecting (e.g., after a brief network blip), the gateway may kill and restart it prematurely. This manifests as the bridge constantly being reset to "waiting for scan" even though the session is valid.

**When the bridge keeps restarting before you can scan:**

- Check `bridge.log` — if it shows `Waiting for scan...`, the session was lost
- If it shows `✅ WhatsApp connected!` but gateway still times out, the session is valid but the gateway timeout is too short for the bridge's reconnection time
- Workaround: let the bridge run uninterrupted (`ps aux | grep whatsapp-bridge` to confirm it's alive) while you scan the QR

## Disk Full Recovery

When disk fills up during gateway operation:

1. SQLite session store (`~/.hermes/state.db`) gets I/O errors → sessions can't be written
2. WhatsApp bridge fails to acquire session lock → `No space left on device`
3. Bridge goes into `disconnected` state and can't reconnect
4. Even after disk is freed, the bridge may remain stuck in a bad state

**Recovery steps:**

```bash
# Stop gateway completely
hermes gateway stop

# Clear any stale locks
rm -f /root/.hermes/whatsapp/session/*.lock

# Restart gateway (will reinitialize bridge fresh)
hermes gateway start
```

## Gateway Crash Loop: WhatsApp Enabled but Unpaired

**Symptom:** Gateway crashes and restarts every ~6 seconds in a tight loop. Logs show:

```
ERROR gateway.run: Gateway hit a non-retryable startup conflict: whatsapp: WhatsApp enabled but not paired — run `hermes whatsapp` to pair.
ERROR gateway.run: Gateway exiting cleanly: whatsapp: WhatsApp enabled but not paired — run `hermes whatsapp` to pair.
```

The gateway never stays up long enough for cron jobs to execute.

**Root cause:** `WHATSAPP_ENABLED=true` in `~/.hermes/.env` but no `creds.json` exists yet (account not paired). The gateway treats this as a fatal startup conflict and exits immediately. Because the cron scheduler runs inside the gateway process, it keeps getting reset — cron jobs show `last_run_at: null` indefinitely.

**Why `deliver` changes don't fix it:** Changing a cron job's `deliver` from `whatsapp` to `local` (or any other platform) only affects where output is sent _after_ execution. If the gateway can't start due to the WhatsApp conflict, no execution happens at all.

**Diagnostic commands:**

```bash
# Check if WhatsApp is enabled in .env
grep WHATSAPP_ENABLED ~/.hermes/.env

# Check if creds.json exists (paired state)
ls ~/.hermes/whatsapp/session/creds.json

# Check gateway health (will show disconnected if crashing/restarting)
curl -s http://localhost:3000/health

# Watch the crash loop in real time
tail -f ~/.hermes/logs/gateway.log
```

**Fix — disable WhatsApp in .env:**

```bash
# Edit ~/.hermes/.env and set:
WHATSAPP_ENABLED=false
# Then restart gateway
hermes gateway restart
```

Once disabled, the gateway starts cleanly and cron jobs execute normally. To use WhatsApp later: `hermes whatsapp` to pair, then re-enable in `.env`.

**Alternative (if WhatsApp is needed):** Pair the account — run `hermes whatsapp` and scan the QR code within the bridge timeout window.

## Self-Chat Mode

The gateway runs WhatsApp in `self-chat` mode by default (`WHATSAPP_MODE=self-chat`). In this mode, the bridge prefixes messages from the bot's own number with a tag so the agent doesn't reply to its own messages. This is normal — don't treat the prefixed messages as errors.

```bash
export WHATSAPP_MODE=self-chat  # default, safe
export WHATSAPP_MODE=bot        # only responds to allowed users, no self-chat prefix
```
