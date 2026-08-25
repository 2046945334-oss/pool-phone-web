// 通知服务 - 本地通知 + 推送通知
// 在前端 JS 中通过 window.ChiNotifications 调用

(function() {
  // 检测是否在 Capacitor 原生环境
  const isNative = typeof window !== 'undefined' && 
    window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

  if (!isNative) {
    console.log('[通知] 非原生环境，通知功能不可用');
    window.ChiNotifications = {
      scheduleLocal: () => Promise.resolve(),
      cancelAll: () => Promise.resolve(),
      init: () => Promise.resolve(),
      isNative: false
    };
    return;
  }

  // ===== 本地通知 =====
  async function initLocalNotifications() {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      
      // 请求权限
      const perm = await LocalNotifications.requestPermissions();
      console.log('[本地通知] 权限状态:', perm.display);

      // 监听通知点击
      LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
        console.log('[本地通知] 用户点击:', notification);
        // 可以根据 notification.notification.extra 做页面跳转
        if (notification.notification.extra && notification.notification.extra.app) {
          window.dispatchEvent(new CustomEvent('chi-open-app', { 
            detail: { app: notification.notification.extra.app } 
          }));
        }
      });

      return LocalNotifications;
    } catch (e) {
      console.error('[本地通知] 初始化失败:', e);
      return null;
    }
  }

  // 发送本地通知
  async function scheduleLocal(options) {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const id = options.id || Math.floor(Math.random() * 100000);
    
    const notif = {
      id,
      title: options.title || '池的小手机',
      body: options.body || '',
      schedule: options.at ? { at: new Date(options.at) } : undefined,
      extra: options.extra || {},
      smallIcon: 'ic_stat_icon_config_sample', // 默认小图标
      iconColor: '#6366f1'
    };

    await LocalNotifications.schedule({ notifications: [notif] });
    console.log('[本地通知] 已调度:', notif);
    return id;
  }

  // 立即弹出本地通知
  async function showNow(title, body, extra) {
    return scheduleLocal({ title, body, extra });
  }

  // 取消所有本地通知
  async function cancelAll() {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({ notifications: pending.notifications });
    }
  }

  // ===== 推送通知 (FCM) =====
  async function initPushNotifications() {
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      
      // 请求权限
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') {
        console.log('[推送通知] 权限未授予');
        return null;
      }

      // 注册推送
      await PushNotifications.register();

      // 获取 FCM token
      PushNotifications.addListener('registration', (token) => {
        console.log('[推送通知] FCM Token:', token.value);
        // 将 token 发送到后端保存
        fetch('/api/push-register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token.value })
        }).catch(e => console.error('[推送通知] 注册到后端失败:', e));
        
        // 也存到 localStorage 备用
        localStorage.setItem('chi_fcm_token', token.value);
      });

      // 注册失败
      PushNotifications.addListener('registrationError', (error) => {
        console.error('[推送通知] 注册失败:', error);
      });

      // 收到推送（前台）
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('[推送通知] 收到:', notification);
        // 前台时可以显示自定义 toast 或弹窗
        window.dispatchEvent(new CustomEvent('chi-push-received', { detail: notification }));
      });

      // 用户点击推送
      PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
        console.log('[推送通知] 用户点击:', notification);
        if (notification.notification.data && notification.notification.data.app) {
          window.dispatchEvent(new CustomEvent('chi-open-app', { 
            detail: { app: notification.notification.data.app } 
          }));
        }
      });

      return PushNotifications;
    } catch (e) {
      console.error('[推送通知] 初始化失败:', e);
      return null;
    }
  }

  // ===== 初始化 =====
  async function init() {
    await initLocalNotifications();
    await initPushNotifications();
    console.log('[通知] 全部初始化完成');
  }

  // 暴露到全局
  window.ChiNotifications = {
    init,
    scheduleLocal,
    showNow,
    cancelAll,
    isNative: true
  };

  // 页面加载后自动初始化
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
