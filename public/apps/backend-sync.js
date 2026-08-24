/**
 * pool-phone-web 数据同步层 v2
 * 
 * 设计原则：后端是唯一真相源。
 * - save: 写 localStorage (缓存) + 写后端 (持久化)
 * - load: 先渲染 localStorage 缓存 → 然后拉后端最新覆盖
 * - 如果后端没有数据但本地有 → 把本地推到后端（一次性迁移）
 * 
 * syncFromBackend(keys, callback):
 *   拉后端数据。如果后端有 → 写入 localStorage；如果后端没有但本地有 → 推本地到后端。
 *   最后执行 callback。
 *
 * syncToBackend(key, value):
 *   立即写后端 + localStorage。
 */

function syncFromBackend(keys, callback) {
  if (!keys || !keys.length) { if (callback) callback(); return; }
  var done = 0;
  var total = keys.length;

  function finish() {
    done++;
    if (done >= total && callback) callback();
  }

  keys.forEach(function(key) {
    fetch('/api/data/' + key + '?t=' + Date.now()).then(function(r) {
      if (r.status === 404) {
        // Backend has no data for this key
        var local = localStorage.getItem(key);
        if (local) {
          // Migrate local → backend (one-time)
          fetch('/api/data/' + key, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: local })
          }).catch(function(){});
        }
        finish();
        return;
      }
      if (!r.ok) { finish(); return; }
      return r.json();
    }).then(function(d) {
      if (!d) return; // already handled in 404 branch
      if (d.value !== undefined && d.value !== null) {
        // Backend has data → write to localStorage (backend is source of truth)
        localStorage.setItem(key, typeof d.value === 'string' ? d.value : JSON.stringify(d.value));
      }
      finish();
    }).catch(function() {
      finish();
    });
  });

  // Safety timeout: 5s
  setTimeout(function() { if (done < total) { done = total; if (callback) callback(); } }, 5000);
}

/**
 * syncToBackend: write to both localStorage and backend immediately (no debounce)
 */
function syncToBackend(key, value) {
  var str = typeof value === 'string' ? value : JSON.stringify(value);
  localStorage.setItem(key, str);
  fetch('/api/data/' + key, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: str })
  }).catch(function() {});
}
