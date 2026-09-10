'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, Job, LogKeywordMatch, LogKeywordRule, ServerInstance, ServerLog } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';
import { useServerSelection } from '../../../lib/server-selection';

export default function LogsPage() {
  const orgId = getStoredOrgId();
  const [servers, setServers] = useState<ServerInstance[]>([]);
  const [serverId, setServerId] = useState('');
  const [logs, setLogs] = useState<ServerLog[]>([]);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(false);
  const [error, setError] = useState('');
  const [retention, setRetention] = useState(7);
  const [rules, setRules] = useState<LogKeywordRule[]>([]);
  const [matches, setMatches] = useState<LogKeywordMatch[]>([]);
  const [keyword, setKeyword] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [command, setCommand] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);
  const [consoleEntries, setConsoleEntries] = useState<{id:string;command:string;output:string;failed:boolean}[]>([]);
  const selectServer=useServerSelection(servers,serverId,setServerId);
  const bottom = useRef<HTMLDivElement>(null);
  const latestLogId = useRef('');
  const loadingLogs = useRef(false);
  const pausedRef = useRef(false);

  useEffect(() => {
    if (!orgId) return;
    api.get<ServerInstance[]>(`/api/orgs/${orgId}/server-instances`).then(rows=>setServers(rows.filter(row=>row.gameType==='minecraft'))).catch(e => setError(e.message));
    api.get<{logRetentionDays:number}>(`/api/orgs/${orgId}/logs/settings`)
      .then(s => setRetention(s.logRetentionDays)).catch(e => setError(e.message));
  }, [orgId]);

  useEffect(() => {
    setAutoScroll(localStorage.getItem('mastermind_logs_auto_scroll') === 'true');
  }, []);

  const loadLogs = useCallback(async (initial = false) => {
    if (!orgId || !serverId || pausedRef.current || loadingLogs.current) return;
    loadingLogs.current = true;
    try {
      const after = !initial && latestLogId.current ? `&afterId=${encodeURIComponent(latestLogId.current)}` : '';
      const rows = await api.get<ServerLog[]>(`/api/orgs/${orgId}/logs?serverInstanceId=${encodeURIComponent(serverId)}&limit=${initial ? 300 : 200}${after}`);
      if (rows.length) {
        latestLogId.current = rows[rows.length - 1].id;
        setLogs(current => {
          if (initial) return rows;
          const known = new Set(current.map(row => row.id));
          return [...current, ...rows.filter(row => !known.has(row.id))].slice(-500);
        });
      } else if (initial) setLogs([]);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load logs'); }
    finally { loadingLogs.current = false; }
  }, [orgId, serverId]);

  const loadMatches = useCallback(async () => {
    if (!orgId || !serverId || pausedRef.current) return;
    try { setMatches(await api.get<LogKeywordMatch[]>(`/api/orgs/${orgId}/logs/keyword-matches?serverInstanceId=${encodeURIComponent(serverId)}`)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load alerts'); }
  }, [orgId, serverId]);

  const loadRules = useCallback(async () => {
    if (!orgId) return;
    setRules(await api.get<LogKeywordRule[]>(`/api/orgs/${orgId}/logs/keyword-alerts`));
  }, [orgId]);

  useEffect(() => { loadRules().catch(e=>setError(e.message)); }, [loadRules]);

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !serverId || !keyword.trim()) return;
    try {
      await api.post(`/api/orgs/${orgId}/logs/keyword-alerts`, { serverInstanceId: serverId, keyword, caseSensitive });
      setKeyword(''); await loadRules(); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to add alert'); }
  }

  async function sendCommand(e: React.FormEvent) {
    e.preventDefault();
    const value=command.trim();
    if(!orgId||!serverId||!value||commandBusy)return;
    const id=`${Date.now()}`;setCommandBusy(true);setError('');setCommand('');
    setConsoleEntries(rows=>[...rows,{id,command:value,output:'Waiting for server response…',failed:false}]);
    try{
      const queued=await api.post<{jobRunId:string}>(`/api/orgs/${orgId}/jobs`,{serverInstanceId:serverId,type:'RCON',payload:{command:value}});
      let completed:Job|undefined;
      for(let i=0;i<30;i++){
        await new Promise(resolve=>setTimeout(resolve,1000));
        const run=await api.get<Job['latestRun']>(`/api/orgs/${orgId}/jobs/runs/${queued.jobRunId}`);
        completed=run?{...({} as Job),latestRun:run}:undefined;
        if(run?.status==='success'||run?.status==='failed')break;
      }
      if(!completed||!['success','failed'].includes(completed.latestRun?.status||''))throw new Error('Console command timed out');
      const result=completed.latestRun?.result as {output?:string;errorMessage?:string}|undefined;
      const failed=completed.latestRun?.status==='failed';
      const output=(failed?result?.errorMessage:result?.output)||result?.output||(failed?'Command failed':'Command completed with no output.');
      setConsoleEntries(rows=>rows.map(row=>row.id===id?{...row,output,failed}:row));
    }catch(err){
      const output=err instanceof Error?err.message:'Command failed';
      setConsoleEntries(rows=>rows.map(row=>row.id===id?{...row,output,failed:true}:row));
    }finally{setCommandBusy(false);}
  }

  useEffect(() => {
    latestLogId.current = '';
    setLogs([]);
    void loadLogs(true);
    void loadMatches();
    const logTimer = setInterval(() => void loadLogs(), 2000);
    const matchTimer = setInterval(() => void loadMatches(), 10000);
    return () => { clearInterval(logTimer); clearInterval(matchTimer); };
  }, [loadLogs, loadMatches]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { if (autoScroll && !paused) bottom.current?.scrollIntoView({ behavior: 'auto', block: 'end' }); }, [logs, paused, autoScroll]);

  function toggleAutoScroll() {
    setAutoScroll(value => {
      const next = !value;
      localStorage.setItem('mastermind_logs_auto_scroll', String(next));
      if (next) requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
      return next;
    });
  }

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem'}}>
      <div><h1 style={{margin:0,color:'#f1f5f9',fontSize:'1.5rem'}}>Server Logs</h1><p style={{color:'#64748b',margin:'0.25rem 0 0'}}>Recorded output, refreshed every 2 seconds</p></div>
      <div style={{display:'flex',gap:'0.5rem'}}>
        <select value={retention} onChange={async e => {
          const value = Number(e.target.value); setRetention(value);
          try { await api.post(`/api/orgs/${orgId}/logs/settings`, { logRetentionDays: value }); setError(''); }
          catch (err) { setError(err instanceof Error ? err.message : 'Failed to save retention'); }
        }} title="Delete recorded logs older than this period" style={{background:'#111118',color:'#e2e8f0',border:'1px solid #252532',borderRadius:6,padding:'0.5rem'}}>
          <option value={1}>1 day</option><option value={7}>1 week</option><option value={30}>1 month</option>
        </select>
        <select aria-label="Server" value={serverId} onChange={e=>selectServer(e.target.value)} style={{background:'#111118',color:'#e2e8f0',border:'1px solid #252532',borderRadius:6,padding:'0.5rem'}}>{servers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <button onClick={toggleAutoScroll} title="Keep the log view pinned to the newest entries" style={{background:autoScroll?'#15803d':'#111118',color:'#e2e8f0',border:'1px solid #252532',borderRadius:6,padding:'0.5rem 0.8rem'}}>{autoScroll?'Auto-scroll: On':'Auto-scroll: Off'}</button>
        <button onClick={()=>setPaused(v=>!v)} style={{background:paused?'#6366f1':'#111118',color:'#e2e8f0',border:'1px solid #252532',borderRadius:6,padding:'0.5rem 0.8rem'}}>{paused?'Resume':'Pause'}</button>
      </div>
    </div>
    {error && <div style={{color:'#f87171',marginBottom:'0.75rem'}}>{error}</div>}
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem',marginBottom:'1rem'}}>
      <div style={{background:'#111118',border:'1px solid #1e1e2a',borderRadius:8,padding:'1rem'}}>
        <strong style={{color:'#f1f5f9'}}>Keyword alerts</strong>
        <form onSubmit={addRule} style={{display:'flex',gap:8,margin:'0.75rem 0'}}>
          <input value={keyword} onChange={e=>setKeyword(e.target.value)} maxLength={200} placeholder="incorrect region header" style={{flex:1,background:'#08080c',color:'#e2e8f0',border:'1px solid #252532',borderRadius:6,padding:'.5rem'}}/>
          <label style={{color:'#94a3b8',display:'flex',alignItems:'center',gap:5,fontSize:'.8rem'}}><input type="checkbox" checked={caseSensitive} onChange={e=>setCaseSensitive(e.target.checked)}/>Case</label>
          <button style={{background:'#6366f1',color:'white',border:0,borderRadius:6,padding:'0 .8rem'}}>Add</button>
        </form>
        <div style={{maxHeight:130,overflow:'auto'}}>{rules.filter(r=>r.condition.serverInstanceId===serverId).map(r=><div key={r.id} style={{display:'flex',alignItems:'center',gap:8,color:'#cbd5e1',padding:'.3rem 0'}}>
          <input type="checkbox" checked={r.enabled} onChange={async e=>{await api.patch(`/api/orgs/${orgId}/logs/keyword-alerts/${r.id}`,{enabled:e.target.checked});await loadRules();}}/>
          <code style={{flex:1}}>{r.condition.keyword}</code><small style={{color:'#64748b'}}>{r.condition.caseSensitive?'case-sensitive':'any case'}</small>
          <button onClick={async()=>{await api.delete(`/api/orgs/${orgId}/logs/keyword-alerts/${r.id}`);await loadRules();}} style={{background:'transparent',color:'#f87171',border:0,cursor:'pointer'}}>Delete</button>
        </div>)}</div>
      </div>
      <div style={{background:'#111118',border:'1px solid #1e1e2a',borderRadius:8,padding:'1rem'}}>
        <strong style={{color:'#f1f5f9'}}>Recent matches</strong>
        <div style={{maxHeight:180,overflow:'auto',marginTop:'.75rem'}}>{matches.length===0?<span style={{color:'#64748b'}}>No matches.</span>:matches.map(m=><div key={m.id} style={{borderLeft:'3px solid #ef4444',padding:'.35rem .6rem',marginBottom:6,background:'#0d0d14'}}>
          <div style={{color:'#f87171',fontSize:'.8rem'}}>{m.payload.ruleName} · {new Date(m.createdAt).toLocaleString()}</div>
          <code style={{color:'#94a3b8',fontSize:'.72rem',whiteSpace:'pre-wrap'}}>{m.payload.excerpt}</code>
        </div>)}</div>
      </div>
    </div>
    <pre style={{height:'calc(100vh - 500px)',minHeight:280,overflow:'auto',whiteSpace:'pre-wrap',wordBreak:'break-word',background:'#08080c',color:'#cbd5e1',border:'1px solid #1e1e2a',borderRadius:8,padding:'1rem',fontSize:'0.78rem',lineHeight:1.45,margin:0}}>{logs.map(l=><span key={l.id}>{l.content}</span>)}<div ref={bottom}/></pre>
    <div style={{background:'#111118',border:'1px solid #252532',borderRadius:8,padding:'.75rem',marginTop:'.75rem'}}>
      <div style={{maxHeight:180,overflow:'auto',marginBottom:consoleEntries.length?'.65rem':0}}>{consoleEntries.map(entry=><div key={entry.id} style={{marginBottom:'.55rem',fontFamily:'monospace',fontSize:'.78rem'}}><div style={{color:'#818cf8'}}>&gt; {entry.command}</div><div style={{color:entry.failed?'#f87171':'#cbd5e1',whiteSpace:'pre-wrap',wordBreak:'break-word'}}>{entry.output}</div></div>)}</div>
      <form onSubmit={sendCommand} style={{display:'flex',gap:8}}>
        <input value={command} onChange={e=>setCommand(e.target.value.replace(/[\r\n]/g,''))} maxLength={512} disabled={!serverId||commandBusy} placeholder="Send telnet command (example: say Hello)" aria-label="Telnet console command" style={{flex:1,minWidth:0,background:'#08080c',color:'#e2e8f0',border:'1px solid #252532',borderRadius:6,padding:'.6rem'}}/>
        <button disabled={!serverId||!command.trim()||commandBusy} style={{background:'#4f46e5',color:'white',border:0,borderRadius:6,padding:'0 1rem',cursor:commandBusy?'wait':'pointer'}}>{commandBusy?'Sending…':'Send'}</button>
      </form>
    </div>
  </div>;
}
