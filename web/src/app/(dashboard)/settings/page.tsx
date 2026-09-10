'use client';
import { useState, useEffect } from 'react';
import { api, User, Org } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';

// ─── Design tokens ────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: '#111118', borderRadius: 10, padding: '1.5rem',
  border: '1px solid #1e1e2a', marginBottom: '1rem',
};

const inputStyle: React.CSSProperties = {
  padding: '0.55rem 0.875rem', borderRadius: 7, border: '1px solid #252532',
  fontSize: '0.875rem', background: '#0d0d14', color: '#f1f5f9',
  width: '100%', outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s',
};

const btnPrimary: React.CSSProperties = {
  padding: '0.5rem 1.125rem', background: '#6366f1', color: '#fff', border: 'none',
  borderRadius: 7, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600,
  boxShadow: '0 2px 8px rgba(99,102,241,0.25)',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.3rem', fontWeight: 500,
};

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '1rem', padding: '0.75rem 0', borderBottom: '1px solid #1a1a24', alignItems: 'baseline' }}>
      <div style={{ width: 140, fontSize: '0.78rem', color: '#64748b', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '0.875rem', color: '#e2e8f0', fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-all' }}>{value || '—'}</div>
    </div>
  );
}

function onFocus(e: React.FocusEvent<HTMLInputElement>) {
  e.target.style.borderColor = '#6366f1';
  e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)';
}
function onBlur(e: React.FocusEvent<HTMLInputElement>) {
  e.target.style.borderColor = '#252532';
  e.target.style.boxShadow = 'none';
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const orgId = getStoredOrgId();
  const [user, setUser] = useState<User | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookError, setWebhookError] = useState('');
  const [webhookSuccess, setWebhookSuccess] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [stabilityRestartEnabled, setStabilityRestartEnabled] = useState(true);
  const [stabilityRestartMemoryGiB, setStabilityRestartMemoryGiB] = useState(12);
  const [stabilityRestartCooldownMinutes, setStabilityRestartCooldownMinutes] = useState(240);
  const [stabilityRestartSaving, setStabilityRestartSaving] = useState(false);
  const [stabilityRestartMessage, setStabilityRestartMessage] = useState('');
  const [maintenancePassword, setMaintenancePassword] = useState('');
  const [maintenancePasswordConfigured, setMaintenancePasswordConfigured] = useState(false);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [discordBotCopied, setDiscordBotCopied] = useState(false);
  const [uiTheme, setUiTheme] = useState<'original'|'dark'|'light'>('original');
  const [openaiKey,setOpenaiKey]=useState('');const [openaiModel,setOpenaiModel]=useState('gpt-5.3-codex');const [openaiConfigured,setOpenaiConfigured]=useState(false);const [openaiBusy,setOpenaiBusy]=useState(false);const [openaiMessage,setOpenaiMessage]=useState('');
  const [modAiProvider,setModAiProvider]=useState<'codex'|'kimi'>('codex');const [providerBusy,setProviderBusy]=useState(false);const [providerMessage,setProviderMessage]=useState('');
  const [kimiKey,setKimiKey]=useState('');const [kimiModel,setKimiModel]=useState('kimi-for-coding');const [kimiConfigured,setKimiConfigured]=useState(false);const [kimiBusy,setKimiBusy]=useState(false);const [kimiMessage,setKimiMessage]=useState('');
  const [cloudflareToken,setCloudflareToken]=useState('');const [cloudflareConfigured,setCloudflareConfigured]=useState(false);const [cloudflareBusy,setCloudflareBusy]=useState(false);const [cloudflareMessage,setCloudflareMessage]=useState('');
  const [digitalOceanToken,setDigitalOceanToken]=useState('');const [digitalOceanConfigured,setDigitalOceanConfigured]=useState(false);const [digitalOceanBusy,setDigitalOceanBusy]=useState(false);const [digitalOceanMessage,setDigitalOceanMessage]=useState('');
  const [mailgunKey,setMailgunKey]=useState('');const [mailgunDomain,setMailgunDomain]=useState('');const [mailgunFrom,setMailgunFrom]=useState('');const [mailgunRegion,setMailgunRegion]=useState<'us'|'eu'>('us');const [mailgunConfigured,setMailgunConfigured]=useState(false);const [mailgunBusy,setMailgunBusy]=useState(false);const [mailgunMessage,setMailgunMessage]=useState('');
  const [stripeSecretKey,setStripeSecretKey]=useState('');const [stripeWebhookSecret,setStripeWebhookSecret]=useState('');const [stripeConfigured,setStripeConfigured]=useState(false);const [stripeWebhookConfigured,setStripeWebhookConfigured]=useState(false);const [stripeWebhookUrl,setStripeWebhookUrl]=useState('');const [stripeBusy,setStripeBusy]=useState(false);const [stripeMessage,setStripeMessage]=useState('');const [stripeCopied,setStripeCopied]=useState(false);

  const discordBotEnvironment = `DISCORD_TOKEN=<Bot token from Discord Developer Portal>
DISCORD_CLIENT_ID=<Discord Application ID>
DISCORD_GUILD_ID=<Your Discord server ID>
DISCORD_ALLOWED_ROLE_IDS=<Optional comma-separated role IDs>
DISCORD_ALLOWED_USER_IDS=<Optional comma-separated user IDs>
DISCORD_EPHEMERAL_REPLIES=true
MASTERMIND_URL=http://control-plane:3001
MASTERMIND_EMAIL=<Dedicated Mastermind operator email>
MASTERMIND_PASSWORD=<Dedicated Mastermind operator password>
MASTERMIND_ORG_ID=${orgId || '<Mastermind organization ID>'}
MASTERMIND_SERVER_ID=<Optional; blank auto-detects the first Minecraft server>
JOB_TIMEOUT_SECONDS=600`;

  useEffect(() => {
    const saved=localStorage.getItem('mm_ui_theme');
    if(saved==='dark'||saved==='light'||saved==='original')setUiTheme(saved);
  }, []);

  function applyUiTheme(theme:'original'|'dark'|'light') {
    setUiTheme(theme);
    localStorage.setItem('mm_ui_theme',theme);
    document.documentElement.dataset.theme=theme;
    window.dispatchEvent(new Event('mastermind-theme-change'));
  }

  useEffect(() => {
    if (!orgId) return;
    Promise.all([
      api.get<User>('/api/auth/me'),
      api.get<Org[]>('/api/orgs').then(orgs => orgs.find(o => o.id === orgId) || null).catch(() => null),
    ])
      .then(([u, o]) => { setUser(u); setOrg(o); setWebhookUrl(o?.discordWebhookUrl||''); setStabilityRestartEnabled(o?.stabilityRestartEnabled!==false);setStabilityRestartMemoryGiB(o?.stabilityRestartMemoryGiB||12);setStabilityRestartCooldownMinutes(o?.stabilityRestartCooldownMinutes||240);setMaintenancePasswordConfigured(Boolean(o?.maintenancePasswordConfigured));setOpenaiConfigured(Boolean(o?.openaiConfigured));setOpenaiModel(o?.openaiModel||'gpt-5.3-codex');setModAiProvider(o?.modAiProvider||'codex');setKimiConfigured(Boolean(o?.kimiConfigured));setKimiModel(o?.kimiModel||'kimi-for-coding');setCloudflareConfigured(Boolean(o?.cloudflareConfigured));setDigitalOceanConfigured(Boolean(o?.digitalOceanConfigured));setMailgunConfigured(Boolean(o?.mailgunConfigured));setMailgunDomain(o?.mailgunDomain||'');setMailgunFrom(o?.mailgunFromEmail||'');setMailgunRegion(o?.mailgunRegion||'us');setStripeConfigured(Boolean(o?.stripeConfigured));setStripeWebhookConfigured(Boolean(o?.stripeWebhookConfigured));setStripeWebhookUrl(o?.stripeWebhookUrl||''); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, [orgId]);

  async function handleUpdateWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setWebhookLoading(true); setWebhookError(''); setWebhookSuccess('');
    try {
      await api.patch(`/api/orgs/${orgId}`, { discordWebhookUrl: webhookUrl });
      setWebhookSuccess('Discord webhook updated successfully.');
    } catch (err: unknown) {
      setWebhookError(err instanceof Error ? err.message : 'Failed to update webhook');
    } finally {
      setWebhookLoading(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault(); setPasswordError(''); setPasswordSuccess('');
    if (newPassword.length < 12) { setPasswordError('New password must be at least 12 characters.'); return; }
    if (newPassword !== confirmPassword) { setPasswordError('New passwords do not match.'); return; }
    setPasswordLoading(true);
    try {
      await api.post('/api/auth/change-password', { currentPassword, newPassword });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setPasswordSuccess('Password changed successfully.');
    } catch (err) { setPasswordError(err instanceof Error ? err.message : 'Password change failed'); }
    finally { setPasswordLoading(false); }
  }

  async function saveStabilityRestart(e:React.FormEvent) {
    e.preventDefault(); if (!orgId) return;
    setStabilityRestartSaving(true); setStabilityRestartMessage('');
    try {
      const saved=await api.patch<{stabilityRestartEnabled:boolean;stabilityRestartMemoryGiB:number;stabilityRestartCooldownMinutes:number}>(`/api/orgs/${orgId}`,{stabilityRestartEnabled,stabilityRestartMemoryGiB,stabilityRestartCooldownMinutes});
      setStabilityRestartEnabled(saved.stabilityRestartEnabled);setStabilityRestartMemoryGiB(saved.stabilityRestartMemoryGiB);setStabilityRestartCooldownMinutes(saved.stabilityRestartCooldownMinutes);
      setStabilityRestartMessage(saved.stabilityRestartEnabled?'Stability Safe Restart policy saved.':'Stability Safe Restart disabled.');
    } catch (err) { setStabilityRestartMessage(err instanceof Error?err.message:'Could not save stability restart policy'); }
    finally { setStabilityRestartSaving(false); }
  }
  async function saveOpenAi(e:React.FormEvent){e.preventDefault();if(!orgId)return;setOpenaiBusy(true);setOpenaiMessage('');try{const result=await api.post<{configured:boolean;model:string}>(`/api/orgs/${orgId}/integrations/openai`,{model:openaiModel,...(openaiKey.trim()?{apiKey:openaiKey.trim()}:{})});setOpenaiConfigured(result.configured);setOpenaiModel(result.model);setOpenaiKey('');setOpenaiMessage('OpenAI settings saved. API key encrypted and hidden.');}catch(error){setOpenaiMessage(error instanceof Error?error.message:'Could not save OpenAI settings');}finally{setOpenaiBusy(false);}}
  async function testOpenAi(){if(!orgId)return;setOpenaiBusy(true);setOpenaiMessage('Testing API key and model access…');try{const result=await api.post<{ok:boolean;model?:string;error?:string;latencyMs?:number}>(`/api/orgs/${orgId}/integrations/openai/test`,{});setOpenaiMessage(result.ok?`Connected. ${result.model} is accessible${result.latencyMs?` (${result.latencyMs} ms)`:''}.`:result.error||'Connection failed.');}catch(error){setOpenaiMessage(error instanceof Error?error.message:'Connection failed');}finally{setOpenaiBusy(false);}}
  async function clearOpenAi(){if(!orgId||!confirm('Remove stored OpenAI API key? Codex mod editing will stop working.'))return;setOpenaiBusy(true);try{await api.delete(`/api/orgs/${orgId}/integrations/openai`);setOpenaiConfigured(false);setOpenaiKey('');setOpenaiMessage('OpenAI API key removed.');}catch(error){setOpenaiMessage(error instanceof Error?error.message:'Could not remove key');}finally{setOpenaiBusy(false);}}
  async function selectModAgent(provider:'codex'|'kimi'){if(!orgId||provider===modAiProvider)return;setProviderBusy(true);setProviderMessage('');try{const result=await api.patch<{provider:'codex'|'kimi'}>(`/api/orgs/${orgId}/integrations/mod-ai/provider`,{provider});setModAiProvider(result.provider);setProviderMessage(`${result.provider==='kimi'?'Kimi Code':'Codex'} selected for Mod Editor requests.`);}catch(error){setProviderMessage(error instanceof Error?error.message:'Could not select AI agent');}finally{setProviderBusy(false);}}
  async function saveKimi(e:React.FormEvent){e.preventDefault();if(!orgId)return;setKimiBusy(true);setKimiMessage('');try{const result=await api.post<{configured:boolean;model:string}>(`/api/orgs/${orgId}/integrations/kimi`,{model:kimiModel,...(kimiKey.trim()?{apiKey:kimiKey.trim()}:{})});setKimiConfigured(result.configured);setKimiModel(result.model);setKimiKey('');setKimiMessage('Kimi Code settings saved. API key encrypted and hidden.');}catch(error){setKimiMessage(error instanceof Error?error.message:'Could not save Kimi Code settings');}finally{setKimiBusy(false);}}
  async function testKimi(){if(!orgId)return;setKimiBusy(true);setKimiMessage('Testing Moonshot API key and model access…');try{const result=await api.post<{ok:boolean;model?:string;error?:string;latencyMs?:number}>(`/api/orgs/${orgId}/integrations/kimi/test`,{});setKimiMessage(result.ok?`Connected. ${result.model} is accessible${result.latencyMs?` (${result.latencyMs} ms)`:''}.`:result.error||'Connection failed.');}catch(error){setKimiMessage(error instanceof Error?error.message:'Connection failed');}finally{setKimiBusy(false);}}
  async function clearKimi(){if(!orgId||!confirm('Remove stored Moonshot API key? Kimi Code mod editing will stop working.'))return;setKimiBusy(true);try{const result=await api.delete<{provider:'codex'}>(`/api/orgs/${orgId}/integrations/kimi`);setKimiConfigured(false);setKimiKey('');setModAiProvider(result.provider);setKimiMessage('Moonshot API key removed. Codex is now selected.');}catch(error){setKimiMessage(error instanceof Error?error.message:'Could not remove key');}finally{setKimiBusy(false);}}
  async function saveCloudflare(e:React.FormEvent){e.preventDefault();if(!orgId||!cloudflareToken.trim())return;setCloudflareBusy(true);setCloudflareMessage('');try{const result=await api.post<{configured:boolean}>(`/api/orgs/${orgId}/integrations/cloudflare`,{apiToken:cloudflareToken.trim()});setCloudflareConfigured(result.configured);setCloudflareToken('');setCloudflareMessage('Cloudflare API token encrypted and saved.');}catch(error){setCloudflareMessage(error instanceof Error?error.message:'Could not save Cloudflare API token');}finally{setCloudflareBusy(false);}}
  async function clearCloudflare(){if(!orgId||!confirm('Remove the stored Cloudflare API token? Future DNS automation will be unavailable until another token is saved.'))return;setCloudflareBusy(true);setCloudflareMessage('');try{await api.delete(`/api/orgs/${orgId}/integrations/cloudflare`);setCloudflareConfigured(false);setCloudflareToken('');setCloudflareMessage('Cloudflare API token removed.');}catch(error){setCloudflareMessage(error instanceof Error?error.message:'Could not remove Cloudflare API token');}finally{setCloudflareBusy(false);}}
  async function saveDigitalOcean(e:React.FormEvent){e.preventDefault();if(!orgId||!digitalOceanToken.trim())return;setDigitalOceanBusy(true);setDigitalOceanMessage('');try{const result=await api.post<{configured:boolean}>(`/api/orgs/${orgId}/integrations/digitalocean`,{apiToken:digitalOceanToken.trim()});setDigitalOceanConfigured(result.configured);setDigitalOceanToken('');setDigitalOceanMessage('DigitalOcean API token encrypted and saved.');}catch(error){setDigitalOceanMessage(error instanceof Error?error.message:'Could not save DigitalOcean token');}finally{setDigitalOceanBusy(false);}}
  async function testDigitalOcean(){if(!orgId)return;setDigitalOceanBusy(true);setDigitalOceanMessage('Testing account access…');try{const result=await api.post<{ok:boolean;status?:string;emailVerified?:boolean;error?:string}>(`/api/orgs/${orgId}/integrations/digitalocean/test`,{});setDigitalOceanMessage(result.ok?`Connected. Account status: ${result.status}${result.emailVerified?' · email verified':''}.`:result.error||'Connection failed.');}catch(error){setDigitalOceanMessage(error instanceof Error?error.message:'Connection failed');}finally{setDigitalOceanBusy(false);}}
  async function clearDigitalOcean(){if(!orgId||!confirm('Remove the stored DigitalOcean API token? Future server automation will be unavailable.'))return;setDigitalOceanBusy(true);try{await api.delete(`/api/orgs/${orgId}/integrations/digitalocean`);setDigitalOceanConfigured(false);setDigitalOceanToken('');setDigitalOceanMessage('DigitalOcean API token removed.');}catch(error){setDigitalOceanMessage(error instanceof Error?error.message:'Could not remove DigitalOcean token');}finally{setDigitalOceanBusy(false);}}
  async function saveMailgun(e:React.FormEvent){e.preventDefault();if(!orgId)return;setMailgunBusy(true);setMailgunMessage('');try{const result=await api.post<{configured:boolean;domain:string;fromEmail:string;region:'us'|'eu'}>(`/api/orgs/${orgId}/integrations/mailgun`,{domain:mailgunDomain,fromEmail:mailgunFrom,region:mailgunRegion,...(mailgunKey.trim()?{apiKey:mailgunKey.trim()}:{})});setMailgunConfigured(result.configured);setMailgunDomain(result.domain);setMailgunFrom(result.fromEmail);setMailgunRegion(result.region);setMailgunKey('');setMailgunMessage('Mailgun settings encrypted and saved.');}catch(error){setMailgunMessage(error instanceof Error?error.message:'Could not save Mailgun settings');}finally{setMailgunBusy(false);}}
  async function testMailgun(){if(!orgId)return;setMailgunBusy(true);setMailgunMessage('Sending test email…');try{const result=await api.post<{recipient:string}>(`/api/orgs/${orgId}/integrations/mailgun/test`,{});setMailgunMessage(`Test email sent to ${result.recipient}.`);}catch(error){setMailgunMessage(error instanceof Error?error.message:'Could not send test email');}finally{setMailgunBusy(false);}}
  async function clearMailgun(){if(!orgId||!confirm('Remove Mailgun credentials? New registrations will no longer require email verification.'))return;setMailgunBusy(true);try{await api.delete(`/api/orgs/${orgId}/integrations/mailgun`);setMailgunConfigured(false);setMailgunKey('');setMailgunMessage('Mailgun integration removed.');}catch(error){setMailgunMessage(error instanceof Error?error.message:'Could not remove Mailgun');}finally{setMailgunBusy(false);}}
  async function saveStripe(e:React.FormEvent){e.preventDefault();if(!orgId)return;setStripeBusy(true);setStripeMessage('');try{const result=await api.post<{configured:boolean;webhookConfigured?:boolean;webhookUrl?:string}>(`/api/orgs/${orgId}/integrations/stripe`,{...(stripeSecretKey.trim()?{secretKey:stripeSecretKey.trim()}:{}),...(stripeWebhookSecret.trim()?{webhookSecret:stripeWebhookSecret.trim()}:{})});setStripeConfigured(result.configured);setStripeWebhookConfigured(Boolean(result.webhookConfigured));if(result.webhookUrl)setStripeWebhookUrl(result.webhookUrl);setStripeSecretKey('');setStripeWebhookSecret('');setStripeMessage(result.webhookConfigured?'Stripe settings encrypted and saved.':'Stripe API key encrypted and saved. Add the webhook signing secret after you create the Stripe webhook.');}catch(error){setStripeMessage(error instanceof Error?error.message:'Could not save Stripe settings');}finally{setStripeBusy(false);}}
  async function testStripe(){if(!orgId)return;setStripeBusy(true);setStripeMessage('Testing Stripe account access…');try{const result=await api.post<{ok:boolean;livemode?:boolean;chargesEnabled?:boolean;error?:string}>(`/api/orgs/${orgId}/integrations/stripe/test`,{});setStripeMessage(result.ok?`Connected. ${result.livemode?'Live':'Test'} mode${result.chargesEnabled?' · charges enabled':''}.`:result.error||'Connection failed.');}catch(error){setStripeMessage(error instanceof Error?error.message:'Connection failed');}finally{setStripeBusy(false);}}
  async function clearStripe(){if(!orgId||!confirm('Remove stored Stripe keys? Player-portal donations will stop until new keys are saved.'))return;setStripeBusy(true);try{await api.delete(`/api/orgs/${orgId}/integrations/stripe`);setStripeConfigured(false);setStripeWebhookConfigured(false);setStripeSecretKey('');setStripeWebhookSecret('');setStripeMessage('Stripe integration removed.');}catch(error){setStripeMessage(error instanceof Error?error.message:'Could not remove Stripe');}finally{setStripeBusy(false);}}
  async function copyStripeWebhook(){const url=stripeWebhookUrl||`${location.origin}/api/donations/stripe/webhook`;try{await navigator.clipboard.writeText(url);setStripeCopied(true);setTimeout(()=>setStripeCopied(false),1500);}catch{setStripeMessage('Could not copy webhook URL');}}

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9' }}>Settings</h1>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>Manage your organisation and account</p>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1.25rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {/* Org Info */}
      <div style={card}>
        <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Organisation</h2>
        {loading ? (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Loading…</p>
        ) : org ? (
          <div>
            <InfoRow label="Name" value={org.name} />
            <InfoRow label="Slug" value={org.slug} mono />
            <InfoRow label="Org ID" value={org.id} mono />
          </div>
        ) : (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>
            Org ID: <code style={{ fontFamily: 'monospace', color: '#818cf8' }}>{orgId || '—'}</code>
          </p>
        )}
      </div>

      {/* Appearance */}
      <div style={card}>
        <h2 style={{margin:'0 0 .375rem',fontSize:'1rem',fontWeight:600,color:'#f1f5f9'}}>Appearance</h2>
        <p style={{margin:'0 0 1rem',fontSize:'.8rem',color:'#64748b'}}>Choose how Mastermind looks on this browser. The setting applies immediately and does not affect other users.</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:10}}>
          {([
            ['original','Original UI','Purple-black Mastermind colors','#111118','#6366f1'],
            ['dark','Dark UI','Neutral charcoal and slate','#0f172a','#38bdf8'],
            ['light','Light UI','Bright panels and dark text','#f8fafc','#2563eb'],
          ] as const).map(([value,title,description,background,accent])=><button key={value} type="button" onClick={()=>applyUiTheme(value)} aria-pressed={uiTheme===value} style={{textAlign:'left',padding:12,borderRadius:8,cursor:'pointer',background,border:`2px solid ${uiTheme===value?accent:'#334155'}`,color:value==='light'?'#0f172a':'#f1f5f9',boxShadow:uiTheme===value?`0 0 0 2px ${accent}33`:'none'}}><span style={{display:'block',fontWeight:700,marginBottom:4}}>{title}{uiTheme===value?' ✓':''}</span><span style={{display:'block',fontSize:'.72rem',opacity:.75}}>{description}</span><span style={{display:'flex',gap:4,marginTop:9}}><i style={{width:20,height:8,borderRadius:4,background:accent}}/><i style={{width:20,height:8,borderRadius:4,background:value==='light'?'#cbd5e1':'#334155'}}/></span></button>)}
        </div>
      </div>

      <div style={card}>
        <h2 style={{ margin: '0 0 0.375rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Minecraft Stability Safe Restart</h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#64748b' }}>
          The VM reports memory use to Mastermind each minute. When the limit is reached, Mastermind queues a normal Safe Restart with warning, save, backup, and job history. This policy applies to the organisation&apos;s Minecraft servers.
        </p>
        <form onSubmit={saveStabilityRestart} style={{display:'grid',gap:'.8rem',maxWidth:560}}>
          <label style={{display:'flex',alignItems:'center',gap:10,color:'#e2e8f0',fontSize:'.875rem',cursor:stabilityRestartSaving?'wait':'pointer'}}>
            <input type="checkbox" checked={stabilityRestartEnabled} disabled={stabilityRestartSaving} onChange={e=>setStabilityRestartEnabled(e.target.checked)} />
            Enable Stability Safe Restart
          </label>
          <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:10}}>
            <label style={labelStyle}>Restart at RAM use (GiB)<input type="number" min={4} max={64} value={stabilityRestartMemoryGiB} disabled={stabilityRestartSaving||!stabilityRestartEnabled} onChange={e=>setStabilityRestartMemoryGiB(Math.max(4,Math.min(64,Number(e.target.value)||4)))} style={inputStyle}/></label>
            <label style={labelStyle}>Minimum time between restarts<select value={stabilityRestartCooldownMinutes} disabled={stabilityRestartSaving||!stabilityRestartEnabled} onChange={e=>setStabilityRestartCooldownMinutes(Number(e.target.value))} style={inputStyle}><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={120}>2 hours</option><option value={240}>4 hours</option><option value={480}>8 hours</option><option value={720}>12 hours</option><option value={1440}>24 hours</option></select></label>
          </div>
          <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}><button disabled={stabilityRestartSaving} style={btnPrimary}>{stabilityRestartSaving?'Saving…':'Save stability policy'}</button><span style={{fontSize:'.78rem',color:stabilityRestartEnabled?'#4ade80':'#94a3b8'}}>{stabilityRestartEnabled?`Enabled at ${stabilityRestartMemoryGiB} GiB`:'Disabled'}</span></div>
          {stabilityRestartMessage&&<p style={{margin:0,color:/saved|disabled/i.test(stabilityRestartMessage)?'#4ade80':'#f87171',fontSize:'.8rem'}}>{stabilityRestartMessage}</p>}
        </form>
      </div>

      <div style={card}>
        <h2 style={{ margin: '0 0 0.375rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Maintenance mode</h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#64748b' }}>
          This password is written to <code>serverconfig.xml</code> as <code>ServerPassword</code> when you put a server in maintenance from the manager page. The live server then safely restarts. The password is encrypted here and never shown again.
        </p>
        <form onSubmit={async e=>{e.preventDefault();if(!orgId)return;setMaintenanceBusy(true);setMaintenanceMessage('');try{const saved=await api.post<{ok:boolean;configured:boolean}>(`/api/orgs/${orgId}/integrations/maintenance-password`,{password:maintenancePassword});setMaintenancePasswordConfigured(saved.configured);setMaintenancePassword('');setMaintenanceMessage('Maintenance password saved.');}catch(err){setMaintenanceMessage(err instanceof Error?err.message:'Could not save maintenance password');}finally{setMaintenanceBusy(false);}}} style={{display:'grid',gap:'.75rem',maxWidth:420}}>
          <div>
            <label style={labelStyle}>Maintenance password</label>
            <input type="password" autoComplete="new-password" value={maintenancePassword} onChange={e=>setMaintenancePassword(e.target.value)} placeholder={maintenancePasswordConfigured?'Leave blank to keep the stored password':'4–32 characters'} style={inputStyle}/>
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
            <button disabled={maintenanceBusy||!maintenancePassword.trim()} style={btnPrimary}>{maintenanceBusy?'Saving…':'Save password'}</button>
            {maintenancePasswordConfigured&&<button type="button" disabled={maintenanceBusy} onClick={async()=>{if(!orgId||!confirm('Remove the stored maintenance password? Servers already in maintenance keep their current password until you exit maintenance.'))return;setMaintenanceBusy(true);setMaintenanceMessage('');try{await api.delete(`/api/orgs/${orgId}/integrations/maintenance-password`);setMaintenancePasswordConfigured(false);setMaintenanceMessage('Maintenance password removed.');}catch(err){setMaintenanceMessage(err instanceof Error?err.message:'Could not remove password');}finally{setMaintenanceBusy(false);}}} style={{...btnPrimary,background:'#991b1b'}}>Remove</button>}
            <span style={{fontSize:'.8rem',color:maintenancePasswordConfigured?'#4ade80':'#94a3b8'}}>{maintenancePasswordConfigured?'Configured':'Not configured'}</span>
          </div>
          {maintenanceMessage&&<p style={{margin:0,color:/saved|removed/i.test(maintenanceMessage)?'#4ade80':'#f87171',fontSize:'.8rem'}}>{maintenanceMessage}</p>}
        </form>
      </div>

      {/* AI Mod Editor */}
      <div style={card}>
        <h2 style={{margin:'0 0 .375rem',fontSize:'1rem',fontWeight:600,color:'#f1f5f9'}}>AI Mod Editor</h2><p style={{margin:'0 0 1rem',fontSize:'.8rem',color:'#64748b'}}>Choose which agent proposes mod changes. Both agents preserve the existing review-and-approve diff workflow; neither can save automatically.</p>
        <label style={labelStyle}>Selected agent</label><div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:10,marginBottom:12}}>{([['codex','Codex','OpenAI Responses API'],['kimi','Kimi Code','Moonshot OpenAI-compatible API']] as const).map(([value,title,description])=><button key={value} type="button" disabled={providerBusy} onClick={()=>void selectModAgent(value)} aria-pressed={modAiProvider===value} style={{textAlign:'left',padding:12,borderRadius:8,cursor:providerBusy?'wait':'pointer',background:modAiProvider===value?'rgba(99,102,241,.14)':'#0d0d14',border:`2px solid ${modAiProvider===value?'#6366f1':'#252532'}`,color:'#f1f5f9'}}><strong style={{display:'block'}}>{title}{modAiProvider===value?' ✓':''}</strong><small style={{color:'#64748b'}}>{description}</small></button>)}</div>{providerMessage&&<p style={{color:/selected/i.test(providerMessage)?'#4ade80':'#f87171',fontSize:'.8rem'}}>{providerMessage}</p>}
        <details open={modAiProvider==='codex'} style={{borderTop:'1px solid #252532',paddingTop:12,marginTop:8}}><summary style={{cursor:'pointer',color:'#e2e8f0',fontWeight:600}}>Codex credentials {openaiConfigured&&<span style={{color:'#4ade80'}}>· Configured</span>}</summary><form onSubmit={saveOpenAi} style={{display:'grid',gap:'.875rem',marginTop:12}}><div><label style={labelStyle}>OpenAI API key</label><input type="password" autoComplete="off" value={openaiKey} onChange={e=>setOpenaiKey(e.target.value)} placeholder={openaiConfigured?'Leave blank to keep existing key':'sk-…'} style={inputStyle}/></div><div><label style={labelStyle}>Model</label><select value={openaiModel} onChange={e=>setOpenaiModel(e.target.value)} style={inputStyle}><option value="gpt-5.3-codex">gpt-5.3-codex (recommended)</option><option value="gpt-5.2-codex">gpt-5.2-codex</option><option value="gpt-5.1-codex">gpt-5.1-codex</option><option value="gpt-5.1-codex-mini">gpt-5.1-codex-mini</option><option value="gpt-5.1-codex-max">gpt-5.1-codex-max</option></select></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button disabled={openaiBusy||(!openaiConfigured&&!openaiKey.trim())} style={btnPrimary}>{openaiBusy?'Working…':'Save Codex settings'}</button><button type="button" disabled={openaiBusy||!openaiConfigured} onClick={()=>void testOpenAi()} style={{...btnPrimary,background:'#334155'}}>Test connection</button>{openaiConfigured&&<button type="button" disabled={openaiBusy} onClick={()=>void clearOpenAi()} style={{...btnPrimary,background:'#991b1b'}}>Remove key</button>}</div>{openaiMessage&&<p style={{margin:0,color:/saved|Connected|removed/i.test(openaiMessage)?'#4ade80':'#f87171',fontSize:'.8rem'}}>{openaiMessage}</p>}</form><p style={{color:'#64748b',fontSize:'.75rem'}}>Create a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" style={{color:'#818cf8'}}>OpenAI API keys</a>. ChatGPT subscriptions do not include API usage.</p></details>
        <details open={modAiProvider==='kimi'} style={{borderTop:'1px solid #252532',paddingTop:12,marginTop:8}}><summary style={{cursor:'pointer',color:'#e2e8f0',fontWeight:600}}>Kimi Code credentials {kimiConfigured&&<span style={{color:'#4ade80'}}>· Configured</span>}</summary><form onSubmit={saveKimi} style={{display:'grid',gap:'.875rem',marginTop:12}}><div><label style={labelStyle}>Moonshot API key</label><input type="password" autoComplete="off" value={kimiKey} onChange={e=>setKimiKey(e.target.value)} placeholder={kimiConfigured?'Leave blank to keep existing key':'sk-…'} style={inputStyle}/></div><div><label style={labelStyle}>Model</label><input value={kimiModel} onChange={e=>setKimiModel(e.target.value)} placeholder="kimi-for-coding" style={inputStyle}/><small style={{display:'block',color:'#64748b',marginTop:4}}>Default from Kimi Code: <code>kimi-for-coding</code>. Change this if your Moonshot account exposes a different model.</small></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button disabled={kimiBusy||(!kimiConfigured&&!kimiKey.trim())} style={btnPrimary}>{kimiBusy?'Working…':'Save Kimi settings'}</button><button type="button" disabled={kimiBusy||!kimiConfigured} onClick={()=>void testKimi()} style={{...btnPrimary,background:'#334155'}}>Test connection</button>{kimiConfigured&&<button type="button" disabled={kimiBusy} onClick={()=>void clearKimi()} style={{...btnPrimary,background:'#991b1b'}}>Remove key</button>}</div>{kimiMessage&&<p style={{margin:0,color:/saved|Connected|removed/i.test(kimiMessage)?'#4ade80':'#f87171',fontSize:'.8rem'}}>{kimiMessage}</p>}</form><p style={{color:'#64748b',fontSize:'.75rem'}}>Use a Moonshot Platform API key. Kimi Code&apos;s interactive OAuth login is intentionally not stored by Mastermind. See <a href="https://github.com/MoonshotAI/kimi-code" target="_blank" rel="noreferrer" style={{color:'#818cf8'}}>Kimi Code</a>.</p></details>
        <p style={{color:'#64748b',fontSize:'.75rem',margin:'1rem 0 0'}}>API keys stay server-side, are encrypted at rest, and are never returned to the browser. Provider usage is billed by its provider.</p>
      </div>

      {/* Cloudflare DNS */}
      <div style={card}>
        <h2 style={{margin:'0 0 .375rem',fontSize:'1rem',fontWeight:600,color:'#f1f5f9'}}>Cloudflare DNS</h2>
        <p style={{margin:'0 0 1rem',fontSize:'.8rem',color:'#64748b'}}>Securely store a scoped Cloudflare API token for the upcoming guided domain, subdomain, proxy, and DNS-forward setup. Saving a token does not change DNS yet.</p>
        <form onSubmit={saveCloudflare} style={{display:'grid',gap:'.875rem'}}>
          <div>
            <label style={labelStyle}>Cloudflare API token</label>
            <input type="password" autoComplete="off" value={cloudflareToken} onChange={e=>setCloudflareToken(e.target.value)} placeholder={cloudflareConfigured?'Paste a new token to replace the stored token':'Paste a scoped API token'} style={inputStyle}/>
            <small style={{display:'block',color:'#64748b',marginTop:4}}>Use a scoped API token, not the Global API Key. Grant only the zones and DNS permissions the future setup will manage.</small>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
            <button disabled={cloudflareBusy||!cloudflareToken.trim()} style={btnPrimary}>{cloudflareBusy?'Saving…':cloudflareConfigured?'Replace token':'Save token'}</button>
            {cloudflareConfigured&&<button type="button" disabled={cloudflareBusy} onClick={()=>void clearCloudflare()} style={{...btnPrimary,background:'#991b1b'}}>Remove token</button>}
            <span style={{fontSize:'.8rem',color:cloudflareConfigured?'#4ade80':'#94a3b8'}}>{cloudflareConfigured?'Configured and encrypted':'Not configured'}</span>
          </div>
          {cloudflareMessage&&<p style={{margin:0,color:/saved|removed/i.test(cloudflareMessage)?'#4ade80':'#f87171',fontSize:'.8rem'}}>{cloudflareMessage}</p>}
        </form>
        <p style={{color:'#64748b',fontSize:'.75rem',margin:'1rem 0 0'}}>The token is encrypted at rest, never returned to the browser, and excluded from audit details. Only organization administrators can replace or remove it.</p>
      </div>

      {/* DigitalOcean */}
      <div style={card}>
        <h2 style={{margin:'0 0 .375rem',fontSize:'1rem',fontWeight:600,color:'#f1f5f9'}}>DigitalOcean</h2>
        <p style={{margin:'0 0 1rem',fontSize:'.8rem',color:'#64748b'}}>Securely store a DigitalOcean personal access token for future AI-guided server, networking, firewall, and DNS setup. Saving or testing a token does not create or change cloud resources.</p>
        <form onSubmit={saveDigitalOcean} style={{display:'grid',gap:'.875rem'}}>
          <div><label style={labelStyle}>Personal access token</label><input type="password" autoComplete="off" value={digitalOceanToken} onChange={e=>setDigitalOceanToken(e.target.value)} placeholder={digitalOceanConfigured?'Paste a new token to replace the stored token':'dop_v1_…'} style={inputStyle}/><small style={{display:'block',color:'#64748b',marginTop:4}}>Use custom scopes and grant only the resources Mastermind will manage. The connection test requires <code>account:read</code>.</small></div>
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}><button disabled={digitalOceanBusy||!digitalOceanToken.trim()} style={btnPrimary}>{digitalOceanBusy?'Working…':digitalOceanConfigured?'Replace token':'Save token'}</button><button type="button" disabled={digitalOceanBusy||!digitalOceanConfigured} onClick={()=>void testDigitalOcean()} style={{...btnPrimary,background:'#334155'}}>Test connection</button>{digitalOceanConfigured&&<button type="button" disabled={digitalOceanBusy} onClick={()=>void clearDigitalOcean()} style={{...btnPrimary,background:'#991b1b'}}>Remove token</button>}<span style={{fontSize:'.8rem',color:digitalOceanConfigured?'#4ade80':'#94a3b8'}}>{digitalOceanConfigured?'Configured and encrypted':'Not configured'}</span></div>
          {digitalOceanMessage&&<p style={{margin:0,color:/saved|Connected|removed/i.test(digitalOceanMessage)?'#4ade80':'#f87171',fontSize:'.8rem'}}>{digitalOceanMessage}</p>}
        </form>
        <p style={{color:'#64748b',fontSize:'.75rem',margin:'1rem 0 0'}}>The token stays server-side, is encrypted at rest, is never returned to the browser, and is excluded from audit details. Resource creation remains disabled until a later automation workflow is explicitly approved.</p>
      </div>

      {/* Stripe donations */}
      <div style={card}>
        <h2 style={{margin:'0 0 .375rem',fontSize:'1rem',fontWeight:600,color:'#f1f5f9'}}>Stripe Donations</h2>
        <p style={{margin:'0 0 1rem',fontSize:'.8rem',color:'#64748b'}}>Store the Stripe secret key now. Add the webhook signing secret after you create the endpoint in Stripe. Payments stay tied to the signed-in Steam account. Keys are encrypted at rest and never shown again.</p>
        <form onSubmit={saveStripe} style={{display:'grid',gap:'.875rem'}}>
          <div><label style={labelStyle}>Secret key</label><input type="password" autoComplete="off" value={stripeSecretKey} onChange={e=>setStripeSecretKey(e.target.value)} placeholder={stripeConfigured?'Leave blank to keep existing key':'sk_live_… or sk_test_…'} style={inputStyle}/></div>
          <div><label style={labelStyle}>Webhook signing secret</label><input type="password" autoComplete="off" value={stripeWebhookSecret} onChange={e=>setStripeWebhookSecret(e.target.value)} placeholder={stripeWebhookConfigured?'Leave blank to keep existing secret':'Optional until the Stripe webhook exists — whsec_…'} style={inputStyle}/></div>
          <div>
            <label style={labelStyle}>Webhook URL</label>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              <input readOnly value={stripeWebhookUrl||`${typeof location!=='undefined'?location.origin:''}/api/donations/stripe/webhook`} style={{...inputStyle,flex:1,minWidth:240}}/>
              <button type="button" onClick={()=>void copyStripeWebhook()} style={{...btnPrimary,background:'#334155'}}>{stripeCopied?'Copied':'Copy URL'}</button>
            </div>
            <small style={{display:'block',color:'#64748b',marginTop:4}}>In Stripe Dashboard → Developers → Webhooks, add this URL for <code>checkout.session.completed</code>, <code>charge.refunded</code>, and <code>charge.dispute.closed</code>.</small>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
            <button disabled={stripeBusy||(!stripeSecretKey.trim()&&!(stripeConfigured&&stripeWebhookSecret.trim()))} style={btnPrimary}>{stripeBusy?'Working…':'Save Stripe settings'}</button>
            <button type="button" disabled={stripeBusy||!stripeConfigured} onClick={()=>void testStripe()} style={{...btnPrimary,background:'#334155'}}>Test connection</button>
            {stripeConfigured&&<button type="button" disabled={stripeBusy} onClick={()=>void clearStripe()} style={{...btnPrimary,background:'#991b1b'}}>Remove Stripe</button>}
            <span style={{fontSize:'.8rem',color:stripeConfigured?'#4ade80':'#94a3b8'}}>{stripeConfigured?(stripeWebhookConfigured?'Configured and encrypted':'API key saved · webhook still needed'):'Not configured'}</span>
          </div>
          {stripeMessage&&<p style={{margin:0,color:/saved|Connected|removed/i.test(stripeMessage)?'#4ade80':'#f87171',fontSize:'.8rem'}}>{stripeMessage}</p>}
        </form>
        <p style={{color:'#64748b',fontSize:'.75rem',margin:'1rem 0 0'}}>Use test keys first. Checkout stays disabled until both the secret key and webhook signing secret are saved. Secrets are never returned to the browser or written to audit logs.</p>
      </div>

      {/* Mailgun */}
      <div style={card}>
        <h2 style={{margin:'0 0 .375rem',fontSize:'1rem',fontWeight:600,color:'#f1f5f9'}}>Mailgun Email</h2>
        <p style={{margin:'0 0 1rem',fontSize:'.8rem',color:'#64748b'}}>Confirm new self-registered email addresses now and provide the delivery foundation for future email notifications. Existing and administrator-created accounts remain verified.</p>
        <form onSubmit={saveMailgun} style={{display:'grid',gap:'.875rem'}}>
          <div><label style={labelStyle}>Private API key</label><input type="password" autoComplete="off" value={mailgunKey} onChange={e=>setMailgunKey(e.target.value)} placeholder={mailgunConfigured?'Leave blank to keep existing key':'key-…'} style={inputStyle}/></div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}>
            <div><label style={labelStyle}>Sending domain</label><input value={mailgunDomain} onChange={e=>setMailgunDomain(e.target.value)} placeholder="mail.mg7d.com" required style={inputStyle}/></div>
            <div><label style={labelStyle}>From email</label><input type="email" value={mailgunFrom} onChange={e=>setMailgunFrom(e.target.value)} placeholder="noreply@mail.mg7d.com" required style={inputStyle}/></div>
            <div><label style={labelStyle}>Mailgun region</label><select value={mailgunRegion} onChange={e=>setMailgunRegion(e.target.value as 'us'|'eu')} style={inputStyle}><option value="us">United States</option><option value="eu">European Union</option></select></div>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}><button disabled={mailgunBusy||!mailgunDomain.trim()||!mailgunFrom.trim()||(!mailgunConfigured&&!mailgunKey.trim())} style={btnPrimary}>{mailgunBusy?'Working…':'Save Mailgun settings'}</button><button type="button" disabled={mailgunBusy||!mailgunConfigured} onClick={()=>void testMailgun()} style={{...btnPrimary,background:'#334155'}}>Send test to me</button>{mailgunConfigured&&<button type="button" disabled={mailgunBusy} onClick={()=>void clearMailgun()} style={{...btnPrimary,background:'#991b1b'}}>Remove Mailgun</button>}<span style={{fontSize:'.8rem',color:mailgunConfigured?'#4ade80':'#94a3b8'}}>{mailgunConfigured?'Verification enabled':'Not configured'}</span></div>
          {mailgunMessage&&<p style={{margin:0,color:/saved|sent|removed/i.test(mailgunMessage)?'#4ade80':'#f87171',fontSize:'.8rem'}}>{mailgunMessage}</p>}
        </form>
        <p style={{color:'#64748b',fontSize:'.75rem',margin:'1rem 0 0'}}>The private key is encrypted at rest and never returned to the browser. Sandbox domains can send only to recipients authorized in Mailgun.</p>
      </div>

      {/* Discord Webhook */}
      <div style={card}>
        <h2 style={{ margin: '0 0 0.375rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Discord Webhook</h2>
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.8rem', color: '#64748b' }}>
          Set a Discord webhook URL to receive notifications for alerts and important events.
        </p>
        <form onSubmit={handleUpdateWebhook} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div>
            <label style={labelStyle}>Webhook URL</label>
            <input
              style={inputStyle}
              type="url"
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/…"
              onFocus={onFocus}
              onBlur={onBlur}
            />
          </div>
          {webhookError && <p style={{ color: '#f87171', margin: 0, fontSize: '0.8rem' }}>{webhookError}</p>}
          {webhookSuccess && <p style={{ color: '#4ade80', margin: 0, fontSize: '0.8rem' }}>{webhookSuccess}</p>}
          <div>
            <button type="submit" style={btnPrimary} disabled={webhookLoading}>
              {webhookLoading ? 'Saving…' : 'Save Webhook'}
            </button>
          </div>
        </form>
      </div>

      {/* Discord Bot */}
      <div style={card} id="discord-bot">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'start',gap:16,flexWrap:'wrap'}}>
          <div><h2 style={{margin:'0 0 .375rem',fontSize:'1rem',fontWeight:600,color:'#f1f5f9'}}>Discord Bot</h2><p style={{margin:'0 0 1rem',fontSize:'.8rem',color:'#64748b'}}>Let trusted Discord staff start, stop, or restart this server. The bot tells them when the action succeeds or fails.</p></div>
          <a href="/downloads/Mastermind-Discord-Bot-0.1.0.zip" download style={{...btnPrimary,textDecoration:'none',display:'inline-block',flexShrink:0}}>Download bot v0.1.0</a>
        </div>

        <h3 style={{color:'#e2e8f0',fontSize:'.9rem',margin:'1rem 0 .5rem'}}>What you need</h3>
        <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:'.8rem'}}><tbody>
          {[
            ['DISCORD_TOKEN','The bot password. Copy it from Developer Portal → Bot → Reset Token. Keep it secret.'],
            ['DISCORD_CLIENT_ID','The bot Application ID from Developer Portal → General Information.'],
            ['DISCORD_GUILD_ID','Your Discord server ID. This makes commands appear immediately.'],
            ['DISCORD_ALLOWED_ROLE_IDS','Discord role IDs for staff allowed to use the commands. Separate multiple IDs with commas.'],
            ['MASTERMIND_EMAIL / PASSWORD','The Mastermind account the bot will use to create server jobs.'],
            ['MASTERMIND_ORG_ID',orgId||'Organization ID shown at the top of this Settings page.'],
            ['MASTERMIND_SERVER_ID','Optional. Leave blank to use the first registered Minecraft server.'],
          ].map(([name,description])=><tr key={name}><td style={{padding:'.55rem',borderBottom:'1px solid #1e1e2a',color:'#818cf8',fontFamily:'monospace',whiteSpace:'nowrap'}}>{name}</td><td style={{padding:'.55rem',borderBottom:'1px solid #1e1e2a',color:'#94a3b8'}}>{description}</td></tr>)}
        </tbody></table></div>

        <h3 style={{color:'#e2e8f0',fontSize:'.9rem',margin:'1.25rem 0 .5rem'}}>Setup for first-time users</h3>
        <p style={{color:'#94a3b8',fontSize:'.82rem',lineHeight:1.6}}>Allow about 20 minutes. You need a Discord account, a Discord server you own or manage, and the ability to install Node.js on the computer that runs Mastermind. An ID is only a long number that Discord uses to identify a server, role, or person.</p>
        <div style={{background:'#0a0a12',border:'1px solid #252532',borderRadius:7,padding:'.75rem .85rem',marginBottom:8,color:'#cbd5e1',fontSize:'.8rem',lineHeight:1.55}}><strong>Before copying anything:</strong> Open Notepad and create a temporary file named <code>Mastermind Bot Setup Notes.txt</code> in your Documents folder. Each instruction below tells you which label to put before a copied value. These labels match the lines in the bot&apos;s <code>.env</code> configuration file. The notes prevent values from being lost while moving between Discord and Mastermind. Delete this temporary notes file after the bot works because it contains passwords.</div>
        {[
          ['1. Make a Discord server (skip if you already have one)',<ol key="server"><li>Open Discord and click the <strong>+</strong> button on the far-left server list.</li><li>Choose <strong>Create My Own</strong>, then <strong>For me and my friends</strong>.</li><li>Name it anything you like. You are now its owner.</li></ol>],
          ['2. Create the bot',<ol key="create"><li>Open the <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer" style={{color:'#818cf8'}}>Discord Developer Portal</a> and sign in with Discord.</li><li>Click <strong>New Application</strong>, enter <code>Mastermind</code>, accept the terms, and click <strong>Create</strong>.</li><li>On <strong>General Information</strong>, copy <strong>Application ID</strong>. In your temporary setup-notes file, add a new line containing <code>DISCORD_CLIENT_ID=</code> and paste the number after the equals sign.</li><li>Click <strong>Bot</strong> on the left, then <strong>Reset Token</strong>. Copy the token. Add a line containing <code>DISCORD_TOKEN=</code> to the same notes file and paste the token after it. Treat this file like a password.</li></ol>],
          ['3. Invite the bot',<ol key="invite"><li>In the Developer Portal, click <strong>OAuth2</strong>, then <strong>URL Generator</strong>.</li><li>Under Scopes, check <code>bot</code> and <code>applications.commands</code>.</li><li>Under Bot Permissions, check <strong>Send Messages</strong> and <strong>Use Application Commands</strong>.</li><li>Copy the generated URL at the bottom, open it in a browser, select your Discord server, and click <strong>Authorize</strong>.</li></ol>],
          ['4. Copy your Discord server ID',<ol key="ids"><li>In the Discord desktop app, click the gear beside your name.</li><li>Open <strong>Advanced</strong> and turn on <strong>Developer Mode</strong>.</li><li>Close Settings, right-click your server icon, and click <strong>Copy Server ID</strong>. In the same setup-notes file, add <code>DISCORD_GUILD_ID=</code> and paste the number after it.</li><li>For the simplest safe setup, right-click your own name and click <strong>Copy User ID</strong>. Add <code>DISCORD_ALLOWED_USER_IDS=</code> to the notes and paste the number after it. This setting allows only you to use the bot.</li></ol>],
          ['5. Create the bot’s Mastermind account',<ol key="mastermind"><li><strong>Why:</strong> The Discord bot signs into Mastermind to perform commands. Its own account makes Discord actions easy to identify on the Jobs page.</li><li>Open <a href="/accounts" style={{color:'#818cf8'}}><strong>Accounts</strong></a> from Mastermind&apos;s left menu and find <strong>Create account</strong>.</li><li>Enter <code>Discord Bot</code> for the display name. Enter a unique email-style login and create a password containing at least 12 characters.</li><li>For Access level, select <strong>Operator — can control servers</strong>, then click <strong>Create account</strong>.</li><li>In your setup notes, add <code>MASTERMIND_EMAIL=</code> and <code>MASTERMIND_PASSWORD=</code> using the login you just created.</li><li>Return to <strong>Settings</strong>. In the Organization box at the top, copy <strong>Org ID</strong>. Add <code>MASTERMIND_ORG_ID=</code> and paste it after the equals sign.</li><li>Add <code>MASTERMIND_SERVER_ID=</code> and leave it empty if you have only one Minecraft server. The bot selects that server automatically.</li></ol>],
          ['6. Download and fill in the real configuration file',<ol key="file"><li>Click <strong>Download bot v0.1.0</strong> above. Right-click the ZIP in Downloads, choose <strong>Extract All</strong>, then open the extracted folder.</li><li>In File Explorer, enable <strong>View → Show → File name extensions</strong>.</li><li>Rename <code>.env.example</code> to <code>.env</code>. Confirm the name change, then open it with Notepad. This <code>.env</code> file is where the bot actually reads its settings when it starts.</li><li>Copy the values from your temporary setup-notes file into the matching lines in <code>.env</code>. Do not add spaces around <code>=</code>. Save <code>.env</code>.</li><li>After the bot passes the test in step 8, delete <code>Mastermind Bot Setup Notes.txt</code>. Keep <code>.env</code>; the bot needs it each time it starts.</li></ol>],
          ['7. Start it on Windows',<ol key="start"><li>Install <a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer" style={{color:'#818cf8'}}>Node.js LTS</a> using the normal Windows installer and its default choices.</li><li>Open the extracted bot folder. Click the File Explorer address bar, type <code>powershell</code>, and press Enter.</li><li>Run <code>npm install --omit=dev</code>. Wait until it finishes.</li><li>Run <code>Get-Content .env | ForEach-Object {'{'} if ($_ -match '^([^#=]+)=(.*)$') {'{'} [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') {'}'} {'}'}; npm start</code>.</li><li>Leave that PowerShell window open. A message saying the bot logged in means it is running.</li></ol>],
          ['8. Test it',<ol key="test"><li>Return to your Discord server and type <code>/start</code>.</li><li>Select the Mastermind command. The bot should say it is waiting, then report success or failure.</li><li>Try <code>/safereboot</code> only when you actually want the game server to restart.</li></ol>],
        ].map(([title,body])=><details key={String(title)} style={{border:'1px solid #252532',borderRadius:7,padding:'.7rem .85rem',marginBottom:8,color:'#94a3b8',fontSize:'.82rem',lineHeight:1.65}}><summary style={{cursor:'pointer',color:'#e2e8f0',fontWeight:600}}>{title}</summary><div style={{marginTop:8}}>{body}</div></details>)}

        <div style={{position:'relative'}}><pre style={{background:'#09090f',border:'1px solid #252532',borderRadius:7,padding:'1rem',color:'#cbd5e1',fontSize:'.72rem',overflowX:'auto',whiteSpace:'pre-wrap',wordBreak:'break-word'}}>{discordBotEnvironment}</pre><button type="button" style={{...btnPrimary,position:'absolute',right:8,top:8,padding:'.35rem .65rem',fontSize:'.72rem'}} onClick={()=>{void navigator.clipboard.writeText(discordBotEnvironment);setDiscordBotCopied(true);setTimeout(()=>setDiscordBotCopied(false),1800);}}>{discordBotCopied?'Copied':'Copy configuration'}</button></div>
        <p style={{color:'#fbbf24',fontSize:'.75rem',marginBottom:0}}>Keep the Discord token and Mastermind password out of screenshots, chat, Git, and support logs. If exposed, reset the Discord token immediately.</p>
      </div>

      {/* Agent Pairing */}
      <div style={card}>
        <h2 style={{ margin: '0 0 0.375rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Agent Pairing</h2>
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.8rem', color: '#64748b' }}>
          To register a new host agent, generate a pairing token from the Hosts page.
        </p>
        <a href="/hosts" style={{ ...btnPrimary, textDecoration: 'none', display: 'inline-block' }}>
          Go to Hosts →
        </a>
      </div>

      {/* Account */}
      <div style={card}>
        <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Account</h2>
        {loading ? (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Loading…</p>
        ) : user ? (
          <div>
            <InfoRow label="Email" value={user.email} />
            {user.name && <InfoRow label="Name" value={user.name} />}
            <InfoRow label="User ID" value={user.id} mono />
            <form onSubmit={handleChangePassword} style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'.875rem',marginTop:'1.25rem'}}>
              <div><label style={labelStyle}>Current password</label><input style={inputStyle} type="password" autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} required onFocus={onFocus} onBlur={onBlur}/></div>
              <div><label style={labelStyle}>New password</label><input style={inputStyle} type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={e=>setNewPassword(e.target.value)} required onFocus={onFocus} onBlur={onBlur}/></div>
              <div><label style={labelStyle}>Confirm new password</label><input style={inputStyle} type="password" autoComplete="new-password" minLength={12} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} required onFocus={onFocus} onBlur={onBlur}/></div>
              <div style={{gridColumn:'1 / -1'}}>
                {passwordError&&<p style={{color:'#f87171',fontSize:'.8rem'}}>{passwordError}</p>}
                {passwordSuccess&&<p style={{color:'#4ade80',fontSize:'.8rem'}}>{passwordSuccess}</p>}
                <button type="submit" style={btnPrimary} disabled={passwordLoading}>{passwordLoading?'Changing…':'Change Password'}</button>
              </div>
            </form>
          </div>
        ) : (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Could not load user info.</p>
        )}
      </div>
    </div>
  );
}
