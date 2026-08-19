with open('pages/index.js', 'rb') as f:
    c = f.read()

# Fix the bottom tab click for chat
old = b"onClick={() => { setActiveTab('chat'); setLocked(false) }}"
new = b"onClick={() => { const cs=JSON.parse(localStorage.getItem('pool_theme')||'{}').chatStyle; if(cs==='dwell'){setCurrentApp('dwell');setActiveTab('phone');setLocked(false);return} setActiveTab('chat'); setLocked(false) }}"

if old in c:
    c = c.replace(old, new)
    print('Fixed bottom tab click')
else:
    print('Not found!')

with open('pages/index.js', 'wb') as f:
    f.write(c)
print(f'Size: {len(c)}')