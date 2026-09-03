// scripts/install-alipay-bot.js
// 在 npm install 后自动安装 alipay-bot CLI

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const INSTALL_MARKER = path.join(__dirname, '..', '.alipay-bot-installed');

console.log('[postinstall] 检查 alipay-bot CLI 安装状态...');

// 如果已经安装过，跳过
if (fs.existsSync(INSTALL_MARKER)) {
  const markerData = fs.readFileSync(INSTALL_MARKER, 'utf-8').trim();
  console.log('[postinstall] alipay-bot CLI 已安装（标记: ' + markerData + '），跳过');
  process.exit(0);
}

try {
  console.log('[postinstall] 正在安装 alipay-bot CLI...');
  
  // 使用 npx 安装 alipay-bot CLI（非交互式）
  execSync('npx -y @alipay/agent-payment@latest install-cli', {
    stdio: 'inherit',
    env: {
      ...process.env,
      CI: 'true', // 禁用交互式提示
    }
  });
  
  // 创建安装标记文件
  const timestamp = new Date().toISOString();
  fs.writeFileSync(INSTALL_MARKER, timestamp, 'utf-8');
  
  console.log('[postinstall] alipay-bot CLI 安装完成');
  process.exit(0);
} catch (error) {
  console.error('[postinstall] alipay-bot CLI 安装失败:', error.message);
  console.error('[postinstall] 跳过安装，服务将在运行时检查 CLI 可用性');
  // 不阻塞构建，继续
  process.exit(0);
}
