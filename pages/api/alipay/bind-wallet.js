// pages/api/alipay/bind-wallet.js
// 绑定支付宝AI钱包（输入授权码）

const { execSync } = require('child_process');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code } = req.body;

  if (!code || typeof code !== 'string' || code.trim().length !== 6) {
    return res.status(400).json({
      error: 'Invalid authorization code',
      message: '授权码必须是6位数字'
    });
  }

  try {
    // 执行 alipay-bot bind-wallet -c <授权码>
    const output = execSync(`alipay-bot bind-wallet -c "${code.trim()}"`, {
      encoding: 'utf-8',
      timeout: 60000,
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`,
        AIPAY_OUTPUT_CHANNEL: 'json',
      }
    });

    // 尝试解析 JSON 输出
    try {
      const result = JSON.parse(output.trim());
      return res.status(200).json(result);
    } catch {
      // 如果不是 JSON，返回原始输出
      return res.status(200).json({
        success: true,
        output: output.trim()
      });
    }
  } catch (error) {
    console.error('[alipay/bind-wallet] Error:', error.message);
    
    // 尝试解析错误输出
    const errorOutput = (error.stdout || error.stderr || '').trim();
    
    try {
      const errorJson = JSON.parse(errorOutput);
      return res.status(200).json(errorJson);
    } catch {
      return res.status(500).json({
        code: 500,
        message: '绑定失败',
        reason: error.message,
        output: errorOutput
      });
    }
  }
}
