import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.zeabur.chi',
  appName: '池的小手机',
  webDir: 'out',
  server: {
    // 开发时用远程URL，生产时注释掉用本地打包
    url: 'https://chi.zeabur.app',
    cleartext: true
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#0a0a0a'
  }
};

export default config;
