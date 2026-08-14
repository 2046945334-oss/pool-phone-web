// public/apps/sync.js — localStorage <-> backend sync layer
// Include this script BEFORE any app logic runs.
// It intercepts localStorage.getItem/setItem and syncs with /api/data/[key]

(function() {
  var API_BASE = (window.location.origin || '') + '/api/data/';
  var _origGet = localStorage.getItem.bind(localStorage);
  var _origSet = localStorage.setItem.bind(localStorage);
  var _origRemove = localStorage.removeItem.bind(localStorage);
  
  // Track which keys have been loaded from backend
  var _loaded = {};
  // Debounce timers for writes
  var _timers = {};
  // Keys that are purely UI state (no need to sync)
  var _skipKeys = {
    'pool_gacha_scrollY': 1, 'pool_gacha_tab': 1,
    'pool_gacha_detail_id': 1, 'pool_gacha_detail_pool': 1,
    'pool_gacha_result_open': 1, 'pool_gacha_result_single': 1,
    'pool_gacha_result_ids': 1, 'pool_gacha_result_pool': 1,
    'pool_gacha_edit_idx': 1, 'pool_gacha_edit_name': 1,
    'pool_gacha_edit_msg': 1, 'pool_gacha_edit_rarity': 1,
    '_scp_called': 1, 'pool_if_last_rendered_hash': 1
  };

  function shouldSync(key) {
    if (!key || _skipKeys[key]) return false;
    // Only sync keys that look like app data
    if (key.indexOf('pool_') === 0 || key.indexOf('f_') === 0 || 
        key.indexOf('doodle_') === 0 || key.indexOf('study') === 0 ||
        key.indexOf('radio_') === 0 || key.indexOf('mail_') === 0 ||
        key.indexOf('voice_') === 0) return true;
    return false;
  }

  // Push to backend (debounced, 2s after last write)
  function pushToBackend(key, value) {
    if (_timers[key]) clearTimeout(_timers[key]);
    _timers[key] = setTimeout(function() {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('PUT', API_BASE + encodeURIComponent(key), true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify({ value: value }));
      } catch(e) {}
    }, 2000);
  }

  // Pull from backend (sync, on first access)
  function pullFromBackend(key) {
    if (_loaded[key]) return;
    _loaded[key] = true;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', API_BASE + encodeURIComponent(key), false); // sync
      xhr.send();
      if (xhr.status === 200) {
        var resp = JSON.parse(xhr.responseText);
        if (resp.value !== undefined) {
          var val = typeof resp.value === 'string' ? resp.value : JSON.stringify(resp.value);
          _origSet(key, val);
        }
      }
    } catch(e) {}
  }

  // Override getItem
  localStorage.getItem = function(key) {
    if (shouldSync(key)) pullFromBackend(key);
    return _origGet(key);
  };

  // Override setItem
  localStorage.setItem = function(key, value) {
    _origSet(key, value);
    if (shouldSync(key)) pushToBackend(key, value);
  };

  // Override removeItem
  localStorage.removeItem = function(key) {
    _origRemove(key);
    if (shouldSync(key)) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('DELETE', API_BASE + encodeURIComponent(key), true);
        xhr.send();
      } catch(e) {}
    }
  };
})();
