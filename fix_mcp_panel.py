with open('pages/index.js', 'r', encoding='utf-8') as f:
    c = f.read()

# 1. Remove MCP hooks from SettingsPanel
remove_block = """  // MCP Connections state
  const [mcpConns, setMcpConns] = useState([])
  const [mcpNewUrl, setMcpNewUrl] = useState('')
  const [mcpNewToken, setMcpNewToken] = useState('')
  const [mcpNewName, setMcpNewName] = useState('')
  const [mcpTesting, setMcpTesting] = useState(false)
  const [mcpTestResult, setMcpTestResult] = useState('')
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem('pool_mcp_connections') || '[]'); if (saved.length) setMcpConns(saved) } catch {}
  }, [])"""
if remove_block in c:
    c = c.replace(remove_block, '', 1)
    print('1. Removed MCP hooks')
else:
    print('1. SKIP - MCP hooks not found')

# 2. Remove mcpResult/Loading/Input
remove2 = """  const [mcpResult, setMcpResult] = useState('')
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpInput, setMcpInput] = useState('')"""
if remove2 in c:
    c = c.replace(remove2, '', 1)
    print('2. Removed mcpResult/Loading/Input')
else:
    print('2. SKIP')

# 3. Remove saveAll mcp lines
remove3 = """    localStorage.setItem('pool_mcp_connections', JSON.stringify(mcpConns))
    syncToBackend('pool_mcp_connections', mcpConns)"""
if remove3 in c:
    c = c.replace(remove3, '', 1)
    print('3. Removed save lines')
else:
    print('3. SKIP')

# 4. Replace MCP UI inline section with <McpPanel />
mcp_marker = 'MCP \u8fde\u63a5'  # "MCP 连接"
mcp_start = c.find(mcp_marker)
if mcp_start > 0:
    div_start = c.rfind('<div className="settings-section"', 0, mcp_start)
    save_btn_idx = c.find('onClick={saveAll}', mcp_start)
    if div_start > 0 and save_btn_idx > 0:
        # Find last </div> before save button
        section_end = c.rfind('</div>', div_start, save_btn_idx)
        if section_end > 0:
            section_end += len('</div>')
            old_section = c[div_start:section_end]
            c = c.replace(old_section, '      <McpPanel />', 1)
            print(f'4. Replaced MCP UI ({len(old_section)} chars)')
        else:
            print('4. SKIP - no closing div')
    else:
        print('4. SKIP - markers not found')
else:
    print('4. SKIP - MCP marker not found')

# 5. Add McpPanel component before SettingsPanel
mcp_comp = '''
function McpPanel() {
  const [conns, setConns] = useState(() => { try { return JSON.parse(localStorage.getItem('pool_mcp_connections') || '[]') } catch { return [] } })
  const [newUrl, setNewUrl] = useState('')
  const [newToken, setNewToken] = useState('')
  const [newName, setNewName] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')
  function save(c) { setConns(c); localStorage.setItem('pool_mcp_connections', JSON.stringify(c)); syncToBackend('pool_mcp_connections', c) }
  return (
    <div className="settings-section" style={{marginTop:'20px'}}>
      <h3 className="settings-title">{'\U0001f517 MCP \u8fde\u63a5'}</h3>
      <p className="settings-desc">{'\u8fde\u63a5\u5916\u90e8MCP\u670d\u52a1\uff0c\u8ba9AI\u83b7\u5f97\u66f4\u591a\u5de5\u5177'}</p>
      {(Array.isArray(conns)?conns:[]).map((conn, i) => (
        <div key={conn.id||i} style={{background:'rgba(255,255,255,0.05)',borderRadius:'8px',padding:'10px',marginTop:'8px',border:'1px solid rgba(255,255,255,0.1)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontWeight:'bold',fontSize:'13px'}}>{conn.name||conn.url}</span>
            <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
              <label style={{fontSize:'11px',display:'flex',alignItems:'center',gap:'4px'}}>
                <input type="checkbox" checked={conn.enabled!==false} onChange={e=>{ const nc=[...conns]; nc[i]={...nc[i],enabled:e.target.checked}; save(nc) }} />
                {'\u542f\u7528'}
              </label>
              <button style={{background:'#c44',color:'#fff',border:'none',borderRadius:'4px',padding:'2px 8px',fontSize:'11px',cursor:'pointer'}} onClick={()=>save(conns.filter((_,j)=>j!==i))}>{'\u5220\u9664'}</button>
            </div>
          </div>
          <div style={{fontSize:'11px',color:'#999',marginTop:'4px',wordBreak:'break-all'}}>{conn.url}</div>
        </div>
      ))}
      <div style={{marginTop:'12px',display:'flex',flexDirection:'column',gap:'8px'}}>
        <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="\u540d\u79f0" className="settings-input" style={{fontSize:'13px'}}/>
        <input value={newUrl} onChange={e=>setNewUrl(e.target.value)} placeholder="MCP URL (https://...)" className="settings-input" style={{fontSize:'13px'}}/>
        <input value={newToken} onChange={e=>setNewToken(e.target.value)} placeholder="Token" className="settings-input" type="password" style={{fontSize:'13px'}}/>
        <div style={{display:'flex',gap:'8px'}}>
          <button className="settings-save" style={{flex:1,fontSize:'12px',padding:'8px'}} onClick={async()=>{
            if(!newUrl){alert('\u8bf7\u586bURL');return}
            setTesting(true);setTestResult('')
            try{
              const r=await fetch('/api/mcp-proxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'test_connection',url:newUrl,token:newToken})})
              const d=await r.json()
              if(d.success) setTestResult('\u2705 '+d.toolCount+' tools')
              else setTestResult('\u274c '+(d.error||'failed'))
            }catch(e){setTestResult('\u274c '+e.message)}
            setTesting(false)
          }}>{testing?'...':'\u6d4b\u8bd5'}</button>
          <button className="settings-save" style={{flex:1,fontSize:'12px',padding:'8px'}} onClick={()=>{
            if(!newUrl){alert('\u8bf7\u586bURL');return}
            save([...conns,{id:Date.now().toString(36),name:newName||'MCP',url:newUrl,token:newToken,enabled:true}])
            setNewUrl('');setNewToken('');setNewName('');setTestResult('')
          }}>{'\u6dfb\u52a0'}</button>
        </div>
        {testResult && <div style={{fontSize:'12px',padding:'6px',background:'rgba(255,255,255,0.05)',borderRadius:'4px',marginTop:'4px'}}>{testResult}</div>}
      </div>
    </div>
  )
}
'''

idx = c.find('function SettingsPanel()')
if idx > 0:
    c = c[:idx] + mcp_comp + '\n' + c[idx:]
    print('5. Added McpPanel component')

with open('pages/index.js', 'w', encoding='utf-8') as f:
    f.write(c)
print('Done!')