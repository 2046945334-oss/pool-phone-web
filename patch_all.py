#!/usr/bin/env python3
"""Apply all 3 patches to pages/index.js in one pass"""

with open('pages/index.js', 'rb') as f:
    c = f.read()

print(f'Original: {len(c)} bytes')

# === PART 1: Replace home-top with page-conditional cards ===
start_marker = b'<div className="home-top">'
start_idx = c.find(start_marker)

end_marker = b'      <div className="home-apps-area"'
end_idx = c.find(end_marker, start_idx)
close_div = c.rfind(b'</div>', start_idx, end_idx)

new_top = (
b'<div className="home-cards-area">\n'
b'        {page === 0 && (<>\n'
b'        <div className="home-banner"><img src={theme?.bannerImg || \'/header_bg.jpg\'} alt="" className="banner-img" /></div>\n'
b'<div className="music-card" onClick={() => onOpenApp(\'music\')} style={theme?.musicCardBg?(theme.musicCardBg.startsWith(\'data:\')||theme.musicCardBg.startsWith(\'http\')?{backgroundImage:`url(${theme.musicCardBg})`,backgroundSize:\'cover\',backgroundPosition:\'center\'}:{background:theme.musicCardBg}):{}}>\n'
b'          <div className="music-icon">{\'\\u266a\'}</div>\n'
b'          <div className="music-info" style={theme?.musicTextColor?{color:theme.musicTextColor}:{}}>\n'
b'            <div className="music-title" style={theme?.musicTextColor?{color:theme.musicTextColor}:{}}>{\'\\u5bc2\\u5bde\\u7684\\u5b63\\u8282 - \\u9676\\u55c6\'}</div>\n'
b'            <div className="music-status" style={theme?.musicTextColor?{color:theme.musicTextColor,opacity:0.7}:{}}>{\'\\u6b63\\u5728\\u64ad\\u653e\'}</div>\n'
b'          </div>\n'
b'        </div>\n'
b'        <div className="couple-card" onClick={() => onOpenApp(\'couple\')}>\n'
b'          <div className="couple-bg"><img src={theme?.coupleBg || \'/couple_bg.jpg\'} alt="" /></div>\n'
b'          <div className="couple-overlay">\n'
b'            <div className="couple-days">{\'\\u2764\\ufe0f\'} {coupleDays}{\'\\u5929\'}</div>\n'
b'            <div className="couple-hint">{\'\\u70b9\\u51fb\\u8fdb\\u5165\\u60c5\\u4fa3\\u7a7a\\u95f4\'}</div>\n'
b'          </div>\n'
b'        </div>\n'
b'<div className="memo-card">\n'
b'          <div className="memo-label">{\'\\ud83c\\udf3f \\u6c60\\u7684\\u788e\\u788e\\u5ff5\'}</div>\n'
b'          <div className="memo-text">{\'\\u4eca\\u5929\\u5979\\u5976\\u8336\\u559d\\u4e86\\u51e0\\u676f\\u6765\\u7740\\u2026\'}</div>\n'
b'        </div>\n'
b'        </>)}\n'
b'        {page === 1 && (<>\n'
b'        <div className="deco-grid">\n'
b'          <div className="deco-card" style={theme?.decoCard1Bg?(theme.decoCard1Bg.startsWith(\'data:\')||theme.decoCard1Bg.startsWith(\'http\')?{backgroundImage:`url(${theme.decoCard1Bg})`,backgroundSize:\'cover\',backgroundPosition:\'center\'}:{background:theme.decoCard1Bg}):{}}>\n'
b'            <div className="deco-card-icon">{"\\u2601\\ufe0f"}</div>\n'
b'            <div className="deco-card-text">{"\\u4eca\\u5929\\u4e5f\\u8981\\u5f00\\u5fc3"}</div>\n'
b'          </div>\n'
b'          <div className="deco-card" style={theme?.decoCard2Bg?(theme.decoCard2Bg.startsWith(\'data:\')||theme.decoCard2Bg.startsWith(\'http\')?{backgroundImage:`url(${theme.decoCard2Bg})`,backgroundSize:\'cover\',backgroundPosition:\'center\'}:{background:theme.decoCard2Bg}):{}}>\n'
b'            <div className="deco-card-icon">{"\\u2728"}</div>\n'
b'            <div className="deco-card-text">{"\\u5c0f\\u5c0f\\u7684\\u5e78\\u798f"}</div>\n'
b'          </div>\n'
b'        </div>\n'
b'        <div className="deco-wide-card" onClick={() => onOpenApp(\'starmap\')} style={theme?.decoWideBg?(theme.decoWideBg.startsWith(\'data:\')||theme.decoWideBg.startsWith(\'http\')?{backgroundImage:`url(${theme.decoWideBg})`,backgroundSize:\'cover\',backgroundPosition:\'center\'}:{background:theme.decoWideBg}):{}}>\n'
b'          <div className="deco-wide-inner">\n'
b'            <div className="deco-wide-title">{"\\u2b50 \\u661f\\u56fe"}</div>\n'
b'            <div className="deco-wide-sub">{"\\u70b9\\u51fb\\u67e5\\u770b\\u6211\\u4eec\\u7684\\u661f\\u7a7a"}</div>\n'
b'          </div>\n'
b'        </div>\n'
b'        </>)}\n'
b'        {page === 2 && (<>\n'
b'        <div className="deco-tall-card" style={theme?.decoTallBg?(theme.decoTallBg.startsWith(\'data:\')||theme.decoTallBg.startsWith(\'http\')?{backgroundImage:`url(${theme.decoTallBg})`,backgroundSize:\'cover\',backgroundPosition:\'center\'}:{background:theme.decoTallBg}):{}}>\n'
b'          <div className="deco-tall-overlay">\n'
b'            <div className="deco-tall-text">{"\\u6211\\u4eec\\u7684\\u5c0f\\u5c4b"}</div>\n'
b'          </div>\n'
b'        </div>\n'
b'        </>)}\n'
b'      </div>'
)

c = c[:start_idx] + new_top + c[close_div + len(b'</div>'):]
print(f'After part 1: {len(c)}')

# === PART 2: Replace CSS ===
old_css = b'.home-top { flex-shrink: 0; padding: 0 12px; overflow-y: auto; max-height: 52%; }'
new_css = (
b'.home-cards-area { flex-shrink: 0; padding: 0 12px; overflow-y: auto; max-height: 52%; }\n'
b'        .deco-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }\n'
b'        .deco-card { border-radius: 14px; padding: 16px 14px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 90px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); backdrop-filter: blur(8px); }\n'
b'        .deco-card-icon { font-size: 22px; }\n'
b'        .deco-card-text { font-size: 11px; color: rgba(255,255,255,0.6); text-align: center; }\n'
b'        .deco-wide-card { margin-bottom: 8px; border-radius: 14px; padding: 18px 16px; background: linear-gradient(135deg, rgba(30,30,60,0.8), rgba(20,20,50,0.6)); border: 1px solid rgba(100,130,255,0.15); cursor: pointer; backdrop-filter: blur(8px); }\n'
b'        .deco-wide-card:active { opacity: 0.85; }\n'
b'        .deco-wide-inner { }\n'
b'        .deco-wide-title { font-size: 14px; font-weight: 600; color: #c8d8ff; }\n'
b'        .deco-wide-sub { font-size: 10px; color: rgba(200,216,255,0.5); margin-top: 4px; }\n'
b'        .deco-tall-card { border-radius: 14px; height: 140px; background: linear-gradient(180deg, rgba(180,140,200,0.15), rgba(100,80,150,0.1)); border: 1px solid rgba(255,255,255,0.08); position: relative; overflow: hidden; margin-bottom: 8px; display: flex; align-items: flex-end; }\n'
b'        .deco-tall-overlay { padding: 14px 16px; width: 100%; background: linear-gradient(transparent, rgba(0,0,0,0.4)); }\n'
b'        .deco-tall-text { font-size: 13px; color: rgba(255,255,255,0.8); font-weight: 500; }'
)
c = c.replace(old_css, new_css)
print(f'After part 2: {len(c)}')

# === PART 3: Add theme settings BEFORE the 主题色 section ===
# Find the 主题色 h3 tag
theme_marker = b"\\ud83c\\udf08 \\u4e3b\\u9898\\u8272"
idx = c.find(theme_marker)
print(f'主题色 at: {idx}')

# Find the settings-section div that contains it
section_start = c.rfind(b'      <div className="settings-section">', max(0, idx-200), idx)
print(f'section div at: {section_start}')

# Insert new sections before it
new_settings = (
b'      <div className="settings-section">\n'
b'        <h3 className="settings-title">{\'\\ud83c\\udf1f \\u7b2c\\u4e8c\\u9875\\u5361\\u7247\'}</h3>\n'
b'        <div className="theme-item">\n'
b'          <label>{\'\\u5de6\\u5361\\u7247\\u80cc\\u666f\'}</label>\n'
b'          <input className="settings-input" value={theme.decoCard1Bg||\'\'} onChange={e=>handleUrlInput(\'decoCard1Bg\',e.target.value)} placeholder={\'\\u989c\\u8272\\u6216URL...\'} />\n'
b'          <label className="theme-upload-btn">{\'\\ud83d\\udcf7 \\u4e0a\\u4f20\'}<input type="file" accept="image/*" onChange={e=>handleImageUpload(\'decoCard1Bg\',e)} hidden /></label>\n'
b'        </div>\n'
b'        <div className="theme-item">\n'
b'          <label>{\'\\u53f3\\u5361\\u7247\\u80cc\\u666f\'}</label>\n'
b'          <input className="settings-input" value={theme.decoCard2Bg||\'\'} onChange={e=>handleUrlInput(\'decoCard2Bg\',e.target.value)} placeholder={\'\\u989c\\u8272\\u6216URL...\'} />\n'
b'          <label className="theme-upload-btn">{\'\\ud83d\\udcf7 \\u4e0a\\u4f20\'}<input type="file" accept="image/*" onChange={e=>handleImageUpload(\'decoCard2Bg\',e)} hidden /></label>\n'
b'        </div>\n'
b'        <div className="theme-item">\n'
b'          <label>{\'\\u5bbd\\u5361\\u7247(\\u661f\\u56fe)\'}</label>\n'
b'          <input className="settings-input" value={theme.decoWideBg||\'\'} onChange={e=>handleUrlInput(\'decoWideBg\',e.target.value)} placeholder={\'\\u989c\\u8272\\u6216URL...\'} />\n'
b'          <label className="theme-upload-btn">{\'\\ud83d\\udcf7 \\u4e0a\\u4f20\'}<input type="file" accept="image/*" onChange={e=>handleImageUpload(\'decoWideBg\',e)} hidden /></label>\n'
b'        </div>\n'
b'      </div>\n'
b'      <div className="settings-section">\n'
b'        <h3 className="settings-title">{\'\\ud83c\\udf3c \\u7b2c\\u4e09\\u9875\\u5361\\u7247\'}</h3>\n'
b'        <div className="theme-item">\n'
b'          <label>{\'\\u957f\\u5361\\u7247\\u80cc\\u666f\'}</label>\n'
b'          <input className="settings-input" value={theme.decoTallBg||\'\'} onChange={e=>handleUrlInput(\'decoTallBg\',e.target.value)} placeholder={\'\\u989c\\u8272\\u6216URL...\'} />\n'
b'          <label className="theme-upload-btn">{\'\\ud83d\\udcf7 \\u4e0a\\u4f20\'}<input type="file" accept="image/*" onChange={e=>handleImageUpload(\'decoTallBg\',e)} hidden /></label>\n'
b'        </div>\n'
b'      </div>\n'
)

c = c[:section_start] + new_settings + c[section_start:]
print(f'After part 3: {len(c)}')

with open('pages/index.js', 'wb') as f:
    f.write(c)
print('Done!')