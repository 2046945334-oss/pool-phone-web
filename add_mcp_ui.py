import re

with open('pages/index.js', 'r', encoding='utf-8') as f:
    c = f.read()

# 1. Add MCP state variables after mcpTab state
old_state = "  const [mcpTab, setMcpTab] = useState('breath')"
new_state = """  const [mcpTab, setMcpTab] = useState('breath')
  // MCP Connections state
  const [mcpConns, setMcpConns] = useState(() => JSON.parse(localStorage.getItem('pool_mcp_connections') || '[]'))
  const [mcpNewUrl, setMcpNewUrl] = useState('')
  const [mcpNewToken, setMcpNewToken] = useState('')
  const [mcpNewName, setMcpNewName] = useState('')
  const [mcpTesting, setMcpTesting] = useState(false)
  const [mcpTestResult, setMcpTestResult] = useState('')"""

if old_state in c:
    c = c.replace(old_state, new_state, 1)
    print('Added MCP connections state')
else:
    print('ERROR: Could not find mcpTab state')

# 2. Add MCP save in saveAll
old_save = "    localStorage.setItem('pool_tts_config', JSON.stringify(ttsConfig))"
new_save = """    localStorage.setItem('pool_tts_config', JSON.stringify(ttsConfig))
    localStorage.setItem('pool_mcp_connections', JSON.stringify(mcpConns))
    syncToBackend('pool_mcp_connections', mcpConns)"""

if old_save in c:
    c = c.replace(old_save, new_save, 1)
    print('Added MCP save to saveAll')
else:
    print('ERROR: Could not find tts save line')

# 3. Add MCP UI section before the save button
mcp_section = """      <div className="settings-section" style={{marginTop:'20px'}}>
        <h3 className="settings-title">{'\U0001f517 MCP \u8fde\u63a5'}</h3>
        <p className="settings-desc">{'\u8fde\u63a5\u5916\u90e8MCP\u670d\u52a1\uff0c\u8ba9\u524d\u7aefAI\u83b7\u5f97\u66f4\u591a\u5de5\u5177'}</p>
        {mcpConns.map((conn, i) => (
          <div key={conn.id} style={{background:'rgba(255,255,255,0.05)',borderRadius:'8px',padding:'10px',marginTop:'8px',border:'1px solid rgba(255,255,255,0.1)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontWeight:'bold',fontSize:'13px'}}>{conn.name || conn.url}</span>
              <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
                <label style={{fontSize:'11px',display:'flex',alignItems:'center',gap:'4px'}}>
                  <input type="checkbox" checked={conn.enabled!==false} onChange={e=>{
                    const newConns=[...mcpConns]; newConns[i]={...newConns[i],enabled:e.target.checked}; setMcpConns(newConns)
                  }} />
                  {'\u542f\u7528'}
                </label>
                <button style={{background:'#c44',color:'#fff',border:'none',borderRadius:'4px',padding:'2px 8px',fontSize:'11px',cursor:'pointer'}} onClick={()=>{
                  setMcpConns(mcpConns.filter((_,j)=>j!==i))
                }}>{'\u5220\u9664'}</button>
              </div>
            </div>
            <div style={{fontSize:'11px',color:'#999',marginTop:'4px',wordBreak:'break-all'}}>{conn.url}</div>
          </div>
        ))}
        <div style={{marginTop:'12px',display:'flex',flexDirection:'column',gap:'8px'}}>
          <input value={mcpNewName} onChange={e=>setMcpNewName(e.target.value)} placeholder="\u540d\u79f0" className="settings-input" style={{fontSize:'13px'}}/>
          <input value={mcpNewUrl} onChange={e=>setMcpNewUrl(e.target.value)} placeholder="MCP URL (https://...)" className="settings-input" style={{fontSize:'13px'}}/>
          <input value={mcpNewToken} onChange={e=>setMcpNewToken(e.target.value)} placeholder="Token / JWT" className="settings-input" type="password" style={{fontSize:'13px'}}/>
          <div style={{display:'flex',gap:'8px'}}>
            <button className="settings-save" style={{flex:1,fontSize:'12px',padding:'8px'}} onClick={async()=>{
              if(!mcpNewUrl){alert('\u8bf7\u586bURL');return}
              setMcpTesting(true);setMcpTestResult('')
              try{
                const r=await fetch('/api/mcp-proxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'test_connection',url:mcpNewUrl,token:mcpNewToken})})
                const d=await r.json()
                if(d.success){
                  setMcpTestResult('\u2705 \u8fde\u63a5\u6210\u529f! '+d.toolCount+' \u4e2a\u5de5\u5177')
                } else {
                  setMcpTestResult('\u274c '+(d.error||'\u5931\u8d25'))
                }
              }catch(e){setMcpTestResult('\u274c '+e.message)}
              setMcpTesting(false)
            }}>{mcpTesting?'\u6d4b\u8bd5\u4e2d...':'\U0001f50d \u6d4b\u8bd5'}</button>
            <button className="settings-save" style={{flex:1,fontSize:'12px',padding:'8px'}} onClick={()=>{
              if(!mcpNewUrl){alert('\u8bf7\u586bURL');return}
              const newConn={id:Date.now().toString(36),name:mcpNewName||'MCP',url:mcpNewUrl,token:mcpNewToken,enabled:true}
              setMcpConns([...mcpConns,newConn])
              setMcpNewUrl('');setMcpNewToken('');setMcpNewName('');setMcpTestResult('')
            }}>{'\u2795 \u6dfb\u52a0'}</button>
          </div>
          {mcpTestResult && <div style={{fontSize:'12px',padding:'6px',background:'rgba(255,255,255,0.05)',borderRadius:'4px',marginTop:'4px'}}>{mcpTestResult}</div>}
        </div>
      </div>
"""

# Find the save button with regex since it has unicode escapes
save_pattern = re.compile(r'(\s*<button className="settings-save" onClick=\{saveAll\}\>\{saved \? .+? : .+?\}</button>)')
m = save_pattern.search(c)
if m:
    save_btn_actual = m.group(1)
    c = c.replace(save_btn_actual, mcp_section + save_btn_actual, 1)
    print('Added MCP UI section (regex match)')
else:
    print('ERROR: Could not find save button line via regex either')

with open('pages/index.js', 'w', encoding='utf-8') as f:
    f.write(c)
print(f'Final size: {len(c)}')
