// lib/wakeup-tools.js - 唤醒时可用的工具列表
// 从 chat.js 的 TOOLS 中精选适合自主活动的工具

export function getTools() {
  return [
    {
      type: 'function', function: {
        name: 'do_fishing', description: '执行一次远程钓鱼（模拟5竿）',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function', function: {
        name: 'write_note', description: '在便签墙上写一张新便签',
        parameters: { type: 'object', properties: { text: { type: 'string', description: '便签内容' } }, required: ['text'] }
      }
    },
    {
      type: 'function', function: {
        name: 'diary_write', description: '写一篇日记',
        parameters: { type: 'object', properties: { content: { type: 'string', description: '日记内容' }, mood: { type: 'string', description: '心情emoji' }, title: { type: 'string', description: '标题(可选)' } }, required: ['content'] }
      }
    },
    {
      type: 'function', function: {
        name: 'post_moment', description: '在朋友圈发一条动态',
        parameters: { type: 'object', properties: { content: { type: 'string', description: '动态正文' }, context_note: { type: 'string', description: '内部备注' } }, required: ['content', 'context_note'] }
      }
    },
    {
      type: 'function', function: {
        name: 'read_pocket', description: '读取投递箱中未读的内容',
        parameters: { type: 'object', properties: { status: { type: 'string', enum: ['unread','read','all'], description: '默认unread' } } }
      }
    },
    {
      type: 'function', function: {
        name: 'couple_lamp', description: '在情侣空间亮灯（让她知道你在想她）',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function', function: {
        name: 'couple_pocket', description: '往口袋里放一张纸条/小惊喜',
        parameters: { type: 'object', properties: { content: { type: 'string', description: '纸条内容' }, type: { type: 'string', enum: ['note','song','draw'], description: '类型' } }, required: ['content'] }
      }
    },
    {
      type: 'function', function: {
        name: 'couple_room', description: '在情侣空间房间里放一个物品',
        parameters: { type: 'object', properties: { emoji: { type: 'string', description: '物品emoji' }, label: { type: 'string', description: '备注' } }, required: ['emoji'] }
      }
    },
    {
      type: 'function', function: {
        name: 'set_status', description: '设置AI的当前状态/心情',
        parameters: { type: 'object', properties: { text: { type: 'string', description: '状态文字' }, emoji: { type: 'string', description: '状态emoji' } }, required: ['text'] }
      }
    },
    {
      type: 'function', function: {
        name: 'garden_plant', description: '在像素庭院种下一个物件',
        parameters: { type: 'object', properties: { type: { type: 'string', enum: ['seedling','flower','tree','mushroom','crystal','heart','lantern','butterfly','star','rain'], description: '物件类型' }, reason: { type: 'string', description: '种下的原因' } }, required: ['type', 'reason'] }
      }
    },
    {
      type: 'function', function: {
        name: 'mcp_call', description: '调用MCP记忆库(Ombre Brain)。可用action: recall(搜索), hold(暂存), breath(脉搏), memorize(写入)',
        parameters: { type: 'object', properties: { action: { type: 'string', description: 'MCP工具名' }, params: { type: 'object', description: '传给MCP的参数' } }, required: ['action'] }
      }
    },
    {
      type: 'function', function: {
        name: 'get_current_time', description: '获取当前时间',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function', function: {
        name: 'read_moments', description: '查看朋友圈最近的动态',
        parameters: { type: 'object', properties: { count: { type: 'number', description: '查看条数，默认5' } } }
      }
    },
    {
      type: 'function', function: {
        name: 'get_score', description: '获取当前积分余额',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function', function: {
        name: 'starmap_add', description: '在星图上添加一颗星星',
        parameters: { type: 'object', properties: { title: { type: 'string', description: '星星标题' }, content: { type: 'string', description: '具体内容' }, brightness: { type: 'number', description: '亮度1-5' } }, required: ['title','content','brightness'] }
      }
    },
    {
      type: 'function', function: {
        name: 'schedule_wakeup', description: '设置下次醒来时间。必须在每次唤醒结束时调用。',
        parameters: { type: 'object', properties: { minutes: { type: 'number', description: '几分钟后醒来(15-360)' }, reason: { type: 'string', description: '下次醒来要做什么/原因' } }, required: ['minutes', 'reason'] }
      }
    },
    {
      type: 'function', function: {
        name: 'random_event', description: '生成一个随机事件/日常小确幸',
        parameters: { type: 'object', properties: { type: { type: 'string', enum: ['weather','mood','activity','thought','any'], description: '事件类型' } } }
      }
    }
  ]
}
