# 支付宝AI付集成指南

## 概览

本项目已集成支付宝AI付能力，可让前端AI在聊天中发起真实支付操作。

## 架构

```
前端AI (chi.zeabur.app)
  ↓ 工具调用
后端API (/api/alipay/*)
  ↓ 执行命令
alipay-bot CLI (Zeabur服务器)
  ↓ HTTP请求
支付宝服务器
```

## API端点

### 1. 检查钱包状态
```
GET /api/alipay/check-wallet
```

返回示例（未开通）：
```json
{
  "code": 500,
  "message": "查询失败"
}
```

### 2. 申请开通钱包
```
POST /api/alipay/apply-wallet
```

### 3. 绑定钱包
```
POST /api/alipay/bind-wallet
Content-Type: application/json

{
  "code": "123456"
}
```

## 初始化流程

### 步骤1：检查钱包状态
```bash
curl https://chi.zeabur.app/api/alipay/check-wallet
```

### 步骤2：申请开通（如果未开通）
```bash
curl -X POST https://chi.zeabur.app/api/alipay/apply-wallet
```

从返回结果中复制 `access_url`，在支付宝App中打开。

### 步骤3：完成授权并提交绑定码
```bash
curl -X POST https://chi.zeabur.app/api/alipay/bind-wallet \
  -H "Content-Type: application/json" \
  -d '{"code":"123456"}'
```

## 注意事项

1. **凭证持久化**：Zeabur重新部署会清空凭证，需要重新绑定。
2. **安全性**：绑定码有5分钟有效期。
3. **架构限制**：仅支持x86-64，无法在ARM设备上运行。
