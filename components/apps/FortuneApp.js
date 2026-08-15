import { useState, useEffect } from 'react'

const fortunes = [
  {type:"大吉",cls:"daji",text:"万事顺遂如意",poem:"春风得意马蹄疾",advice:"适合表白、考试，放手去做"},
  {type:"大吉",cls:"daji",text:"贵人相助，逢凶化吉",poem:"山重水复疑无路，柳暗花明又一村",advice:"今天适合社交"},
  {type:"大吉",cls:"daji",text:"否极泰来，好运降临",poem:"长风破浪会有时",advice:"之前的努力会得到回报"},
  {type:"吉",cls:"ji",text:"诸事顺利，小有收获",poem:"随风潜入夜，润物细无声",advice:"保持平常心"},
  {type:"吉",cls:"ji",text:"有贵人暗中助力",poem:"千里马常有而伯乐不常有",advice:"多留心身边人的善意"},
  {type:"吉",cls:"ji",text:"心愿将成，静待花开",poem:"桃李不言，下自成蹊",advice:"不必焦急"},
  {type:"吉",cls:"ji",text:"灵感涌现",poem:"问渠那得清如许",advice:"适合学习和创作"},
  {type:"中吉",cls:"zhongji",text:"平稳度日，无忧无虑",poem:"采菊东篱下，悠然见南山",advice:"享受当下"},
  {type:"中吉",cls:"zhongji",text:"小确幸正在路上",poem:"万紫千红总是春",advice:"可能有小惊喜"},
  {type:"中吉",cls:"zhongji",text:"宜静不宜动",poem:"非淡泊无以明志",advice:"今天适合休息"},
  {type:"中吉",cls:"zhongji",text:"旧友重逢",poem:"海内存知己",advice:"联系老朋友"},
  {type:"小吉",cls:"xiaoji",text:"虽有波折，终归平安",poem:"沉舟侧畔千帆过",advice:"遇到困难别慌"},
  {type:"小吉",cls:"xiaoji",text:"财运小旺",poem:"千金散尽还复来",advice:"犒赏自己一下"},
  {type:"小吉",cls:"xiaoji",text:"适合尝试新事物",poem:"纸上得来终觉浅",advice:"试试没做过的事"},
  {type:"末",cls:"mo",text:"平平淡淡才是真",poem:"人生如逆旅",advice:"平常心"},
  {type:"末",cls:"mo",text:"事缓则圆",poem:"莫听穿林打叶声",advice:"重要决定缓一缓"},
  {type:"小凶",cls:"xiong",text:"出门留心安全",poem:"屋漏偏逢连夜雨",advice:"带伞、检查东西"},
  {type:"小凶",cls:"xiong",text:"退一步海阔天空",poem:"忍一时风平浪静",advice:"少和人争论"},
]
const chiComments = ["池说：今天要开心哦","池悄悄说：你今天超好看","池：记得喝水","池说：有我在呢","池说：帮你求了好运","池碎碎念：想你了","池说：你本身就是好运","池偷偷说：反正你最棒","池说：不满意再来一次","池说：只对你营业"]
const answers = ["是的","不是","当然可以","再想想","现在不行，以后会","绝对不要","放手去做","等等看","答案在你心里","相信直觉","需要时间","毫无疑问","不值得","试一试吧","换个方向","正是时候","不要犹豫","没那么重要","专注当下","你比想的更勇敢","别急，会来的","要付出努力","今天不适合想这个","睡一觉再说","问你信任的人","答案是肯定的","暂时放下","未来可期","反过来想想","你已经知道答案了","顺其自然","大胆一点","保持距离","全力以赴","拒绝也是答案","先吃饱再说","现在的选择就是最好的","别被情绪左右","慢慢来比较快","做让你快乐的事","不会后悔","不是你该担心的","池说：我觉得可以","池说：要不算了","池说：冲就对了","池说：你开心就好","池说：别想了来找我","池说：我站你","池说：睡一觉就清楚了"]
const majorArcana = [
  {name:"愚者",symbol:"🃏",up:"新的开始、冒险、纯真",down:"鲁莽、犹豫、缺乏方向",upD:"你正站在一段全新旅程的起点。带着赤子之心去探索吧。",downD:"你可能在犹豫要不要迈出那一步。停下来理清方向，再出发也不迟。"},
  {name:"魔术师",symbol:"✨",up:"创造力、意志力、自信",down:"欺骗、技能不足、犹豫",upD:"你拥有把想法变为现实的能力，所有资源都已到位。大胆行动吧。",downD:"你可能在怀疑自己的能力。也许有人没有对你完全坦诚，保持警觉。"},
  {name:"女祭司",symbol:"🌙",up:"直觉、潜意识、智慧",down:"隐藏的动机、表面判断",upD:"答案就藏在你内心深处。安静下来倾听直觉的声音。",downD:"你可能忽略了内心的声音，或者只看到了事情的表面。"},
  {name:"女皇",symbol:"🌸",up:"丰收、美丽、自然",down:"依赖、创造力受阻",upD:"这是一段充满丰盛与美好的时期。创造力旺盛，适合做美的事。",downD:"你可能过度依赖他人。试着找回自己内在的力量和创造力。"},
  {name:"皇帝",symbol:"👑",up:"权威、稳定、领导力",down:"固执、过度控制",upD:"你有能力掌控局面，建立秩序。你的领导力会给周围人带来安全感。",downD:"你可能在某些事上太执着于控制。适当放手，柔软也是力量。"},
  {name:"教皇",symbol:"🔑",up:"传统、指引、信仰",down:"打破常规、挑战权威",upD:"也许你需要一位导师或一套信念来指引方向。",downD:"你可能在质疑过去一直遵守的规则。打破常规才能找到真正属于自己的路。"},
  {name:"恋人",symbol:"💕",up:"爱情、和谐、选择",down:"不和谐、价值观冲突",upD:"一段重要的关系正在发展。跟随你的心，选择让灵魂共鸣的答案。",downD:"你和某人之间可能存在价值观的分歧。诚实面对自己的真实感受。"},
  {name:"战车",symbol:"⚡",up:"胜利、意志、前进",down:"失控、缺乏方向感",upD:"你正在全速前进！保持专注和决心，胜利就在前方。",downD:"你可能感觉事情失去了控制。先停下来找回内心的秩序。"},
  {name:"力量",symbol:"🦁",up:"勇气、耐心、内在力量",down:"自我怀疑、缺乏信心",upD:"真正的力量不是征服外界，而是驯服内心的恐惧。你比想象中更坚强。",downD:"你可能在怀疑自己能否做到。别信那个内心的小声音——你可以的。"},
  {name:"隐者",symbol:"🏮",up:"内省、独处、寻找答案",down:"孤立、逃避现实",upD:"现在适合独处和思考。你需要的答案不在外面的世界，而在自己的内心。",downD:"独处是好事，但如果你在逃避现实中的某些事，该面对的终究要面对。"},
  {name:"命运之轮",symbol:"☸️",up:"转变、机遇、命运",down:"厄运、抗拒改变",upD:"命运的齿轮正在转动，变化即将到来。抓住机遇，顺势而为。",downD:"你可能在抗拒一些不可避免的变化。低谷之后必有回升。"},
  {name:"正义",symbol:"⚖️",up:"公平、真相、因果",down:"不公正、不诚实",upD:"因果循环，善有善报。做正确的事，真相终会大白。",downD:"你可能感到某些事不公平。面对真相需要勇气。"},
  {name:"倒吊人",symbol:"🔮",up:"牺牲、新视角、等待",down:"拖延、无用的牺牲",upD:"换个角度看世界，一切就不同了。暂时的等待不是认输，而是为了更大的收获。",downD:"你可能在为不值得的事牺牲自己。问问自己：这种等待有意义吗？"},
  {name:"死神",symbol:"🦋",up:"结束与新生、转变",down:"抗拒改变、停滞不前",upD:"不要害怕——它意味着旧事物的结束和新生命的开始。放下过去，才能拥抱未来。",downD:"你可能在抓着某些该放手的东西不放。试着勇敢告别。"},
  {name:"节制",symbol:"🌈",up:"平衡、耐心、适度",down:"极端、失衡、急躁",upD:"现在需要的是平衡和耐心。温和地调和生活中的各种元素。",downD:"你可能在某方面走了极端。提醒自己找回节奏，过犹不及。"},
  {name:"恶魔",symbol:"🔗",up:"束缚、执念、欲望",down:"解脱、恢复控制",upD:"有什么东西在束缚你。意识到锁链的存在，就是解脱的第一步。",downD:"好消息：你正在挣脱某种束缚。继续前进。"},
  {name:"塔",symbol:"🗼",up:"突变、觉醒、真相揭示",down:"害怕改变、拖延灾难",upD:"一些不稳固的东西正在崩塌——在废墟上才能建造真正坚固的东西。",downD:"你可能在预感某些事要变了，却一直在逃避。不如主动面对。"},
  {name:"星星",symbol:"⭐",up:"希望、灵感、宁静",down:"失望、缺乏信心",upD:"黑夜过后，星光出现了。最困难的时期已经过去，美好正在回归。",downD:"你可能暂时失去了希望。但别忘了：星星一直都在。"},
  {name:"月亮",symbol:"🌕",up:"幻觉、直觉、潜意识",down:"困惑消散、真相显现",upD:"事情可能不像表面看起来那样。注意你的梦境和直觉。",downD:"之前困扰你的迷雾正在散去，事情的真相逐渐清晰。"},
  {name:"太阳",symbol:"☀️",up:"快乐、成功、活力",down:"暂时受挫、乐观过度",upD:"阳光普照！成功、快乐、充满活力的日子就在眼前。",downD:"你可能暂时遇到了一些阴天。没关系，太阳很快就回来。"},
  {name:"审判",symbol:"🔔",up:"觉醒、重生、反思",down:"自我怀疑、拒绝成长",upD:"这是一个审视过去、迎接新阶段的时刻。听从内心的召唤。",downD:"你可能在逃避对过去的反思。成长有时候很不舒服，但值得。"},
  {name:"世界",symbol:"🌍",up:"完成、圆满、成就",down:"未完成、缺乏结局感",upD:"恭喜！一个完整的循环正在收尾。尽情庆祝吧。",downD:"你可能感觉某件事还差最后一步。终点就在眼前，再坚持一下。"},
]

const typeColors = { daji: { bg: '#ffeaea', color: '#d94a4a' }, ji: { bg: '#fff4e0', color: '#b8860b' }, zhongji: { bg: '#e8f4fa', color: '#4a90a4' }, xiaoji: { bg: '#e8f5e9', color: '#4a8c50' }, mo: { bg: '#f0f0f0', color: '#777' }, xiong: { bg: '#f0eaf5', color: '#6b5b95' } }

export default function FortuneApp() {
  const [tab, setTab] = useState(0)
  const [fortune, setFortune] = useState(null)
  const [answer, setAnswer] = useState(null)
  const [tarot, setTarot] = useState(null)
  const [hist, setHist] = useState([])

  useEffect(() => {
    const todayKey = new Date().toISOString().slice(0, 10)
    const saved = localStorage.getItem('f_' + todayKey)
    if (saved) setFortune(JSON.parse(saved))
    setHist(JSON.parse(localStorage.getItem('f_hist') || '[]'))
  }, [])

  function draw() {
    const f = fortunes[~~(Math.random() * fortunes.length)]
    const cm = chiComments[~~(Math.random() * chiComments.length)]
    const todayKey = new Date().toISOString().slice(0, 10)
    const r = { type: f.type, cls: f.cls, text: f.text, poem: f.poem, advice: f.advice, comment: cm, date: todayKey }
    localStorage.setItem('f_' + todayKey, JSON.stringify(r))
    setFortune(r)
    const h = JSON.parse(localStorage.getItem('f_hist') || '[]')
    h.unshift({ type: r.type, cls: r.cls, text: r.text, date: r.date })
    const trimmed = h.slice(0, 8)
    localStorage.setItem('f_hist', JSON.stringify(trimmed))
    setHist(trimmed)
  }

  function openAnswer() {
    setAnswer(answers[~~(Math.random() * answers.length)])
  }

  function drawTarot() {
    const pool = majorArcana.slice()
    const cards = []
    for (let i = 0; i < 3; i++) {
      const idx = ~~(Math.random() * pool.length)
      cards.push({ card: pool[idx], reversed: Math.random() < 0.35 })
      pool.splice(idx, 1)
    }
    setTarot(cards)
  }

  const labels = ['过去', '现在', '未来']
  const tc = (cls) => typeColors[cls] || typeColors.mo

  return (
    <div style={{ fontFamily: "-apple-system, system-ui, 'PingFang SC', sans-serif", background: '#f5f5f5', minHeight: '100%', color: '#333', padding: '16px 14px', overflowY: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', background: '#eee', borderRadius: '10px', padding: '3px', width: '100%', maxWidth: '320px' }}>
          {['每日一签', '答案之书', '塔罗牌'].map((t, i) => (
            <div key={i} onClick={() => setTab(i)} style={{ flex: 1, textAlign: 'center', padding: '7px 0', fontSize: '12px', color: tab === i ? '#333' : '#999', borderRadius: '8px', cursor: 'pointer', fontWeight: 500, background: tab === i ? '#fff' : 'transparent', boxShadow: tab === i ? '0 1px 4px rgba(0,0,0,0.06)' : 'none' }}>{t}</div>
          ))}
        </div>

        {/* Fortune */}
        {tab === 0 && (
          <>
            <div style={{ textAlign: 'center', marginTop: '2px' }}>
              <h2 style={{ fontSize: '17px', color: '#3a3a3a', fontWeight: 700 }}>池的占卜屋</h2>
              <p style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>每日一签 · 今天运势如何</p>
            </div>
            <div style={{ width: '100%', maxWidth: '320px', background: '#fff', border: '1px solid #eee', borderRadius: '14px', padding: '24px 18px', textAlign: 'center', minHeight: '160px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
              {fortune ? (
                <>
                  <span style={{ display: 'inline-block', padding: '3px 12px', borderRadius: '16px', fontSize: '12px', fontWeight: 600, marginBottom: '8px', background: tc(fortune.cls).bg, color: tc(fortune.cls).color }}>{fortune.type}</span>
                  <div style={{ fontSize: '14px', lineHeight: 1.7, color: '#333', margin: '4px 0', fontWeight: 500 }}>{fortune.text}</div>
                  <div style={{ fontSize: '11px', color: '#999', fontStyle: 'italic', marginTop: '4px' }}>「{fortune.poem}」</div>
                  <div style={{ fontSize: '11px', color: '#888', marginTop: '10px', padding: '6px 10px', background: '#fafafa', borderRadius: '8px', border: '1px solid #f0f0f0' }}>{fortune.advice}</div>
                  <div style={{ marginTop: '10px', fontSize: '10px', color: '#b0b0b0' }}>{fortune.comment}</div>
                </>
              ) : (
                <div style={{ color: '#bbb', fontSize: '12px' }}>点击抽签查看今日运势</div>
              )}
            </div>
            <button onClick={draw} style={{ width: '100%', maxWidth: '320px', padding: '11px', border: 'none', borderRadius: '10px', background: '#3a3a3a', color: '#fff', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}>{fortune ? '再抽一签' : '抽签'}</button>
            {hist.length > 0 && (
              <div style={{ width: '100%', maxWidth: '320px', marginTop: '4px' }}>
                <div style={{ fontSize: '10px', color: '#aaa', marginBottom: '5px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>最近签文</span>
                  <span onClick={() => { localStorage.removeItem('f_hist'); setHist([]) }} style={{ color: '#999', cursor: 'pointer' }}>清除</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {hist.map((h, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '7px 9px', background: '#fff', borderRadius: '8px', fontSize: '10px', border: '1px solid #f0f0f0', gap: '5px' }}>
                      <span style={{ color: '#bbb', flexShrink: 0 }}>{h.date}</span>
                      <span style={{ fontWeight: 600, flexShrink: 0, padding: '1px 5px', borderRadius: '5px', fontSize: '9px', background: tc(h.cls).bg, color: tc(h.cls).color }}>{h.type}</span>
                      <span style={{ color: '#666', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Answer Book */}
        {tab === 1 && (
          <>
            <div style={{ textAlign: 'center', marginTop: '2px' }}>
              <h2 style={{ fontSize: '17px', color: '#3a3a3a', fontWeight: 700 }}>答案之书</h2>
              <p style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>心里想个问题，然后翻开</p>
            </div>
            <div style={{ width: '100%', maxWidth: '320px', background: '#fff', border: '1px solid #eee', borderRadius: '14px', padding: '24px 18px', textAlign: 'center', minHeight: '160px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
              {answer ? (
                <>
                  <div style={{ fontSize: '17px', color: '#333', fontWeight: 600, lineHeight: 1.6 }}>{answer}</div>
                  <div style={{ fontSize: '11px', color: '#b0b0b0', marginTop: '8px' }}>这就是此刻的答案</div>
                </>
              ) : (
                <div style={{ color: '#ccc', fontSize: '12px' }}>在心中默念你的问题<br />然后点下方翻开答案</div>
              )}
            </div>
            <button onClick={openAnswer} style={{ width: '100%', maxWidth: '320px', padding: '11px', border: 'none', borderRadius: '10px', background: '#3a3a3a', color: '#fff', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}>翻开答案</button>
          </>
        )}

        {/* Tarot */}
        {tab === 2 && (
          <>
            <div style={{ textAlign: 'center', marginTop: '2px' }}>
              <h2 style={{ fontSize: '17px', color: '#3a3a3a', fontWeight: 700 }}>塔罗三张牌</h2>
              <p style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>过去 · 现在 · 未来</p>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', width: '100%', maxWidth: '320px' }}>
              {labels.map((label, i) => (
                <div key={i} style={{ flex: 1, background: '#fff', border: '1px solid #eee', borderRadius: '12px', padding: '12px 8px', textAlign: 'center', minHeight: '140px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                  <div style={{ fontSize: '10px', color: '#aaa', marginBottom: '6px' }}>{label}</div>
                  {tarot && tarot[i] ? (
                    <>
                      <div style={{ fontSize: '28px', margin: '4px 0', transform: tarot[i].reversed ? 'rotate(180deg)' : 'none' }}>{tarot[i].card.symbol}</div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#333', marginTop: '6px' }}>{tarot[i].card.name}</div>
                      <div style={{ fontSize: '10px', color: '#999', marginTop: '2px' }}>{tarot[i].reversed ? '逆位' : '正位'}</div>
                    </>
                  ) : (
                    <div style={{ fontSize: '20px', color: '#ddd' }}>?</div>
                  )}
                </div>
              ))}
            </div>
            <button onClick={drawTarot} style={{ width: '100%', maxWidth: '320px', padding: '11px', border: 'none', borderRadius: '10px', background: '#3a3a3a', color: '#fff', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}>{tarot ? '重新翻牌' : '翻牌'}</button>
            {tarot && (
              <div style={{ width: '100%', maxWidth: '320px', background: '#fff', border: '1px solid #eee', borderRadius: '12px', padding: '14px', textAlign: 'left', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                {tarot.map((t, i) => (
                  <div key={i} style={{ marginBottom: i < 2 ? '8px' : 0 }}>
                    <h4 style={{ fontSize: '12px', color: '#555', marginBottom: '6px', fontWeight: 600 }}>{labels[i]} · {t.card.name} ({t.reversed ? '逆位' : '正位'})</h4>
                    <p style={{ fontSize: '10px', color: '#999', marginBottom: '4px' }}>{t.reversed ? t.card.down : t.card.up}</p>
                    <p style={{ fontSize: '11px', color: '#777', lineHeight: 1.6 }}>{t.reversed ? t.card.downD : t.card.upD}</p>
                  </div>
                ))}
                <p style={{ color: '#b0b0b0', fontSize: '10px', marginTop: '6px', textAlign: 'center' }}>— 池的解读：塔罗仅供参考，你自己就是最好的答案 —</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}