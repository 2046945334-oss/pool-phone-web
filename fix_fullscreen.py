with open('pages/index.js', 'rb') as f:
    c = f.read()

# The actual pattern uses 4-space indent and different style format
# Find: return (\n    <div className="app-page">
old = b'return (\n    <div className="app-page">'
idx = c.find(old)
print(f'Found at: {idx}')

if idx > 0:
    # Insert dwell fullscreen check right before the return
    insert = (
        b"if (currentApp === 'dwell' && isHtml) {\n"
        b"    return (<div style={{position:'absolute',inset:0,zIndex:100}}>"
        b"<HtmlApp htmlContent={htmlContent} />"
        b"<button onClick={handleBack} style={{position:'absolute',top:8,left:8,zIndex:101,background:'rgba(0,0,0,0.3)',color:'#fff',border:'none',borderRadius:'50%',width:32,height:32,fontSize:16,cursor:'pointer'}}>{'\\u2190'}</button>"
        b"</div>)\n"
        b"  }\n  "
    )
    c = c[:idx] + insert + c[idx:]
    print('Inserted dwell fullscreen')

with open('pages/index.js', 'wb') as f:
    f.write(c)
print(f'Size: {len(c)}')