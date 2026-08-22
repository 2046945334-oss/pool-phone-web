// her-shop-deliver.js - 用户发货功能注入
// 在 _travel.html 末尾引入此脚本

function deliverHerOrder(idx) {
  var content = prompt('写点什么发给池吧～（发货内容）：');
  if (content === null) return;
  var orders = getHerOrders();
  if (!orders[idx] || orders[idx].status !== 'pending') { alert('订单不存在或已发货'); return; }
  orders[idx].status = 'delivered';
  orders[idx].content = content;
  orders[idx].deliveredAt = new Date().toISOString();
  saveHerOrders(orders);
  // 同步到后端
  fetch('/api/her-shop-deliver', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ index: idx, content: content })
  }).catch(function(){});
  renderHerShop();
  alert('发货成功！池会收到你写的内容 💌');
}

// 覆盖原来的 renderHerShop 中待发货部分
// 通过 monkey-patch 的方式，在 DOM 渲染后给待发货订单加上发货按钮
var _origRenderHerShop = typeof renderHerShop === 'function' ? renderHerShop : null;
if (_origRenderHerShop) {
  renderHerShop = function() {
    _origRenderHerShop();
    // 渲染后，找到待发货区域，给每个待发货项加发货按钮
    setTimeout(function() {
      var orders = getHerOrders();
      var pendingItems = document.querySelectorAll('[data-her-pending]');
      // 如果原版没有 data 属性，用另一种方式：找到"等她发货中"的文字
      var shopEl = document.getElementById('herShopContent') || document.querySelector('.her-shop-section');
      if (!shopEl) return;
      var spans = shopEl.querySelectorAll('span');
      for (var i = 0; i < spans.length; i++) {
        if (spans[i].textContent.indexOf('等她发货中') >= 0) {
          var parent = spans[i].parentElement;
          if (parent && !parent.querySelector('.deliver-btn')) {
            // 找到对应订单 index
            var pending = orders.filter(function(o){ return o.status === 'pending'; });
            var pIdx = 0;
            var prevSiblings = parent.parentElement ? Array.from(parent.parentElement.children) : [];
            for (var j = 0; j < prevSiblings.length; j++) {
              if (prevSiblings[j] === parent) { pIdx = j; break; }
            }
            var realIdx = -1;
            var pCount = 0;
            for (var k = 0; k < orders.length; k++) {
              if (orders[k].status === 'pending') {
                if (pCount === pIdx) { realIdx = k; break; }
                pCount++;
              }
            }
            if (realIdx >= 0) {
              var btn = document.createElement('button');
              btn.className = 'deliver-btn';
              btn.textContent = '发货 📮';
              btn.style.cssText = 'border:none;border-radius:6px;background:#e91e63;color:#fff;font-size:10px;padding:4px 10px;cursor:pointer;margin-left:8px;';
              btn.onclick = (function(ri){ return function(e){ e.stopPropagation(); deliverHerOrder(ri); }; })(realIdx);
              parent.style.display = 'flex';
              parent.style.alignItems = 'center';
              parent.style.justifyContent = 'space-between';
              parent.appendChild(btn);
            }
          }
        }
      }
    }, 50);
  };
  // 立即执行一次以应用按钮
  renderHerShop();
}
