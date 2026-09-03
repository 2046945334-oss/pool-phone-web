// pages/api/alipay/check-wallet.js
// 检查支付宝AI钱包状态

const { execSync } = require('child_process');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 执行 alipay-bot check-wallet
    const output = execSync('alipay-bot check-wallet', {
      encoding: 'utf-8',
      timeout: 30000,
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`,
      }
    });

    // 解析 JSON 输出
    const result = JSON.parse(output.trim());
    return res.status(200).json(result);
  } catch (error) {
    console.error('[alipay/check-wallet] Error:', error.message);
    
    // 如果是 JSON 格式的错误输出，解析后返回
    try {
      const errorOutput = error.stdout || error.stderr || '';
      const errorJson = JSON.parse(errorOutput.trim());
      return res.status(200).json(errorJson);
    } catch {
      // 否则返回通用错误
      return res.status(500).json({
        code: 500,
        message: '查询失败',
        reason: error.message
      });
    }
  }
}
