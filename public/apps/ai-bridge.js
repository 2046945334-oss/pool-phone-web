// public/apps/ai-bridge.js — 通用AI桥接，App HTML引入此脚本即可与AI对话
// 用法: <script src="ai-bridge.js"></script>
// 然后调用: poolAI.chat("你好", "可选的system prompt").then(reply => ...)

(function() {
  var _pending = {};
  var _idCounter = 0;

  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'poolAI_response') return;
    var cb = _pending[e.data.id];
    if (cb) {
      delete _pending[e.data.id];
      if (e.data.error) {
        cb.reject(e.data.error);
      } else {
        cb.resolve(e.data.reply || '');
      }
    }
  });

  window.poolAI = {
    chat: function(message, context) {
      var id = 'ai_' + (++_idCounter) + '_' + Date.now();
      return new Promise(function(resolve, reject) {
        _pending[id] = { resolve: resolve, reject: reject };
        // 15秒超时
        setTimeout(function() {
          if (_pending[id]) {
            delete _pending[id];
            reject('AI响应超时');
          }
        }, 15000);
        try {
          parent.postMessage({
            type: 'poolAI_request',
            id: id,
            message: message,
            context: context || ''
          }, '*');
        } catch(err) {
          delete _pending[id];
          reject('无法连接AI: ' + err.message);
        }
      });
    }
  };
})();