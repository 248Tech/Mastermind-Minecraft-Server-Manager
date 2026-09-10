'use client';
import './globals.css';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { isLoggedIn, clearAuth, getStoredOrgId } from '../lib/auth';
import { api, ApiError } from '../lib/api';
import { getStoredServerId, setStoredServerId } from '../lib/server-selection';

const NAV_GROUPS = [
  { label: 'Overview', items: [
    { href: '/dashboard', label: 'Dashboard', icon: '◈', title: 'Overview of all your servers and recent activity' },
    { href: '/health', label: 'Health', icon: '♥', title: 'Server health, latency, CPU, and memory' },
  ]},
  { label: 'Server', items: [
    { href: '/tools', label: 'Tools', icon: '⚒', title: 'Connection protection and server utilities' },
    { href: '/players', label: 'Players', icon: '♟', title: 'Player identities, playtime, kick, and ban controls' },
    { href: '/mods', label: 'Mods', icon: '◇', title: 'Installed mods/plugins and quarantine workflows' },
    { href: '/saves', label: 'Worlds', icon: '▣', title: 'Back up, restore, and manage world folders' },
    { href: '/logs', label: 'Logs', icon: '≡', title: 'Live and recorded server logs (latest.log)' },
    { href: '/chat', label: 'Chat', icon: '💬', title: 'Player chat history and Discord relay' },
    { href: '/live-map', label: 'Live Map', icon: '⌖', title: 'Embedded BlueMap / Dynmap / Squaremap' },
    { href: '/donator-shop', label: 'Donator Shop', icon: '♡', title: 'Create supporter packages and optional In-Game Gifts for the player portal' },
    { href: '/purchases', label: 'Donations', icon: '$', title: 'Completed player donations and In-Game Gift delivery' },
  ]},
  { label: 'Automation', items: [
    { href: '/jobs', label: 'Jobs', icon: '⚡', title: 'Send one-off RCON commands and lifecycle jobs to your servers' },
    { href: '/schedules', label: 'Schedules', icon: '◷', title: 'Run jobs automatically on a schedule' },
    { href: '/alerts', label: 'Alerts', icon: '◎', title: 'Get notified via Discord when servers go offline' },
    { href: '/triggers', label: 'Triggers', icon: '✦', title: 'Run actions when in-game events happen' },
  ]},
  { label: 'System', items: [
    { href: '/hosts', label: 'Hosts', icon: '⬡', title: 'Machines running the agent and game servers' },
    { href: '/accounts', label: 'Accounts', icon: '♙', title: 'Create and view Mastermind organization accounts' },
    { href: '/security', label: 'Security', icon: '◆', title: 'Login lockouts, math challenges, and reCAPTCHA' },
    { href: '/settings', label: 'Settings', icon: '⚙', title: 'Organisation info and account settings' },
  ]},
];

const PUBLIC = ['/', '/login'];
const isPublicPath = (pathname: string) => PUBLIC.includes(pathname) || pathname === '/player' || pathname.startsWith('/player/');

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [servers, setServers] = useState<{id:string;name:string;gameType:string}[]>([]);
  const [serverId, setServerId] = useState('');

  useEffect(() => {
    const applyTheme=()=>{
      const saved=localStorage.getItem('mm_ui_theme');
      document.documentElement.dataset.theme=saved==='light'||saved==='dark'?saved:'original';
    };
    applyTheme();
    window.addEventListener('mastermind-theme-change',applyTheme);
    return()=>window.removeEventListener('mastermind-theme-change',applyTheme);
  }, []);
  useEffect(() => {
    let active = true;
    if (isPublicPath(pathname)) {
      setReady(true);
      return () => { active = false; };
    }
    if (!isLoggedIn()) {
      setReady(false);
      router.replace('/login');
      return () => { active = false; };
    }

    setReady(false);
    api.get<{ orgs: { orgId: string }[] }>('/api/auth/me')
      .then((profile) => {
        if (!active) return;
        const storedOrgId = getStoredOrgId();
        const orgId = profile.orgs.some((org) => org.orgId === storedOrgId)
          ? storedOrgId
          : profile.orgs[0]?.orgId;
        if (!orgId) {
          clearAuth();
          router.replace('/login');
          return;
        }
        localStorage.setItem('mm_org_id', orgId);
        setReady(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          clearAuth();
          router.replace('/login');
          return;
        }
        // A temporary network failure should not destroy a valid session.
        setReady(true);
      });
    return () => { active = false; };
  }, [pathname, router]);
  useEffect(() => {
    const handleInvalidSession = () => {
      clearAuth();
      setReady(false);
      router.replace('/login');
    };
    window.addEventListener('mastermind-auth-invalid', handleInvalidSession);
    return () => window.removeEventListener('mastermind-auth-invalid', handleInvalidSession);
  }, [router]);
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    if (!ready || isPublicPath(pathname)) return;
    let active=true;
    const orgId=getStoredOrgId();
    if (!orgId) return;
    const loadServers=()=>api.get<{id:string;name:string;gameType:string}[]>(`/api/orgs/${orgId}/server-instances`).then(rows=>{
      if(!active)return;
      const gameServers=rows.filter(row=>row.gameType==='minecraft');
      setServers(gameServers);
      const selected=gameServers.find(row=>row.id===getStoredServerId())||gameServers[0];
      if(selected){setServerId(selected.id);if(selected.id!==getStoredServerId())setStoredServerId(selected.id);}
      else setServerId('');
    }).catch(()=>{/* Keep the last good server list during a temporary API failure. */});
    void loadServers();
    const refresh=()=>void loadServers();
    const timer=window.setInterval(refresh,30000);
    window.addEventListener('focus',refresh);
    const onChange=(event:Event)=>setServerId((event as CustomEvent<string>).detail);
    window.addEventListener('mastermind-server-change',onChange);
    return()=>{active=false;window.clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('mastermind-server-change',onChange);};
  }, [ready, pathname]);

  const isPublic = isPublicPath(pathname);

  function handleLogout() {
    clearAuth();
    router.push('/login');
  }

  return (
    <html lang="en">
      <head>
        <title>Mastermind — Minecraft Server Manager</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="app-shell" style={{ margin: 0, display: 'flex', minHeight: '100vh', background: '#0a0a0f' }}>
        {!isPublic && ready && <button className="mobile-menu-button" aria-label="Open navigation" aria-expanded={menuOpen} onClick={()=>setMenuOpen(!menuOpen)}>☰</button>}
        {!isPublic && ready && menuOpen && <button className="mobile-nav-backdrop" aria-label="Close navigation" onClick={()=>setMenuOpen(false)} />}
        {!isPublic && ready && (
          <nav className={`app-nav ${menuOpen?'app-nav-open':''}`} style={{
            width: 220,
            background: '#0d0d14',
            borderRight: '1px solid #1e1e2a',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            zIndex: 100,
          }}>
            {/* Logo */}
            <div className="nav-logo" style={{ padding: '1.5rem 1.25rem 1.25rem', borderBottom: '1px solid #1e1e2a' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                <img src="/mastermind-logo.png" alt="Mastermind" style={{width:40,height:40,objectFit:'cover',objectPosition:'center 42%',borderRadius:8,boxShadow:'0 0 16px rgba(249,115,22,.35)'}} />
                <div className="nav-label">
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#f1f5f9', lineHeight: 1.2 }}>Mastermind</div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', lineHeight: 1.2 }}>Minecraft Manager</div>
                </div>
              </div>
              <label style={{display:'block',marginTop:12,color:'#64748b',fontSize:'.68rem',letterSpacing:'.05em',textTransform:'uppercase'}}>Active server<select aria-label="Active server" value={serverId} onChange={event=>{setServerId(event.target.value);setStoredServerId(event.target.value);}} disabled={!servers.length} style={{display:'block',width:'100%',marginTop:5,background:'#111118',color:'#e2e8f0',border:'1px solid #252532',borderRadius:6,padding:'.45rem',fontSize:'.78rem'}}><option value="">{servers.length?'Select server':'No Minecraft servers'}</option>{servers.map(server=><option key={server.id} value={server.id}>{server.name}</option>)}</select></label>
            </div>

            {/* Nav items */}
            <div className="nav-scroll" style={{ padding: '0.6rem 0.75rem', flex: 1, overflowY:'auto', overscrollBehavior:'contain' }}>
              {NAV_GROUPS.map((group) => <div className="nav-group" key={group.label}>
                <div className="nav-section-label">{group.label}</div>
                {group.items.map((n) => {
                  const active = pathname.startsWith(n.href);
                  return (
                  <a
                    key={n.href}
                    href={n.href}
                    title={n.title}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.625rem',
                      padding: '0.43rem 0.75rem',
                      borderRadius: 6,
                      textDecoration: 'none',
                      fontSize: '0.875rem',
                      fontWeight: active ? 600 : 400,
                      color: active ? '#f1f5f9' : '#64748b',
                      background: active ? 'rgba(99,102,241,0.12)' : 'transparent',
                      borderLeft: active ? '2px solid #6366f1' : '2px solid transparent',
                      marginLeft: active ? 0 : 0,
                    }}
                  >
                    <span style={{ fontSize: '0.875rem', width: 18, textAlign: 'center', opacity: active ? 1 : 0.6 }}>{n.icon}</span>
                    <span className="nav-label">{n.label}</span>
                  </a>
                  );
                })}
              </div>)}
            </div>

            {/* Setup Guide */}
            <div className="nav-setup" style={{ padding: '0.5rem 0.75rem', borderTop:'1px solid #1e1e2a', flexShrink:0 }}>
              <a href="/player" target="_blank" rel="noopener noreferrer" style={{display:'flex',alignItems:'center',gap:'.5rem',padding:'.5rem .75rem',marginBottom:6,borderRadius:6,textDecoration:'none',fontSize:'.8rem',fontWeight:600,color:'#fb923c',background:'rgba(249,115,22,.08)',border:'1px solid rgba(249,115,22,.2)'}}><span>⌖</span><span className="nav-label">View Player Portal</span></a>
              <a
                href="/hosts"
                onClick={() => localStorage.setItem('mm_tutorial_open', '1')}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.5rem 0.75rem', borderRadius: 6, textDecoration: 'none',
                  fontSize: '0.8rem', fontWeight: 600, color: '#818cf8',
                  background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)',
                  transition: 'background 0.15s',
                }}
              >
                <span style={{ fontSize: '0.75rem' }}>▶</span> <span className="nav-label">Setup Guide</span>
              </a>
            </div>

            {/* Logout */}
            <div style={{ padding: '0 0.75rem 0.75rem', flexShrink:0 }}>
              <button
                onClick={handleLogout}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  background: 'transparent',
                  border: '1px solid #252532',
                  borderRadius: 6,
                  color: '#64748b',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  justifyContent: 'center',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.color = '#f1f5f9';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#3f3f52';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.color = '#64748b';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#252532';
                }}
              >
                <span>↪</span> <span className="nav-label">Sign out</span>
              </button>
            </div>
          </nav>
        )}
        <main className={isPublic?'app-main app-main-public':'app-main'} style={{
          flex: 1,
          marginLeft: isPublic ? 0 : 220,
          padding: isPublic ? 0 : '2rem 2.5rem',
          overflowY: 'auto',
          minHeight: '100vh',
          background: '#0a0a0f',
        }}>
          {(isPublic || ready) ? children : null}
        </main>
      </body>
    </html>
  );
}
