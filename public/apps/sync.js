// public/apps/sync.js — localStorage <-> backend sync layer v2
// Non-blocking: only intercepts setItem to push changes to backend.
// On page load, async-pulls ALL keys from backend into localStorage,
// then reloads the page once if new data was found.

(function() {
  var API_BASE = (window.location.origin || '') + '/api/data/';
  var _origSet = localStorage.setItem.bind(localStorage);
  var _origRemove = localStorage.removeItem.bind(localStorage);

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
    '_scp_called': 1, 'pool_if_last_rendered_hash': 1,
    '_sync_loaded': 1
  };

  function shouldSync(key) {
    if (!key || _skipKeys[key]) return false;
    if (key.indexOf('pool_') === 0 || key.indexOf('f_') === 0 || 
        key.indexOf('doodle_') === 0 || key.indexOf('study') === 0 ||
        key.indexOf('radio_') === 0 || key.indexOf('mail_') === 0 ||
        key.indexOf('voice_') === 0 || key.indexOf('travel') === 0) return true;
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

  // Override setItem — push changes to backend
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

  // Async: pull all keys from backend after page loads
  // If backend has data not in localStorage, write it and reload once
  if (!sessionStorage.getItem('_sync_loaded')) {
    window.addEventListener('load', function() {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', API_BASE.replace(/\/+$/, ''), true);
        xhr.onload = function() {
          if (xhr.status !== 200) return;
          try {
            var resp = JSON.parse(xhr.responseText);
            var keys = (resp.keys || []).map(function(r) { return r.key || r; });
            var needReload = false;
            var pending = keys.length;
            if (pending === 0) { sessionStorage.setItem('_sync_loaded', '1'); return; }
            keys.forEach(function(key) {
              if (!shouldSync(key)) { pending--; if(pending<=0 && needReload) location.reload(); return; }
              var xhr2 = new XMLHttpRequest();
              xhr2.open('GET', API_BASE + encodeURIComponent(key), true);
              xhr2.onload = function() {
                if (xhr2.status === 200) {
                  try {
                    var data = JSON.parse(xhr2.responseText);
                    if (data.value !== undefined) {
                      var val = typeof data.value === 'string' ? data.value : JSON.stringify(data.value);
                      var existing = localStorage.getItem(key);
                      if (existing !== val) {
                        _origSet(key, val);
                        needReload = true;
                      }
                    }
                  } catch(e2) {}
                }
                pending--;
                if (pending <= 0) {
                  sessionStorage.setItem('_sync_loaded', '1');
                  if (needReload) location.reload();
                }
              };
              xhr2.onerror = function() { pending--; if(pending<=0) { sessionStorage.setItem('_sync_loaded','1'); if(needReload) location.reload(); } };
              xhr2.send();
            });
          } catch(e) {}
        };
        xhr.send();
      } catch(e) {}
    });
  }
})();