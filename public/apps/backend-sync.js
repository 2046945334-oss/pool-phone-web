/**
 * 通用后端数据同步脚本
 * 用法: syncFromBackend(keys, callback)
 * - keys: 需要同步的 localStorage key 数组
 * - callback: 同步完成后的回调（通常是 render 函数）
 */
function syncFromBackend(keys, callback) {
  if (!keys || !keys.length) return;
  var done = 0;
  var total = keys.length;
  keys.forEach(function(key) {
    fetch('/api/data/' + key + '?t=' + Date.now()).then(function(r) {
      if (!r.ok) { done++; if (done >= total && callback) callback(); return; }
      return r.json();
    }).then(function(d) {
      if (d && d.value !== undefined && d.value !== null) {
        localStorage.setItem(key, typeof d.value === 'string' ? d.value : JSON.stringify(d.value));
      }
      done++;
      if (done >= total && callback) callback();
    }).catch(function() {
      done++;
      if (done >= total && callback) callback();
    });
  });
  // 安全兜底：3秒后强制回调
  setTimeout(function() { if (done < total && callback) callback(); }, 3000);
}

/**
 * 写回后端（防抖）
 * 用法: syncToBackend(key, value)
 */
var _syncTimers = {};
function syncToBackend(key, value) {
  if (_syncTimers[key]) clearTimeout(_syncTimers[key]);
  _syncTimers[key] = setTimeout(function() {
    fetch('/api/data/' + key, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: value })
    }).catch(function() {});
  }, 800);
}
