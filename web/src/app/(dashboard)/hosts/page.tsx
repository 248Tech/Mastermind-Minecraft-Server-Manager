'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, Host, ServerInstance, PairingToken } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';
import { usePoll } from '../../../hooks/useRealtime';

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

const btnSecondary: React.CSSProperties = {
  padding: '0.5rem 1.125rem', background: 'transparent', color: '#94a3b8',
  border: '1px solid #252532', borderRadius: 7, cursor: 'pointer', fontSize: '0.875rem',
};

const btnDanger: React.CSSProperties = {
  padding: '0.3rem 0.6rem', background: 'transparent', color: '#f87171',
  border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem',
};

const thStyle: React.CSSProperties = {
  padding: '0.625rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600,
  color: '#64748b', letterSpacing: '0.04em', textTransform: 'uppercase',
  background: '#0d0d14', borderBottom: '1px solid #1e1e2a',
};

const tdStyle: React.CSSProperties = {
  padding: '0.75rem 1rem', fontSize: '0.875rem', borderBottom: '1px solid #1a1a24', color: '#e2e8f0',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.3rem', fontWeight: 500,
};

function Badge({ status }: { status: string | null }) {
  const s = (status || 'unknown').toLowerCase();
  const map: Record<string, { bg: string; color: string }> = {
    online:  { bg: 'rgba(34,197,94,0.1)',  color: '#4ade80' },
    offline: { bg: 'rgba(239,68,68,0.1)',  color: '#f87171' },
  };
  const { bg, color } = map[s] || { bg: 'rgba(100,116,139,0.1)', color: '#64748b' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
      padding: '0.2rem 0.6rem', borderRadius: 20,
      fontSize: '0.75rem', fontWeight: 600, background: bg, color,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {s}
    </span>
  );
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function onFocus(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.target.style.borderColor = '#6366f1';
  e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)';
}
function onBlur(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.target.style.borderColor = '#252532';
  e.target.style.boxShadow = 'none';
}

// ─── Agent download panel ─────────────────────────────────────────────────────
function AgentDownloadPanel() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const cpUrl = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_CONTROL_PLANE_URL)
    || 'http://localhost:3001';

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  const codeBox: React.CSSProperties = {
    background: '#06060b', border: '1px solid #1e1e2a', borderRadius: 7,
    padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.79rem',
    color: '#818cf8', whiteSpace: 'pre', overflowX: 'auto', margin: 0,
  };

  const PLATFORMS: { label: string; platform: string; os: string }[] = [
    { label: 'Linux x64',           platform: 'linux-amd64',   os: 'linux' },
    { label: 'Linux ARM64',          platform: 'linux-arm64',   os: 'linux' },
    { label: 'macOS Intel',          platform: 'darwin-amd64',  os: 'darwin' },
    { label: 'macOS Apple Silicon',  platform: 'darwin-arm64',  os: 'darwin' },
    { label: 'Windows x64',          platform: 'windows-amd64', os: 'windows' },
  ];

  const buildLinux = `# Requires Go 1.22+ — https://go.dev/dl/\ngit clone https://github.com/mastermind-manager/agent\ncd agent\ngo build -o mastermind-agent -ldflags="-s -w" .\n\n# Verify\n./mastermind-agent --version`;
  const buildDocker = `git clone https://github.com/mastermind-manager/agent\ncd agent\ndocker build -t mastermind-agent .`;

  return (
    <div style={{ marginBottom: '1.25rem', background: '#0d0d14', border: '1px solid #1e1e2a', borderRadius: 8, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '0.875rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: 600, color: '#f1f5f9' }}>
          <span style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', padding: '0.15rem 0.45rem', borderRadius: 5, fontSize: '0.75rem', fontWeight: 700 }}>↓</span>
          First time? Download or build the agent binary
        </span>
        <span style={{ color: '#64748b', fontSize: '0.75rem' }}>{open ? 'Hide ▲' : 'Show ▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 1rem 1rem', borderTop: '1px solid #1e1e2a' }}>
          <p style={{ margin: '0.875rem 0 1rem', fontSize: '0.84rem', color: '#94a3b8', lineHeight: 1.65 }}>
            The agent is a single static Go binary (~5 MB) with no runtime dependencies.
            Download a pre-built binary below, or build from source.
          </p>

          {/* ── Pre-built downloads ── */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.73rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
              Pre-built binaries
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {PLATFORMS.map(({ label, platform }) => (
                <a
                  key={platform}
                  href={`${cpUrl}/agent/download/${platform}`}
                  download
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                    padding: '0.4rem 0.875rem', background: 'rgba(99,102,241,0.12)',
                    border: '1px solid rgba(99,102,241,0.25)', borderRadius: 7,
                    color: '#818cf8', fontSize: '0.8rem', fontWeight: 600,
                    textDecoration: 'none', cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.22)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.12)')}
                >
                  ↓ {label}
                </a>
              ))}
            </div>
            <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#475569' }}>
              Binaries are built from source on this machine during setup. Run{' '}
              <code style={{ color: '#818cf8' }}>bash scripts/start.sh</code> to (re)build them.
            </div>
          </div>

          {/* ── Build from source ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem', marginBottom: '0.875rem' }}>
            <div>
              <div style={{ fontSize: '0.73rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>Linux / macOS — Build from source</div>
              <div style={{ position: 'relative' }}>
                <pre style={codeBox}>{buildLinux}</pre>
                <button
                  onClick={() => copy(buildLinux, 'linux')}
                  style={{ position: 'absolute', top: 7, right: 7, background: '#1e1e2a', border: '1px solid #252532', color: '#94a3b8', borderRadius: 5, padding: '0.2rem 0.5rem', fontSize: '0.72rem', cursor: 'pointer' }}
                >{copied === 'linux' ? '✓' : 'Copy'}</button>
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.73rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>Docker — Build image</div>
              <div style={{ position: 'relative' }}>
                <pre style={codeBox}>{buildDocker}</pre>
                <button
                  onClick={() => copy(buildDocker, 'docker')}
                  style={{ position: 'absolute', top: 7, right: 7, background: '#1e1e2a', border: '1px solid #252532', color: '#94a3b8', borderRadius: 5, padding: '0.2rem 0.5rem', fontSize: '0.72rem', cursor: 'pointer' }}
                >{copied === 'docker' ? '✓' : 'Copy'}</button>
              </div>
            </div>
          </div>

          <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.14)', borderRadius: 7, padding: '0.625rem 0.875rem', fontSize: '0.8rem', color: '#94a3b8', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
            <span style={{ color: '#6366f1', flexShrink: 0 }}>ℹ</span>
            <span>The agent pairs once using the token below, stores its key at <code style={{ color: '#818cf8' }}>/var/lib/mastermind-agent/agent.key</code>, and reconnects automatically on reboot.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tutorial wizard ───────────────────────────────────────────────────────────
interface TutorialStep {
  icon: string;
  title: string;
  desc: string;
  detail: string;
  actionLabel?: string;
}

function TutorialWizard({
  onClose,
  onPairHost,
  onRegisterServer,
}: {
  onClose: () => void;
  onPairHost: () => void;
  onRegisterServer: () => void;
}) {
  const [step, setStep] = useState(0);

  const steps: TutorialStep[] = [
    {
      icon: '⬡',
      title: 'Welcome to Mastermind',
      desc: 'Mastermind lets you manage multiple game servers from a single dashboard — start/stop, schedule restarts, and get Discord alerts when things go wrong.',
      detail: "This guide takes about 5 minutes. It walks you through connecting your first server end-to-end. You can reopen it any time from the sidebar.",
    },
    {
      icon: '↓',
      title: 'Step 1 — Get the Agent',
      desc: 'The agent is a small Go binary you install on the machine running your game server. It connects here, sends heartbeats, and executes commands you dispatch from this dashboard.',
      detail: 'Build from source with Go 1.22+ or use Docker. Expand "First time? Get the agent binary" in the pairing panel to see build commands.',
      actionLabel: 'I have the agent — continue',
    },
    {
      icon: '⬡',
      title: 'Step 2 — Pair a Host',
      desc: 'A Host is the physical or virtual machine your game runs on. Click "+ Pair New Host" to generate a one-time token, then run the install command on your server.',
      detail: 'The agent authenticates with the token on first run, stores a permanent key, and shows up in your host list as Online.',
      actionLabel: 'Open pairing panel',
    },
    {
      icon: '◈',
      title: 'Step 3 — Register a Server Instance',
      desc: 'Once your host is Online, click "+ Register Server" to tell Mastermind the install path, start command, and Telnet connection details for the game.',
      detail: 'One host can run multiple game server instances — a 7DTD server and a Minecraft server on the same machine, for example.',
      actionLabel: 'Open register form',
    },
    {
      icon: '⚡',
      title: "You're all set!",
      desc: 'Head to the Jobs page to send your first command — restart, backup, or a raw console command. Then explore Schedules for cron automation and Alerts for Discord notifications.',
      detail: 'Tip: check the Dashboard for an at-a-glance view of all your servers and recent job history.',
      actionLabel: 'Go to Jobs →',
    },
  ];

  const current = steps[step];

  function handleAction() {
    if (step === 2) { onPairHost(); onClose(); }
    else if (step === 3) { onRegisterServer(); onClose(); }
    else if (step === 4) { window.location.href = '/jobs'; }
    else setStep(s => s + 1);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem',
    }}>
      <div style={{
        background: '#111118', border: '1px solid #252532', borderRadius: 14,
        width: '100%', maxWidth: 540, boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(99,102,241,0.04) 100%)', borderBottom: '1px solid #1e1e2a', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <div style={{ width: 32, height: 32, background: 'linear-gradient(135deg, #6366f1, #818cf8)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', boxShadow: '0 0 16px rgba(99,102,241,0.4)' }}>⬡</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f1f5f9' }}>Mastermind Setup Guide</div>
              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{step + 1} of {steps.length}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '1.1rem', lineHeight: 1, padding: '0.25rem' }}>✕</button>
        </div>

        {/* Step dots */}
        <div style={{ display: 'flex', gap: '0.375rem', padding: '1rem 1.5rem 0', alignItems: 'center' }}>
          {steps.map((_, i) => (
            <div
              key={i}
              style={{
                height: 3, flex: 1, borderRadius: 99,
                background: i <= step ? '#6366f1' : '#1e1e2a',
                transition: 'background 0.3s',
              }}
            />
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={{ width: 40, height: 40, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', color: '#818cf8', flexShrink: 0 }}>{current.icon}</div>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9' }}>{current.title}</h2>
          </div>
          <p style={{ margin: '0 0 0.875rem', fontSize: '0.9rem', color: '#e2e8f0', lineHeight: 1.7 }}>{current.desc}</p>
          <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b', lineHeight: 1.65, background: '#0d0d14', border: '1px solid #1e1e2a', borderRadius: 8, padding: '0.75rem 0.875rem' }}>{current.detail}</p>
        </div>

        {/* Footer */}
        <div style={{ padding: '0 1.5rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0}
            style={{ background: 'none', border: '1px solid #252532', borderRadius: 7, color: step === 0 ? '#3f3f52' : '#94a3b8', padding: '0.5rem 1rem', cursor: step === 0 ? 'default' : 'pointer', fontSize: '0.85rem' }}
          >← Back</button>

          <div style={{ display: 'flex', gap: '0.625rem' }}>
            <button
              onClick={onClose}
              style={{ background: 'none', border: '1px solid #252532', borderRadius: 7, color: '#64748b', padding: '0.5rem 0.875rem', cursor: 'pointer', fontSize: '0.82rem' }}
            >Skip guide</button>

            {step < steps.length - 1 ? (
              <button
                onClick={() => current.actionLabel && step > 0 ? handleAction() : setStep(s => s + 1)}
                style={{ background: '#6366f1', border: 'none', borderRadius: 7, color: '#fff', padding: '0.5rem 1.125rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, boxShadow: '0 2px 12px rgba(99,102,241,0.35)' }}
              >{current.actionLabel || 'Next →'}</button>
            ) : (
              <button
                onClick={handleAction}
                style={{ background: '#6366f1', border: 'none', borderRadius: 7, color: '#fff', padding: '0.5rem 1.125rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, boxShadow: '0 2px 12px rgba(99,102,241,0.35)' }}
              >{current.actionLabel || 'Done'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Guide panel ──────────────────────────────────────────────────────────────
function HowItWorksGuide({ onOpenTutorial }: { onOpenTutorial: () => void }) {
  const [open, setOpen] = useState(true);
  if (!open) {
    return (
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', alignItems: 'center' }}>
        <button
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6366f1', fontSize: '0.82rem', padding: 0, display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          onClick={() => setOpen(true)}
        >
          <span style={{ fontSize: '0.9rem' }}>?</span> Show overview
        </button>
        <span style={{ color: '#252532' }}>·</span>
        <button
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#818cf8', fontSize: '0.82rem', padding: 0, display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          onClick={onOpenTutorial}
        >
          ▶ Setup wizard
        </button>
      </div>
    );
  }
  return (
    <div style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.18)', borderRadius: 10, padding: '1.25rem 1.5rem', marginBottom: '1.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#f1f5f9' }}>How Mastermind works</h3>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            onClick={onOpenTutorial}
            style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 6, color: '#818cf8', fontSize: '0.78rem', fontWeight: 600, padding: '0.25rem 0.625rem', cursor: 'pointer' }}
          >▶ Step-by-step wizard</button>
          <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '1rem', padding: 0, lineHeight: 1 }}>✕</button>
        </div>
      </div>
      <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.65 }}>
        Mastermind manages game servers running on your own machines. There are two things to set up:
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem', marginBottom: '1rem' }}>
        <div style={{ background: '#0d0d14', borderRadius: 8, padding: '1rem 1.125rem', border: '1px solid #1e1e2a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span style={{ background: 'rgba(99,102,241,0.18)', color: '#818cf8', borderRadius: 6, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem', flexShrink: 0 }}>1</span>
            <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f1f5f9' }}>Host</span>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>— the machine</span>
          </div>
          <p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.6 }}>
            A <strong style={{ color: '#e2e8f0' }}>Host</strong> is a physical or virtual machine (your VPS, home server, dedicated box) where your game server runs. You install the small <strong style={{ color: '#e2e8f0' }}>Mastermind agent</strong> on it — a Go program that connects back here and lets you send commands remotely.
          </p>
        </div>
        <div style={{ background: '#0d0d14', borderRadius: 8, padding: '1rem 1.125rem', border: '1px solid #1e1e2a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span style={{ background: 'rgba(99,102,241,0.18)', color: '#818cf8', borderRadius: 6, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem', flexShrink: 0 }}>2</span>
            <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f1f5f9' }}>Server Instance</span>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>— the game</span>
          </div>
          <p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.6 }}>
            A <strong style={{ color: '#e2e8f0' }}>Server Instance</strong> is a game server process (7 Days to Die, Minecraft, etc.) running on a host. One host can run multiple server instances. You tell Mastermind where the game is installed and how to talk to it via Telnet.
          </p>
        </div>
      </div>
      <div style={{ background: '#0d0d14', borderRadius: 8, padding: '0.875rem 1.125rem', border: '1px solid #1e1e2a' }}>
        <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.6rem' }}>Setup flow</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.82rem', color: '#94a3b8' }}>
          {[
            'Generate a pairing token',
            'Run the agent on your machine with that token',
            'Host appears here as Online',
            'Register a Server Instance on that host',
            'Create Jobs, Schedules & Alerts for the server',
          ].map((step, i, arr) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color: '#e2e8f0' }}>{step}</span>
              {i < arr.length - 1 && <span style={{ color: '#252532' }}>→</span>}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function HostsPage() {
  const orgId = getStoredOrgId();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [servers, setServers] = useState<ServerInstance[]>([]);
  const [loadingHosts, setLoadingHosts] = useState(true);
  const [error, setError] = useState('');

  const [showPairing, setShowPairing] = useState(false);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingToken, setPairingToken] = useState<PairingToken | null>(null);
  const [pairingError, setPairingError] = useState('');
  const [pairingHostName, setPairingHostName] = useState('');
  const [agentCpUrl, setAgentCpUrl] = useState(
    process.env.NEXT_PUBLIC_CONTROL_PLANE_URL || 'http://localhost:3001',
  );
  const [installTab, setInstallTab] = useState<'oneliner' | 'docker' | 'manual'>('oneliner');
  const [copied, setCopied] = useState<string | null>(null);

  const [selectedHost, setSelectedHost] = useState<Host | null>(null);

  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    // Auto-open on first visit; also respond to sidebar "Setup Guide" link
    const dismissed = localStorage.getItem('mm_tutorial_done');
    const forceOpen = localStorage.getItem('mm_tutorial_open');
    if (forceOpen) { localStorage.removeItem('mm_tutorial_open'); setShowTutorial(true); }
    else if (!dismissed) { setShowTutorial(true); }
  }, []);

  function openTutorial() { setShowTutorial(true); }
  function closeTutorial() { localStorage.setItem('mm_tutorial_done', '1'); setShowTutorial(false); }

  const [showRegisterServer, setShowRegisterServer] = useState(false);
  const [serverForm, setServerForm] = useState({
    name: '', hostId: '', gameType: 'minecraft', installPath: '', startCommand: '',
    telnetHost: '', telnetPort: '', telnetPassword: '',
  });
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerError, setRegisterError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState('');

  const fetchData = useCallback(async () => {
    if (!orgId) return;
    const [h, s] = await Promise.all([
      api.get<Host[]>(`/api/orgs/${orgId}/hosts`),
      api.get<ServerInstance[]>(`/api/orgs/${orgId}/server-instances`),
    ]);
    return { hosts: h, servers: s };
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    fetchData()
      ?.then((data) => {
        if (data) { setHosts(data.hosts); setServers(data.servers); }
        setLoadingHosts(false);
      })
      .catch((err) => { setError(err.message); setLoadingHosts(false); });
  }, [orgId, fetchData]);

  usePoll(
    async () => { if (!orgId) return null; return fetchData(); },
    (data) => { if (data) { setHosts(data.hosts); setServers(data.servers); } },
    10000, !!orgId,
  );

  async function handleGeneratePairingToken() {
    if (!orgId) return;
    setPairingLoading(true); setPairingError(''); setPairingToken(null);
    try {
      const token = await api.post<PairingToken>(`/api/orgs/${orgId}/pairing-tokens`, {});
      setPairingToken(token);
    } catch (err: unknown) {
      setPairingError(err instanceof Error ? err.message : 'Failed to generate token');
    } finally {
      setPairingLoading(false);
    }
  }

  async function handleRegisterServer(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setRegisterLoading(true); setRegisterError(''); setRegisterSuccess('');
    try {
      await api.post<ServerInstance>(`/api/orgs/${orgId}/server-instances`, {
        name: serverForm.name,
        hostId: serverForm.hostId || undefined,
        gameType: serverForm.gameType,
        installPath: serverForm.installPath || null,
        startCommand: serverForm.startCommand || null,
        telnetHost: serverForm.telnetHost || null,
        telnetPort: serverForm.telnetPort ? parseInt(serverForm.telnetPort) : null,
        telnetPassword: serverForm.telnetPassword || null,
      });
      setRegisterSuccess('Server instance registered successfully.');
      setServerForm({ name: '', hostId: '', gameType: 'minecraft', installPath: '', startCommand: '', telnetHost: '', telnetPort: '', telnetPassword: '' });
      const updated = await fetchData();
      if (updated) { setHosts(updated.hosts); setServers(updated.servers); }
    } catch (err: unknown) {
      setRegisterError(err instanceof Error ? err.message : 'Failed to register server');
    } finally {
      setRegisterLoading(false);
    }
  }

  async function renameHost(host: Host) {
    if (!orgId) return;
    const name=prompt('New host name:',host.name)?.trim(); if(!name||name===host.name)return;
    try { await api.patch(`/api/orgs/${orgId}/hosts/${host.id}`,{name}); const updated=await fetchData(); if(updated){setHosts(updated.hosts);setServers(updated.servers);setSelectedHost(current=>current?.id===host.id?updated.hosts.find(h=>h.id===host.id)||null:current);} setError(''); }
    catch(err){setError(err instanceof Error?err.message:'Failed to rename host');}
  }

  async function deleteHost(host: Host) {
    if (!orgId||!confirm(`Unregister host "${host.name}"?\n\nThis removes its Mastermind record and history. It does not delete game files. An active agent will need to be paired again.`))return;
    try { await api.delete(`/api/orgs/${orgId}/hosts/${host.id}`);setSelectedHost(current=>current?.id===host.id?null:current);const updated=await fetchData();if(updated){setHosts(updated.hosts);setServers(updated.servers);}setError(''); }
    catch(err){setError(err instanceof Error?err.message:'Failed to unregister host');}
  }

  async function renameServer(server: ServerInstance) {
    if (!orgId) return;
    const name=prompt('New server instance name:',server.name)?.trim();if(!name||name===server.name)return;
    try { await api.patch(`/api/orgs/${orgId}/server-instances/${server.id}`,{name});const updated=await fetchData();if(updated){setHosts(updated.hosts);setServers(updated.servers);}setError(''); }
    catch(err){setError(err instanceof Error?err.message:'Failed to rename server instance');}
  }

  async function deleteServer(server: ServerInstance) {
    if (!orgId||!confirm(`Unregister server instance "${server.name}"?\n\nThis removes its Mastermind record and related dashboard data. It does not stop the server or delete its installation or world files.`))return;
    try { await api.delete(`/api/orgs/${orgId}/server-instances/${server.id}`);const updated=await fetchData();if(updated){setHosts(updated.hosts);setServers(updated.servers);}setError(''); }
    catch(err){setError(err instanceof Error?err.message:'Failed to unregister server instance');}
  }

  function copyCmd(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div>
      {showTutorial && (
        <TutorialWizard
          onClose={closeTutorial}
          onPairHost={() => { setShowPairing(true); setPairingToken(null); setPairingError(''); }}
          onRegisterServer={() => setShowRegisterServer(true)}
        />
      )}

      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9' }}>Hosts</h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>Connect machines running the agent, then register game server processes on them</p>
        </div>
        <button
          onClick={openTutorial}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 7, color: '#818cf8', fontSize: '0.8rem', fontWeight: 600, padding: '0.4rem 0.875rem', cursor: 'pointer' }}
        >▶ Setup Guide</button>
      </div>

      <HowItWorksGuide onOpenTutorial={openTutorial} />

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1.25rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {/* Hosts Table */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Registered Hosts</h2>
          <button style={btnPrimary} onClick={() => { setShowPairing(!showPairing); setPairingToken(null); setPairingError(''); }}>
            {showPairing ? 'Cancel' : '+ Pair New Host'}
          </button>
        </div>

        {showPairing && (() => {
          const cpUrl = agentCpUrl.replace(/\/$/, '');
          const name = pairingHostName.trim() || 'my-server';
          const token = pairingToken?.token ?? '';

          const oneLineCmd = `curl -sSL "${cpUrl}/install.sh?token=${token}&url=${encodeURIComponent(cpUrl)}&name=${encodeURIComponent(name)}" | sudo bash`;

          const dockerCmd = [
            `docker run -d \\`,
            `  --name mastermind-agent \\`,
            `  --restart unless-stopped \\`,
            `  -e MASTERMIND_CP_URL="${cpUrl}" \\`,
            `  -e MASTERMIND_PAIRING_TOKEN="${token}" \\`,
            `  -e MASTERMIND_HOST_NAME="${name}" \\`,
            `  -v mastermind-agent-data:/var/lib/mastermind-agent \\`,
            `  mastermind-agent`,
          ].join('\n');

          const configYaml = [
            `control_plane_url: "${cpUrl}"`,
            `pairing_token: "${token}"`,
            `agent_key_path: "/var/lib/mastermind-agent/agent.key"`,
            `heartbeat:`,
            `  interval_sec: 5`,
            `jobs:`,
            `  poll_interval_sec: 5`,
            `  long_poll_sec: 30`,
            `host:`,
            `  name: "${name}"`,
          ].join('\n');

          const tabs: { key: 'oneliner' | 'docker' | 'manual'; label: string }[] = [
            { key: 'oneliner', label: 'One-liner' },
            { key: 'docker', label: 'Docker' },
            { key: 'manual', label: 'Config file' },
          ];

          const codeBox: React.CSSProperties = {
            background: '#0a0a0f', border: '1px solid #252532', borderRadius: 7,
            padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.8rem',
            color: '#818cf8', whiteSpace: 'pre', overflowX: 'auto', margin: 0,
          };

          return (
            <div style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, padding: '1.5rem', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 700, color: '#f1f5f9' }}>
                {pairingToken ? '✓ Token generated — install the agent' : 'Pair a New Host'}
              </h3>

              {/* Step 1: configure */}
              {!pairingToken && (
                <>
                  <p style={{ margin: '0 0 1.25rem', fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.6 }}>
                    Give your host a name, confirm the address agents should connect to, then generate a one-time install token.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem', marginBottom: '1.25rem' }}>
                    <div>
                      <label style={labelStyle}>Host name <span style={{ color: '#64748b' }}>(optional)</span></label>
                      <input
                        style={inputStyle} placeholder="e.g. game-server-1"
                        value={pairingHostName}
                        onChange={e => setPairingHostName(e.target.value)}
                        onFocus={onFocus} onBlur={onBlur}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>
                        Control plane URL{' '}
                        <span title="The URL that the agent machine uses to reach this server. May differ from your browser URL if the agent is on a different network." style={{ cursor: 'help', color: '#6366f1', fontWeight: 400 }}>(?)</span>
                      </label>
                      <input
                        style={inputStyle} placeholder="http://1.2.3.4:3001"
                        value={agentCpUrl}
                        onChange={e => setAgentCpUrl(e.target.value)}
                        onFocus={onFocus} onBlur={onBlur}
                      />
                    </div>
                  </div>
                  {pairingError && (
                    <p style={{ color: '#f87171', fontSize: '0.82rem', margin: '0 0 0.875rem' }}>{pairingError}</p>
                  )}
                  <button style={btnPrimary} onClick={handleGeneratePairingToken} disabled={pairingLoading}>
                    {pairingLoading ? 'Generating…' : 'Generate Install Token'}
                  </button>
                  <span style={{ marginLeft: '0.75rem', fontSize: '0.8rem', color: '#64748b' }}>Expires in 15 minutes</span>
                </>
              )}

              {/* Step 2: copy-paste commands */}
              {pairingToken && (
                <>
                  {/* Agent download */}
                  <AgentDownloadPanel />

                  {/* Token row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.25rem', background: '#0a0a0f', border: '1px solid #1e1e2a', borderRadius: 8, padding: '0.625rem 0.875rem' }}>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', flexShrink: 0 }}>Token (expires {new Date(pairingToken.expiresAt).toLocaleTimeString()}):</span>
                    <code style={{ flex: 1, color: '#818cf8', fontSize: '0.8rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>{token}</code>
                    <button style={btnSecondary} onClick={() => copyCmd(token, 'token')}>
                      {copied === 'token' ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>

                  {/* Tabs */}
                  <div style={{ display: 'flex', gap: 4, marginBottom: '1rem', background: '#0d0d14', borderRadius: 7, padding: 4, width: 'fit-content' }}>
                    {tabs.map(t => (
                      <button
                        key={t.key}
                        onClick={() => setInstallTab(t.key)}
                        style={{
                          padding: '0.35rem 0.875rem', borderRadius: 5, border: 'none', cursor: 'pointer',
                          fontSize: '0.82rem', fontWeight: installTab === t.key ? 600 : 400,
                          background: installTab === t.key ? '#1e1e2a' : 'transparent',
                          color: installTab === t.key ? '#f1f5f9' : '#64748b',
                        }}
                      >{t.label}</button>
                    ))}
                  </div>

                  {/* One-liner tab */}
                  {installTab === 'oneliner' && (
                    <div>
                      <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.6 }}>
                        Run this single command on your server. The script detects Docker or Go and sets everything up automatically.
                      </p>
                      <div style={{ position: 'relative' }}>
                        <pre style={codeBox}>{oneLineCmd}</pre>
                        <button
                          style={{ ...btnPrimary, position: 'absolute', top: 8, right: 8, padding: '0.25rem 0.625rem', fontSize: '0.78rem' }}
                          onClick={() => copyCmd(oneLineCmd, 'oneliner')}
                        >{copied === 'oneliner' ? '✓ Copied' : 'Copy'}</button>
                      </div>
                      <p style={{ margin: '0.625rem 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                        Requires Docker (recommended) or Go 1.22+ on the target machine. Needs <code style={{ color: '#94a3b8' }}>sudo</code> to write to <code style={{ color: '#94a3b8' }}>/etc/mastermind-agent/</code>.
                      </p>
                    </div>
                  )}

                  {/* Docker tab */}
                  {installTab === 'docker' && (
                    <div>
                      <div style={{ marginBottom: '1rem' }}>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem' }}>Step 1 — build the image (first time only, on any machine)</div>
                        <div style={{ position: 'relative' }}>
                          <pre style={codeBox}>{`cd /path/to/mastermind-agent && docker build -t mastermind-agent .`}</pre>
                          <button style={{ ...btnSecondary, position: 'absolute', top: 8, right: 8, padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => copyCmd(`cd /path/to/mastermind-agent && docker build -t mastermind-agent .`, 'dbuild')}>
                            {copied === 'dbuild' ? '✓' : 'Copy'}
                          </button>
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem' }}>Step 2 — run the agent with this token</div>
                        <div style={{ position: 'relative' }}>
                          <pre style={codeBox}>{dockerCmd}</pre>
                          <button style={{ ...btnPrimary, position: 'absolute', top: 8, right: 8, padding: '0.25rem 0.625rem', fontSize: '0.78rem' }} onClick={() => copyCmd(dockerCmd, 'docker')}>
                            {copied === 'docker' ? '✓ Copied' : 'Copy'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Manual / config file tab */}
                  {installTab === 'manual' && (
                    <div>
                      <div style={{ marginBottom: '1rem' }}>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem' }}>Step 1 — write config to <code style={{ textTransform: 'none' }}>/etc/mastermind-agent/config.yaml</code></div>
                        <div style={{ position: 'relative' }}>
                          <pre style={codeBox}>{configYaml}</pre>
                          <button style={{ ...btnSecondary, position: 'absolute', top: 8, right: 8, padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => copyCmd(configYaml, 'yaml')}>
                            {copied === 'yaml' ? '✓' : 'Copy'}
                          </button>
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem' }}>Step 2 — build and run</div>
                        <div style={{ position: 'relative' }}>
                          <pre style={codeBox}>{`# Build (Go 1.22+ required)\ncd /path/to/agent && go build -o mastermind-agent .\n\n# Run\n./mastermind-agent -config /etc/mastermind-agent/config.yaml`}</pre>
                          <button style={{ ...btnSecondary, position: 'absolute', top: 8, right: 8, padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => copyCmd(`cd /path/to/agent && go build -o mastermind-agent .\n./mastermind-agent -config /etc/mastermind-agent/config.yaml`, 'manual')}>
                            {copied === 'manual' ? '✓' : 'Copy'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Waiting indicator */}
                  <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.75rem 1rem', background: '#0d0d14', border: '1px solid #1e1e2a', borderRadius: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                      Waiting for the agent to connect… The host will appear in the table below once it does.
                    </span>
                  </div>

                  {/* Regenerate */}
                  <div style={{ marginTop: '1rem', display: 'flex', gap: 8 }}>
                    <button style={btnSecondary} onClick={handleGeneratePairingToken} disabled={pairingLoading}>
                      {pairingLoading ? 'Regenerating…' : 'Regenerate Token'}
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {loadingHosts ? (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Loading…</p>
        ) : hosts.length === 0 ? (
          <div style={{ padding: '1.25rem', background: '#0d0d14', borderRadius: 8, border: '1px dashed #252532' }}>
            <p style={{ margin: '0 0 0.625rem', fontSize: '0.875rem', color: '#94a3b8', fontWeight: 500 }}>No hosts connected yet.</p>
            <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b', lineHeight: 1.7 }}>
              Click <strong style={{ color: '#e2e8f0' }}>+ Pair New Host</strong> above to generate an install command you can paste directly on your server.
            </p>
          </div>
        ) : (
          <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #1e1e2a' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Name', 'Status', 'Agent Version', 'Last Heartbeat', 'Servers', 'Actions'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hosts.map((host) => (
                  <tr key={host.id}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{host.name}</td>
                    <td style={tdStyle}><Badge status={host.status} /></td>
                    <td style={{ ...tdStyle, color: '#64748b' }}>{host.agentVersion ? <code style={{ background: '#1e1e2a', padding: '0.15rem 0.4rem', borderRadius: 4, fontSize: '0.8rem' }}>v{host.agentVersion}</code> : '—'}</td>
                    <td style={{ ...tdStyle, color: '#64748b' }}>{formatRelative(host.lastHeartbeatAt)}</td>
                    <td style={{ ...tdStyle, color: '#94a3b8' }}>{host.serverInstances.length}</td>
                    <td style={tdStyle}>
                      <button
                        style={{ ...btnSecondary, fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
                        onClick={() => setSelectedHost(selectedHost?.id === host.id ? null : host)}
                      >
                        {selectedHost?.id === host.id ? 'Hide' : 'Details'}
                      </button>
                      <button style={{ ...btnSecondary, fontSize: '0.8rem', padding: '0.3rem 0.6rem', marginLeft: 6 }} onClick={() => renameHost(host)}>Rename</button>
                      <button style={{ ...btnDanger, marginLeft: 6 }} onClick={() => deleteHost(host)}>Unregister</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Host Detail Panel */}
      {selectedHost && (
        <div style={card}>
          <h2 style={{ margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>
            Host: {selectedHost.name}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            {[
              { label: 'ID', value: selectedHost.id, mono: true },
              { label: 'Status', value: null, badge: selectedHost.status },
              { label: 'Agent Version', value: selectedHost.agentVersion || '—' },
              { label: 'Last Heartbeat', value: selectedHost.lastHeartbeatAt ? new Date(selectedHost.lastHeartbeatAt).toLocaleString() : '—' },
            ].map((item) => (
              <div key={item.label} style={{ background: '#0d0d14', borderRadius: 7, padding: '0.875rem 1rem', border: '1px solid #1e1e2a' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.label}</div>
                {item.badge ? <Badge status={item.badge} /> : (
                  <div style={{ fontSize: '0.85rem', color: '#e2e8f0', fontFamily: item.mono ? 'monospace' : undefined, wordBreak: 'break-all' }}>
                    {item.value}
                  </div>
                )}
              </div>
            ))}
          </div>

          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Server Instances</h3>
          {selectedHost.serverInstances.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: '0.875rem' }}>No server instances on this host.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {selectedHost.serverInstances.map((si) => {
                const full = servers.find(s => s.id === si.id);
                return (
                  <div key={si.id} style={{ background: '#0d0d14', borderRadius: 7, padding: '0.875rem 1rem', border: '1px solid #1e1e2a' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#f1f5f9' }}>{si.name}</div>
                    {full && (
                      <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.25rem' }}>
                        {full.gameType} · {full.installPath || 'No install path'} · Telnet: {full.telnetHost ? `${full.telnetHost}:${full.telnetPort}` : 'Not configured'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {selectedHost.lastMetrics && (
            <>
              <h3 style={{ margin: '1.25rem 0 0.75rem', fontSize: '0.875rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Last Metrics</h3>
              <pre style={{ background: '#0a0a0f', border: '1px solid #1e1e2a', padding: '0.875rem', borderRadius: 7, fontSize: '0.8rem', overflow: 'auto', margin: 0, color: '#94a3b8' }}>
                {JSON.stringify(selectedHost.lastMetrics, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}

      {/* Server Instances */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Server Instances</h2>
          <button style={btnPrimary} onClick={() => setShowRegisterServer(!showRegisterServer)}>
            {showRegisterServer ? 'Cancel' : '+ Register Server'}
          </button>
        </div>

        {showRegisterServer && (
          <form onSubmit={handleRegisterServer} style={{ background: '#0d0d14', border: '1px solid #1e1e2a', borderRadius: 8, padding: '1.25rem', marginBottom: '1.25rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '0.9rem', fontWeight: 600, color: '#f1f5f9' }}>New Server Instance</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
              {[
                { label: 'Name *', key: 'name', placeholder: 'My Minecraft Server', required: true },
                { label: 'Install Path', key: 'installPath', placeholder: '/opt/minecraft' },
                { label: 'Start Command', key: 'startCommand', placeholder: './start.sh' },
                { label: 'RCON Host', key: 'telnetHost', placeholder: '127.0.0.1' },
                { label: 'RCON Port', key: 'telnetPort', placeholder: '25575', type: 'number' },
                { label: 'RCON Password', key: 'telnetPassword', placeholder: 'Optional', type: 'password' },
              ].map((f) => (
                <div key={f.key}>
                  <label style={labelStyle}>{f.label}</label>
                  <input
                    style={inputStyle}
                    type={f.type || 'text'}
                    placeholder={f.placeholder}
                    required={f.required}
                    value={(serverForm as Record<string, string>)[f.key]}
                    onChange={e => setServerForm({ ...serverForm, [f.key]: e.target.value })}
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                </div>
              ))}
              <div>
                <label style={labelStyle}>Host</label>
                <select style={inputStyle} value={serverForm.hostId} onChange={e => setServerForm({ ...serverForm, hostId: e.target.value })} onFocus={onFocus} onBlur={onBlur}>
                  <option value="">— Select Host —</option>
                  {hosts.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Game Type *</label>
                <select style={inputStyle} value={serverForm.gameType} onChange={e => setServerForm({ ...serverForm, gameType: e.target.value })} onFocus={onFocus} onBlur={onBlur}>
                  <option value="minecraft">Minecraft</option>
                </select>
              </div>
            </div>
            {registerError && <p style={{ color: '#f87171', fontSize: '0.8rem', margin: '0.875rem 0 0' }}>{registerError}</p>}
            {registerSuccess && <p style={{ color: '#4ade80', fontSize: '0.8rem', margin: '0.875rem 0 0' }}>{registerSuccess}</p>}
            <div style={{ marginTop: '1rem', display: 'flex', gap: 8 }}>
              <button type="submit" style={btnPrimary} disabled={registerLoading}>
                {registerLoading ? 'Registering…' : 'Register Server'}
              </button>
              <button type="button" style={btnSecondary} onClick={() => setShowRegisterServer(false)}>Cancel</button>
            </div>
          </form>
        )}

        {servers.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>No server instances registered.</p>
        ) : (
          <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #1e1e2a' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Name', 'Game', 'Host', 'Install Path', 'Telnet', 'Actions'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {servers.map((s) => {
                  const host = hosts.find(h => h.id === s.hostId);
                  return (
                    <tr key={s.id}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{s.name}</td>
                      <td style={tdStyle}>
                        <code style={{ background: '#1e1e2a', padding: '0.15rem 0.5rem', borderRadius: 4, fontSize: '0.8rem', color: '#94a3b8' }}>{s.gameType}</code>
                      </td>
                      <td style={{ ...tdStyle, color: '#94a3b8' }}>{host?.name || s.hostId || '—'}</td>
                      <td style={{ ...tdStyle, color: '#64748b', fontFamily: 'monospace', fontSize: '0.8rem' }}>{s.installPath || '—'}</td>
                      <td style={{ ...tdStyle, color: '#64748b' }}>{s.telnetHost ? `${s.telnetHost}:${s.telnetPort}` : '—'}</td>
                      <td style={{...tdStyle,whiteSpace:'nowrap'}}><button style={{...btnSecondary,fontSize:'.8rem',padding:'.3rem .6rem'}} onClick={()=>renameServer(s)}>Rename</button><button style={{...btnDanger,marginLeft:6}} onClick={()=>deleteServer(s)}>Unregister</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
