// pages/api/wakeup-reschedule.js - Triggers wakeup scheduler reschedule
// Called internally when chat AI sets a schedule_wakeup
const { scheduleNext } = require('../../lib/wakeup')

export default function handler(req, res) {
  const minutes = parseInt(req.query.minutes || req.body?.minutes) || 60
  try {
    scheduleNext(minutes)
    console.log('[Wakeup-Reschedule] Rescheduled to', minutes, 'min from chat')
    return res.status(200).json({ ok: true, minutes })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
