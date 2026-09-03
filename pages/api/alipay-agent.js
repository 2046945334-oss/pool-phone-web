// pages/api/alipay-agent.js - 支付宝Agent工具API封装
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { command, args = [] } = req.body

  // 白名单命令，防止恶意执行
  const allowedCommands = [
    'check-wallet',
    '402-buyer-pay',
    '402-query-payment-status',
    'apply-wallet',
    'bind-wallet',
    'submit-payment',
    'query-payment-status'
  ]

  if (!command || !allowedCommands.includes(command)) {
    return res.status(400).json({ 
      error: 'Invalid command',
      allowedCommands 
    })
  }

  try {
    // 构建命令
    const cmdStr = `alipay-bot ${command} ${args.join(' ')}`
    
    console.log('[Alipay Agent] Executing:', cmdStr)
    
    // 执行命令，设置超时30秒
    const { stdout, stderr } = await execAsync(cmdStr, {
      timeout: 30000,
      maxBuffer: 1024 * 1024 // 1MB
    })

    // 尝试解析JSON输出
    let result = stdout.trim()
    try {
      result = JSON.parse(result)
    } catch (e) {
      // 如果不是JSON，保持原样
    }

    res.status(200).json({
      success: true,
      command,
      result,
      stderr: stderr || undefined
    })

  } catch (error) {
    console.error('[Alipay Agent] Error:', error)
    res.status(500).json({
      success: false,
      error: error.message,
      stderr: error.stderr || undefined
    })
  }
}
