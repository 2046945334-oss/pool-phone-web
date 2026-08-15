// public/sw.js — Service Worker: 缓存所有App HTML实现秒开
const CACHE_NAME = 'pool-apps-v1'
const APP_FILES = [
  '/apps/_browser.html',
  '/apps/_couple.html',
  '/apps/_doodle.html',
  '/apps/_drafts.html',
  '/apps/_fishing.html',
  '/apps/_fortune.html',
  '/apps/_gacha.html',
  '/apps/_messages.html',
  '/apps/_music_player.html',
  '/apps/_notes.html',
  '/apps/_reader.html',
  '/apps/_sleep.html',
  '/apps/_travel.html',
  '/apps/backend-sync.js',
  '/apps/ai-bridge.js',
]

// 安装时预缓存所有app文件
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_FILES)
    }).then(() => self.skipWaiting())
  )
})

// 激活时清除旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
      )
    }).then(() => self.clients.claim())
  )
})

// 拦截请求：app文件优先从缓存读取（Cache First策略）
// API请求和其他资源走网络
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // 只对 /apps/ 路径使用缓存策略
  if (url.pathname.startsWith('/apps/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) {
          // 返回缓存，同时后台更新（Stale While Revalidate）
          const fetchPromise = fetch(event.request).then((response) => {
            if (response.ok) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, response.clone())
              })
            }
            return response
          }).catch(() => {})
          return cached
        }
        // 没缓存就走网络
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          }
          return response
        })
      })
    )
  }
})