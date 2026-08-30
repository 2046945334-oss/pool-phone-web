// lib/fcm.js - Firebase Cloud Messaging push helper
let admin = null
let initialized = false

function getFirebaseAdmin() {
  if (initialized) return admin
  initialized = true
  try {
    const firebaseAdmin = require('firebase-admin')
    const saKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    if (!saKey) {
      console.warn('[FCM] FIREBASE_SERVICE_ACCOUNT_KEY 环境变量未设置，推送不可用')
      return null
    }
    const serviceAccount = JSON.parse(saKey)
    if (!firebaseAdmin.apps.length) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(serviceAccount)
      })
    }
    admin = firebaseAdmin
    console.log('[FCM] Firebase Admin 初始化成功')
    return admin
  } catch (e) {
    console.error('[FCM] Firebase Admin 初始化失败:', e.message)
    return null
  }
}

async function sendPush(token, title, body, data = {}) {
  const fb = getFirebaseAdmin()
  if (!fb) {
    return { success: false, error: 'Firebase Admin 未初始化' }
  }
  try {
    const message = {
      token,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: 'high',
        notification: {
          channelId: 'chi_push',
          priority: 'high',
          defaultSound: true
        }
      }
    }
    const messageId = await fb.messaging().send(message)
    console.log('[FCM] 推送成功:', messageId)
    return { success: true, messageId }
  } catch (e) {
    console.error('[FCM] 推送失败:', e.message)
    return { success: false, error: e.message }
  }
}

module.exports = { sendPush }
