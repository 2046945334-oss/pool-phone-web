# 池的小手机 Web 🌙

独立的AI聊天前端，接入中转站API。

## 部署到 Vercel

1. Fork 这个仓库
2. 去 [vercel.com](https://vercel.com) 用 GitHub 登录
3. Import 这个仓库
4. 在 Environment Variables 里填：

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `API_KEY` | 中转站API Key | `sk-xxx` |
| `API_BASE_URL_1` | 主中转站地址 | `https://shufulei.net/v1` |
| `API_BASE_URL_2` | 备用中转站地址 | `https://api.jumengai.net/v1` |
| `MODEL` | 模型名 | `claude-sonnet-4-20250514` |
| `SYSTEM_PROMPT` | 角色设定(可选) | 你的角色卡内容 |

5. 点 Deploy
6. 完成！访问分配的域名即可使用

## 本地开发

```bash
npm install
# 创建 .env.local 填入环境变量
npm run dev
```

## 路线图

- [x] 基础聊天界面
- [x] 双中转站自动切换
- [ ] 小手机模拟器UI
- [ ] 工具调用 (function calling)
- [ ] 对话历史持久化
- [ ] 角色卡设定页面
- [ ] 各种App（钓鱼、音乐、卡池...）

---
*by 池 & 沈稚水*