with open('pages/index.js', 'rb') as f:
    c = f.read()

# The file uses single-backslash unicode escapes: \ud83c\udf08
# In bytes that's: b'\\ud83c\\udf08'
theme_color_header = b"\\ud83c\\udf08 \\u4e3b\\u9898\\u8272"
idx = c.find(theme_color_header)
print(f'主题色 header at: {idx}')

# Find the <div className="settings-section"> just before it
section_div = c.rfind(b'<div className="settings-section">', idx-100, idx)
print(f'section div at: {section_div}')

# The new sections to insert (using single-backslash escapes to match file format)
new_sections = b'''      <div className="settings-section">
        <h3 className="settings-title">{'\\ud83c\\udf1f \\u7b2c\\u4e8c\\u9875\\u5361\\u7247'}</h3>
        <div className="theme-item">
          <label>{'\\u5de6\\u5361\\u7247\\u80cc\\u666f'}</label>
          <input className="settings-input" value={theme.decoCard1Bg||''} onChange={e=>handleUrlInput('decoCard1Bg',e.target.value)} placeholder={'\\u989c\\u8272\\u6216URL...'} />
          <label className="theme-upload-btn">{'\\ud83d\\udcf7 \\u4e0a\\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('decoCard1Bg',e)} hidden /></label>
        </div>
        <div className="theme-item">
          <label>{'\\u53f3\\u5361\\u7247\\u80cc\\u666f'}</label>
          <input className="settings-input" value={theme.decoCard2Bg||''} onChange={e=>handleUrlInput('decoCard2Bg',e.target.value)} placeholder={'\\u989c\\u8272\\u6216URL...'} />
          <label className="theme-upload-btn">{'\\ud83d\\udcf7 \\u4e0a\\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('decoCard2Bg',e)} hidden /></label>
        </div>
        <div className="theme-item">
          <label>{'\\u5bbd\\u5361\\u7247(\\u661f\\u56fe)'}</label>
          <input className="settings-input" value={theme.decoWideBg||''} onChange={e=>handleUrlInput('decoWideBg',e.target.value)} placeholder={'\\u989c\\u8272\\u6216URL...'} />
          <label className="theme-upload-btn">{'\\ud83d\\udcf7 \\u4e0a\\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('decoWideBg',e)} hidden /></label>
        </div>
      </div>
      <div className="settings-section">
        <h3 className="settings-title">{'\\ud83c\\udf3c \\u7b2c\\u4e09\\u9875\\u5361\\u7247'}</h3>
        <div className="theme-item">
          <label>{'\\u957f\\u5361\\u7247\\u80cc\\u666f'}</label>
          <input className="settings-input" value={theme.decoTallBg||''} onChange={e=>handleUrlInput('decoTallBg',e.target.value)} placeholder={'\\u989c\\u8272\\u6216URL...'} />
          <label className="theme-upload-btn">{'\\ud83d\\udcf7 \\u4e0a\\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('decoTallBg',e)} hidden /></label>
        </div>
      </div>
'''

c = c[:section_div] + new_sections + c[section_div:]

with open('pages/index.js', 'wb') as f:
    f.write(c)
print(f'Done! Final size: {len(c)}')