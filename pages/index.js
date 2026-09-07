import React, { useState, useRef, useEffect } from 'react'
import Head from 'next/head'
import SplashScreen from '../components/SplashScreen'
import StickerPanel from '../components/StickerPanel'
import { pullAllFromBackend, pushAllToBackend } from '../lib/appSync'
import BrowserApp from '../components/apps/BrowserApp'
import FortuneApp from '../components/apps/FortuneApp'
import FishingApp from '../components/apps/FishingApp'
import ReaderApp from '../components/apps/ReaderApp'
import DraftsApp from '../components/apps/DraftsApp'
import HtmlApp from '../components/apps/HtmlApp'
import AppCustomizer, { getAppBgStyle, getAppBgCss, getCoupleInjectJs } from '../components/apps/AppCustomizer'
import notesHtml from '../public/apps/_notes.html'
import gachaHtml from '../public/apps/_gacha.html'
import messagesHtml from '../public/apps/_messages.html'
import diaryHtml from '../public/apps/_diary.html'
import musicHtml from '../public/apps/_music_player.html'
import coupleHtml from '../public/apps/_couple.html'
import doodleHtml from '../public/apps/_doodle.html'
import sleepHtml from '../public/apps/_sleep.html'
import travelHtml from '../public/apps/_travel.html'
import gardenHtml from '../public/apps/_garden.html'
import ledgerHtml from '../public/apps/_ledger.html'
import cabinHtml from '../public/apps/_cabin.html'
import starmapHtml from '../public/apps/_starmap.html'
import stickersHtml from '../public/apps/_stickers.html'
// import careHtml from '../public/apps/_care.html' // removed: 72KB bloat
import commissionHtml from '../public/apps/_commission.html'
import ScreenTimeApp from '../components/apps/ScreenTimeApp'

// ===== Capacitor 通知初始化 =====
function initCapacitorNotifications() {
  if (typeof window === 'undefined') return
  const cap = window.Capacitor
  if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) {
    console.log('[通知] 非原生环境，跳过')
    return
  }
  console.log('[通知] 检测到 Capacitor 原生环境，初始化通知...')
  
  // 本地通知 (保留，作为即时弹通知的备用)
  import('@capacitor/local-notifications').then(({ LocalNotifications }) => {
    LocalNotifications.requestPermissions().then(p => {
      console.log('[本地通知] 权限:', p.display)
    })
    LocalNotifications.addListener('localNotificationActionPerformed', (n) => {
      console.log('[本地通知] 点击:', n)
      if (n.notification?.extra?.app) {
        window.dispatchEvent(new CustomEvent('chi-open-app', { detail: { app: n.notification.extra.app } }))
      }
    })
    window.ChiLocalNotifications = LocalNotifications
    window.chiShowNotification = async (title, body, extra) => {
      const id = Math.floor(Math.random() * 100000)
      await LocalNotifications.schedule({ notifications: [{ id, title: title || '池的小手机', body: body || '', extra: extra || {} }] })
      return id
    }
    window.chiScheduleNotification = async (title, body, atDate, extra) => {
      const id = Math.floor(Math.random() * 100000)
      await LocalNotifications.schedule({ notifications: [{ id, title, body, schedule: { at: new Date(atDate) }, extra: extra || {} }] })
      return id
    }
    console.log('[本地通知] 初始化完成 ✓')
  }).catch(e => console.error('[本地通知] 加载失败:', e))

  // FCM 推送通知 - 后台也能收
  import('@capacitor/push-notifications').then(({ PushNotifications }) => {
    PushNotifications.requestPermissions().then(perm => {
      console.log('[FCM] 权限:', perm.receive)
      if (perm.receive === 'granted') {
        PushNotifications.register()
      }
    })
    PushNotifications.addListener('registration', (token) => {
      console.log('[FCM] Token:', token.value)
      window.__fcmToken = token.value
      // 存到后端
      fetch('/api/data/pool_fcm_token', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: token.value })
      }).then(() => console.log('[FCM] Token 已同步到后端')).catch(e => console.error('[FCM] Token 同步失败:', e))
    })
    PushNotifications.addListener('registrationError', (err) => {
      console.error('[FCM] 注册失败:', err)
    })
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('[FCM] 收到前台推送:', notification)
      // 前台收到时用本地通知弹出（FCM 前台默认不弹）
      if (window.chiShowNotification) {
        window.chiShowNotification(notification.title, notification.body, notification.data)
      }
    })
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('[FCM] 用户点击推送:', action)
      if (action.notification?.data?.app) {
        window.dispatchEvent(new CustomEvent('chi-open-app', { detail: { app: action.notification.data.app } }))
      }
    })
    console.log('[FCM] 推送初始化完成 ✓')
  }).catch(e => console.error('[FCM] 加载失败:', e))

  // 兜底：5秒后如果有token就再同步一次（让后台发消息用）
  setTimeout(() => {
    if (window.__fcmToken) {
      fetch('/api/data/pool_fcm_token', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: window.__fcmToken })
      }).then(() => console.log('[FCM] 兜底同步成功')).catch(() => {})
    } else {
      console.warn('[FCM] 5秒后仍无token，PushNotifications可能未注册成功')
    }
  }, 5000)
}
// 执行初始化
if (typeof window !== 'undefined') {
  if (document.readyState === 'complete') { initCapacitorNotifications() }
  else { window.addEventListener('load', initCapacitorNotifications) }
}


// 思考过程组件 - 底部抽屉样式
function ThinkingToggle({ reasoning }) {
  const [open, setOpen] = useState(false)
  if (!reasoning) return null
  return (
    <>
      <div className="thinking-trigger" onClick={() => setOpen(true)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8v4M12 16h.01"/>
        </svg>
        <span>思考过程</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
      {open && (
        <div className="thinking-drawer-overlay" onClick={() => setOpen(false)}>
          <div className="thinking-drawer" onClick={e => e.stopPropagation()}>
            <div className="thinking-drawer-handle"/>
            <div className="thinking-drawer-header">
              <span>思考过程</span>
              <button onClick={() => setOpen(false)} className="thinking-drawer-close">✕</button>
            </div>
            <div className="thinking-drawer-body">{reasoning}</div>
          </div>
        </div>
      )}
    </>
  )
}
