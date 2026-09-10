'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, Host, ServerInstance } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';
import { usePoll } from '../../../hooks/useRealtime';

const card:React.CSSProperties={background:'#111118',border:'1px solid #1e1e2a',borderRadius:10,padding:'1.25rem'};
function relative(value:string|null){if(!value)return'Never';const seconds=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/1000));if(seconds<60)return`${seconds}s ago`;if(seconds<3600)return`${Math.floor(seconds/60)}m ago`;if(seconds<86400)return`${Math.floor(seconds/3600)}h ago`;return`${Math.floor(seconds/86400)}d ago`;}
function Status({online,maintenance}:{online:boolean;maintenance?:boolean}){
  const label=maintenance?'● Maintenance':online?'● Online':'○ Offline';
  const color=maintenance?'#fbbf24':online?'#4ade80':'#f87171';
  const background=maintenance?'rgba(251,191,36,.12)':online?'rgba(34,197,94,.1)':'rgba(239,68,68,.1)';
  return <span style={{color,background,borderRadius:20,padding:'.25rem .6rem',fontSize:'.75rem',fontWeight:600}}>{label}</span>;
}

const QUICK_LINKS=[
  {id:'logs',href:'/logs',icon:'≡',label:'Logs',description:'Live output and console commands',color:'#38bdf8'},
  {id:'chat',href:'/chat',icon:'💬',label:'Chat',description:'Player messages and Discord relay',color:'#60a5fa'},
  {id:'health',href:'/health',icon:'♥',label:'Health',description:'CPU, RAM, latency, and checks',color:'#4ade80'},
  {id:'players',href:'/players',icon:'♟',label:'Players',description:'Online players and moderation',color:'#fbbf24'},
  {id:'mods',href:'/mods',icon:'◇',label:'Mods',description:'Active and quarantined mods',color:'#c084fc'},
  {id:'saves',href:'/saves',icon:'▣',label:'Saves',description:'Backups, restores, and retention',color:'#2dd4bf'},
  {id:'jobs',href:'/jobs',icon:'⚡',label:'Jobs',description:'Recent and running server actions',color:'#fb923c'},
  {id:'schedules',href:'/schedules',icon:'◷',label:'Schedules',description:'Automated jobs and restarts',color:'#818cf8'},
  {id:'alerts',href:'/alerts',icon:'◎',label:'Alerts',description:'Rules and notifications',color:'#f87171'},
  {id:'triggers',href:'/triggers',icon:'⚡',label:'Triggers',description:'Level rewards, item grants, and event actions',color:'#c4b5fd'},
] as const;
const DEFAULT_QUICK=['logs','health','players','jobs'];

export default function DashboardPage(){
  const orgId=getStoredOrgId();const [servers,setServers]=useState<ServerInstance[]>([]);const [hosts,setHosts]=useState<Host[]>([]);const [error,setError]=useState('');
  const [customizing,setCustomizing]=useState(false);const [quick,setQuick]=useState<string[]>(DEFAULT_QUICK);
  useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem('mastermind_dashboard_quick_links')||'null');if(Array.isArray(saved))setQuick(saved.filter(id=>QUICK_LINKS.some(link=>link.id===id)));}catch{/* keep defaults */}},[]);
  function toggleQuick(id:string){setQuick(current=>{const next=current.includes(id)?current.filter(value=>value!==id):[...current,id];localStorage.setItem('mastermind_dashboard_quick_links',JSON.stringify(next));return next;});}
  const fetchAll=useCallback(async()=>{if(!orgId)return{servers:[],hosts:[]};const [s,h]=await Promise.all([api.get<ServerInstance[]>(`/api/orgs/${orgId}/server-instances`),api.get<Host[]>(`/api/orgs/${orgId}/hosts`)]);return{servers:s,hosts:h};},[orgId]);
  usePoll(fetchAll,data=>{setServers(data.servers);setHosts(data.hosts);setError('');},10000,!!orgId);
  const hostFor=(server:ServerInstance)=>{const host=hosts.find(h=>h.id===server.hostId);return host?{...host,status:Boolean(host.lastMetrics?.gameReachable)?'online':'offline'}:undefined;};const online=servers.filter(s=>hostFor(s)?.status==='online').length;
  return <div><div style={{marginBottom:'1.5rem',display:'flex',justifyContent:'space-between',alignItems:'start',gap:12,flexWrap:'wrap'}}><div><h1 style={{margin:0,color:'#f1f5f9',fontSize:'1.65rem'}}>Servers</h1><p style={{color:'#64748b',margin:'.3rem 0 0'}}>Choose a server to view status, manage it, and inspect its jobs.</p></div><button onClick={()=>setCustomizing(value=>!value)} aria-expanded={customizing} style={{background:customizing?'#4f46e5':'#111118',color:'#e2e8f0',border:'1px solid #35354a',borderRadius:7,padding:'.55rem .85rem',cursor:'pointer'}}>⚙ Customize dashboard</button></div>
    {error&&<div style={{color:'#f87171',marginBottom:12}}>{error}</div>}
    {customizing&&<div style={{...card,marginBottom:'1rem'}}><div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',marginBottom:'.8rem'}}><div><strong style={{color:'#f1f5f9'}}>Quick access</strong><div style={{color:'#64748b',fontSize:'.78rem',marginTop:3}}>Choose the tools shown directly on your dashboard. Changes save automatically in this browser.</div></div><button onClick={()=>{setQuick(DEFAULT_QUICK);localStorage.setItem('mastermind_dashboard_quick_links',JSON.stringify(DEFAULT_QUICK));}} style={{background:'transparent',color:'#818cf8',border:'1px solid #303044',borderRadius:6,padding:'.4rem .65rem',cursor:'pointer'}}>Reset defaults</button></div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:8}}>{QUICK_LINKS.map(link=><label key={link.id} style={{display:'flex',alignItems:'center',gap:8,color:'#cbd5e1',background:'#0b0b11',border:'1px solid #252532',borderRadius:7,padding:'.6rem',cursor:'pointer'}}><input type="checkbox" checked={quick.includes(link.id)} onChange={()=>toggleQuick(link.id)}/><span style={{color:link.color}}>{link.icon}</span>{link.label}</label>)}</div></div>}
    {quick.length>0&&<div style={{marginBottom:'1.5rem'}}><div style={{color:'#64748b',fontSize:'.75rem',fontWeight:700,letterSpacing:'.08em',marginBottom:'.6rem'}}>QUICK ACCESS</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:'.75rem'}}>{quick.map(id=>QUICK_LINKS.find(link=>link.id===id)).filter((link):link is (typeof QUICK_LINKS)[number]=>Boolean(link)).map(link=><a key={link.id} href={link.href} style={{background:'#111118',border:'1px solid #252532',borderRadius:9,padding:'.85rem 1rem',textDecoration:'none',display:'flex',gap:10,alignItems:'center',minWidth:0}}><span style={{color:link.color,fontSize:'1.2rem',width:22,textAlign:'center'}}>{link.icon}</span><span style={{minWidth:0}}><strong style={{display:'block',color:'#e2e8f0',fontSize:'.88rem'}}>{link.label}</strong><small style={{display:'block',color:'#64748b',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{link.description}</small></span></a>)}</div></div>}
    <div className="dashboard-stats-grid" style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:'1rem',marginBottom:'1.5rem'}}>
      {[['Total servers',servers.length,'#818cf8'],['Online',online,'#4ade80'],['Offline',servers.length-online,'#f87171']].map(([label,value,color])=><div key={String(label)} style={card}><div style={{color:'#64748b',fontSize:'.78rem'}}>{label}</div><div style={{color:String(color),fontSize:'1.8rem',fontWeight:700,marginTop:6}}>{value}</div></div>)}
    </div>
    {servers.length===0?<div style={card}><h2 style={{color:'#e2e8f0',marginTop:0}}>No servers registered</h2><p style={{color:'#64748b'}}>Pair a host and discover or register a game server first.</p><a href="/hosts" style={{color:'#818cf8'}}>Open host setup</a></div>:<div className="server-card-grid" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:'1rem'}}>{servers.map(server=>{const host=hostFor(server);const isOnline=host?.status==='online';return <a key={server.id} href={`/servers/${server.id}`} style={{...card,textDecoration:'none',display:'block',transition:'border-color .15s',minWidth:0}}><div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'start'}}><div style={{minWidth:0}}><div style={{color:'#f1f5f9',fontWeight:700,fontSize:'1.05rem',overflowWrap:'anywhere'}}>{server.name}</div><div style={{color:'#64748b',fontSize:'.78rem',marginTop:4}}>{server.gameType.toUpperCase()} · {host?.name||'Unknown host'}</div></div><Status online={isOnline} maintenance={Boolean(server.maintenanceMode)}/></div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:'1.25rem'}}><div style={{minWidth:0}}><small style={{color:'#475569'}}>INSTALL PATH</small><div style={{color:'#94a3b8',fontSize:'.78rem',marginTop:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{server.installPath||'Not set'}</div></div><div><small style={{color:'#475569'}}>HOST SEEN</small><div style={{color:'#94a3b8',fontSize:'.78rem',marginTop:3}}>{relative(host?.lastHeartbeatAt||null)}</div></div></div><div style={{color:'#818cf8',fontSize:'.82rem',fontWeight:600,marginTop:'1.25rem'}}>Manage server ›</div></a>})}</div>}
  </div>;
}
