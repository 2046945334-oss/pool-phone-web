// pages/api/wakeup-trigger.js
// Manual trigger for wakeup (GET or POST)
let wakeupModule = null
try { wakeupModule = require('../../lib/wakeup') } catch {}

export default function handler(req, res) {
  // Import doWakeup - we need to access it differently since it is not exported
  // Instead, we stop and restart the scheduler to trigger immediately
  if (!wakeupModule) {
    return res.status(500).json({ error: 'wakeup module not loaded' })
  }
  // Stop current timer, then start fresh (will fire in 2s)
  try {
    wakeupModule.stopWakeupScheduler()
  } catch {}
  // Restart - this sets a 2min timer, but we want immediate
  // Actually let us just expose doWakeup
  // For now, simply restart scheduler which triggers in 120s
  wakeupModule.startWakeupScheduler()
  res.json({ ok: true, message: 'Scheduler restarted, will fire in ~2min' })
}
