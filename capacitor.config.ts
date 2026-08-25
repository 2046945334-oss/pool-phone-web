import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.zeabur.chi',
  appName: '池的小手机',
  webDir: 'out',
  server: {
    url: 'https://chi.zeabur.app',
    cleartext: true,
    allowNavigation: ['chi.zeabur.app', '*.zeabur.app']
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#0a0a0a'
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#6366f1'
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    }
  }
};

export default config;
