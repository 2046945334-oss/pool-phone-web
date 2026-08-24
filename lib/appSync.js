// lib/appSync.js — sync helper used by the parent page (index.js)
// Pulls data from backend into iframe's localStorage before opening an app,
// and pushes changes back after closing.

const API_BASE = '/api/data'

export async function pullAllFromBackend() {
  try {
    const res = await fetch(API_BASE)
    if (!res.ok) return
    const { keys } = await res.json()
    if (!keys || !keys.length) return
    for (const row of keys) {
      const key = row.key || row
      try {
        const r = await fetch(`${API_BASE}/${encodeURIComponent(key)}`)
        if (r.ok) {
          const data = await r.json()
          if (data.value !== undefined) {
            const val = typeof data.value === 'string' ? data.value : JSON.stringify(data.value)
            localStorage.setItem(key, val)
          }
        }
      } catch {}
    }
  } catch {}
}

export async function pushAllToBackend() {
  const syncPrefixes = ['pool_', 'f_', 'doodle_', 'study', 'radio_', 'mail_', 'voice_', 'travel']
  const skipKeys = new Set([
    'pool_gacha_scrollY', 'pool_gacha_tab', 'pool_gacha_detail_id',
    'pool_gacha_detail_pool', 'pool_gacha_result_open', 'pool_gacha_result_single',
    'pool_gacha_result_ids', 'pool_gacha_result_pool', 'pool_gacha_edit_idx',
    'pool_gacha_edit_name', 'pool_gacha_edit_msg', 'pool_gacha_edit_rarity',
    '_scp_called', 'pool_if_last_rendered_hash', 'pool_chat_history',
    'pool_api_config', 'pool_api_config_chat',
    'pool_wake_log', 'pool_wake_inbox', 'pool_fishing_v2',
    'pool_ai_wakeup_state', 'pool_ai_status', 'pool_pixel_garden', 'pool_commission',
    'pool_couple_space_v2', 'pool_notes_v3', 'pool_diary', 'pool_moments',
    
  ])
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || skipKeys.has(key)) continue
    const shouldSync = syncPrefixes.some(p => key.indexOf(p) === 0)
    if (!shouldSync) continue
    const value = localStorage.getItem(key)
    if (!value) continue
    try {
      await fetch(`${API_BASE}/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value })
      })
    } catch {}
  }
}