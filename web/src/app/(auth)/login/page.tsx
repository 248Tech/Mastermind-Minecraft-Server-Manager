'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, AuthResponse } from '../../../lib/api';
import { saveAuth, isLoggedIn } from '../../../lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [mathPrompt,setMathPrompt]=useState('Loading challenge…');
  const [mathChallengeToken,setMathChallengeToken]=useState('');
  const [mathAnswer,setMathAnswer]=useState('');
  const [recaptchaSiteKey,setRecaptchaSiteKey]=useState('');
  const [recaptchaEnabled,setRecaptchaEnabled]=useState(false);
  const recaptchaHost=useRef<HTMLDivElement>(null);
  const recaptchaWidget=useRef<number|null>(null);

  async function loadSecurityChallenge(){
    const challenge=await api.get<{mathPrompt:string;mathChallengeToken:string;recaptchaEnabled:boolean;recaptchaSiteKey?:string}>('/api/auth/login-security');
    setMathPrompt(challenge.mathPrompt);setMathChallengeToken(challenge.mathChallengeToken);setMathAnswer('');setRecaptchaEnabled(challenge.recaptchaEnabled);setRecaptchaSiteKey(challenge.recaptchaSiteKey||'');
    if(recaptchaWidget.current!==null)window.grecaptcha?.reset(recaptchaWidget.current);
  }
  useEffect(() => {
    if (isLoggedIn()) {
      router.replace('/dashboard');
    }
  }, [router]);
  useEffect(()=>{void loadSecurityChallenge().catch(()=>setError('Could not load the sign-in security challenge.'));},[]);
  useEffect(()=>{
    if(!recaptchaEnabled||!recaptchaSiteKey||!recaptchaHost.current)return;
    let cancelled=false;
    const render=()=>{if(cancelled||!recaptchaHost.current||!window.grecaptcha||recaptchaWidget.current!==null)return;recaptchaWidget.current=window.grecaptcha.render(recaptchaHost.current,{sitekey:recaptchaSiteKey,theme:'dark'});};
    const existing=document.querySelector<HTMLScriptElement>('script[data-mastermind-recaptcha]');
    if(existing)render();else{const script=document.createElement('script');script.src='https://www.google.com/recaptcha/api.js?render=explicit';script.async=true;script.defer=true;script.dataset.mastermindRecaptcha='1';script.onload=render;document.head.appendChild(script);}
    const timer=setInterval(render,250);return()=>{cancelled=true;clearInterval(timer);};
  },[recaptchaEnabled,recaptchaSiteKey]);

  const inputStyle: React.CSSProperties = {
    padding: '0.6rem 0.875rem',
    borderRadius: 8,
    border: '1px solid #252532',
    fontSize: '0.9rem',
    background: '#111118',
    color: '#f1f5f9',
    width: '100%',
    outline: 'none',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const recaptchaToken=recaptchaEnabled&&recaptchaWidget.current!==null?window.grecaptcha?.getResponse(recaptchaWidget.current)||'':'';
      const res = await api.post<AuthResponse | { verification_required: true; email: string } | { approval_required: true; email: string } | { registration_received: true }>(
        mode === 'login' ? '/api/auth/login' : '/api/auth/register',
        mode==='login'?{email,password,mathChallengeToken,mathAnswer,recaptchaToken}:{email,password,name},
      );
      if ('verification_required' in res) {
        setNotice(`Check ${res.email} for a confirmation link before signing in.`);
        setMode('login');
        return;
      }
      if ('approval_required' in res) {
        setNotice(`Your email is confirmed. An administrator must approve ${res.email} before you can sign in.`);
        setMode('login');
        return;
      }
      if ('registration_received' in res) {
        setNotice('Registration received. If this is a new account, complete email confirmation and wait for administrator approval.');
        setMode('login');
        return;
      }
      saveAuth(res.access_token, res.userId, res.orgId);
      router.push('/dashboard');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      if (msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network') || msg === 'Failed to fetch' || msg.toLowerCase().includes('unreachable')) {
        setError('Cannot reach the control plane. Make sure it is running on ' + (process.env.NEXT_PUBLIC_CONTROL_PLANE_URL || 'http://localhost:3001') + ' (run: cd control-plane && pnpm dev)');
      } else {
        setError(msg);
      }
      if(mode==='login')await loadSecurityChallenge().catch(()=>undefined);
    } finally {
      setLoading(false);
    }
  }

  async function resendVerification() {
    if (!email.trim()) return;
    setLoading(true); setError(''); setNotice('');
    try { await api.post('/api/auth/resend-verification',{email});setNotice('If this address has a pending account, a new confirmation email has been sent.'); }
    catch(err){setError(err instanceof Error?err.message:'Could not resend confirmation email');}
    finally{setLoading(false);}
  }

  if (isLoggedIn()) {
    return null;
  }

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(ellipse at 30% 20%, rgba(99,102,241,0.08) 0%, #0a0a0f 60%)',
      padding: '1rem',
    }}>
      {/* Subtle grid bg */}
      <div style={{
        position: 'fixed',
        inset: 0,
        backgroundImage: 'linear-gradient(rgba(99,102,241,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.04) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
        pointerEvents: 'none',
      }} />

      <div style={{
        position: 'relative',
        background: 'rgba(13,13,20,0.95)',
        border: '1px solid #1e1e2a',
        borderRadius: 16,
        padding: '2.5rem',
        width: '100%',
        maxWidth: 400,
        boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.06)',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
          <img src="/mastermind-logo.png" alt="Mastermind" style={{width:48,height:48,objectFit:'cover',objectPosition:'center 42%',borderRadius:10,boxShadow:'0 0 24px rgba(249,115,22,.4)'}} />
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#f1f5f9' }}>Mercenary Gaming</div>
            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Staff dashboard sign-in</div>
          </div>
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', background: '#111118', borderRadius: 8, padding: 3, marginBottom: '1.75rem', border: '1px solid #1e1e2a' }}>
          {(['login', 'register'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                padding: '0.45rem',
                borderRadius: 6,
                border: 'none',
                background: mode === m ? '#6366f1' : 'transparent',
                color: mode === m ? '#fff' : '#64748b',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: mode === m ? 600 : 400,
                transition: 'all 0.15s ease',
              }}
            >
              {m === 'login' ? 'Sign in' : 'Register'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {mode === 'register' && (
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.375rem', fontWeight: 500 }}>
                Name <span style={{ color: '#64748b' }}>(optional)</span>
              </label>
              <input
                placeholder="Your name"
                value={name}
                onChange={e => setName(e.target.value)}
                style={inputStyle}
                onFocus={e => {
                  e.target.style.borderColor = '#6366f1';
                  e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)';
                }}
                onBlur={e => {
                  e.target.style.borderColor = '#252532';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>
          )}
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.375rem', fontWeight: 500 }}>
              Email
            </label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              style={inputStyle}
              onFocus={e => {
                e.target.style.borderColor = '#6366f1';
                e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)';
              }}
              onBlur={e => {
                e.target.style.borderColor = '#252532';
                e.target.style.boxShadow = 'none';
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.375rem', fontWeight: 500 }}>
              Password
            </label>
            <input
              type="password"
              placeholder={mode === 'register' ? 'At least 12 characters' : '••••••••'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={mode === 'register' ? 12 : 1}
              maxLength={128}
              style={inputStyle}
              onFocus={e => {
                e.target.style.borderColor = '#6366f1';
                e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)';
              }}
              onBlur={e => {
                e.target.style.borderColor = '#252532';
                e.target.style.boxShadow = 'none';
              }}
            />
            {mode === 'register' && (
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                Dashboard passwords must be at least 12 characters.
              </p>
            )}
          </div>

          {mode==='login'&&<div><label style={{display:'block',fontSize:'.8rem',color:'#94a3b8',marginBottom:'.375rem',fontWeight:500}}>Security check: {mathPrompt}</label><input inputMode="numeric" autoComplete="off" value={mathAnswer} onChange={e=>setMathAnswer(e.target.value)} required placeholder="Answer" style={inputStyle}/></div>}
          {mode==='login'&&recaptchaEnabled&&<div ref={recaptchaHost} style={{minHeight:78,overflow:'hidden'}}/>}

          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 6,
              padding: '0.5rem 0.75rem',
              color: '#f87171',
              fontSize: '0.85rem',
            }}>
              {error}
            </div>
          )}
          {notice&&<div style={{background:'rgba(34,197,94,.08)',border:'1px solid rgba(34,197,94,.25)',borderRadius:6,padding:'.5rem .75rem',color:'#4ade80',fontSize:'.85rem'}}>{notice}</div>}

          <button
            type="submit"
            disabled={loading||(mode==='login'&&!mathChallengeToken)}
            style={{
              padding: '0.65rem',
              background: loading ? '#3f3f52' : 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '0.9rem',
              fontWeight: 600,
              marginTop: '0.25rem',
              boxShadow: loading ? 'none' : '0 4px 16px rgba(99,102,241,0.3)',
            }}
          >
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
          {mode==='login'&&<button type="button" disabled={loading||!email.trim()} onClick={()=>void resendVerification()} style={{padding:'.5rem',background:'transparent',color:'#818cf8',border:'none',cursor:'pointer',fontSize:'.8rem'}}>Resend confirmation email</button>}
        </form>

        <p style={{ margin: '1.5rem 0 0', borderTop: '1px solid #1e1e2a', paddingTop: '1rem', fontSize: '0.75rem', color: '#64748b' }}>
          New dashboard accounts require email confirmation and administrator approval.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center', marginTop: '1rem' }}>
          <a href="/player/shop" style={portalLink}>View Shop</a>
          <a href="/player/map" style={portalLink}>View Map</a>
        </div>
      </div>
    </div>
  );
}

const portalLink: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.45rem 0.9rem',
  background: '#16161f',
  color: '#cbd5e1',
  textDecoration: 'none',
  borderRadius: 7,
  fontSize: '0.8rem',
  fontWeight: 600,
  border: '1px solid #2a2a38',
};
