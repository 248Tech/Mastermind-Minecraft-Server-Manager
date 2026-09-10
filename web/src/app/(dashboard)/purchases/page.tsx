'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';

const card: React.CSSProperties = { background: '#111118', borderRadius: 10, padding: '1.5rem', border: '1px solid #1e1e2a', marginBottom: '1rem' };

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function when(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

type DonationLine = { id: string; shopItemId: string | null; itemName: string; amountCents: number; quantity: number; grantStatus?: string; grantError?: string | null; grantItems?: { name: string; quantity: number; status?: string }[] };
type DonationRecord = {
  id: string;
  playerName: string;
  steamId: string;
  amountCents: number;
  refundedCents: number;
  status: string;
  completedAt: string | null;
  createdAt: string;
  lines: DonationLine[];
};

export default function PurchasesPage() {
  const orgId = getStoredOrgId();
  const [rows, setRows] = useState<DonationRecord[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    api.get<DonationRecord[]>(`/api/orgs/${orgId}/donations?limit=100`)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load donations'))
      .finally(() => setLoading(false));
  }, [orgId]);

  const completed = rows.filter((row) => row.status === 'completed');

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9' }}>Donations</h1>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
          Completed Stripe donations (including multi-package carts). Optional In-Game Gifts are thank-you deliveries after a donation — not item purchases.
        </p>
      </div>
      {error && <p style={{ color: '#f87171', fontSize: '.875rem' }}>{error}</p>}
      {loading && <p style={{ color: '#64748b' }}>Loading donations…</p>}
      {!loading && completed.length === 0 && <p style={{ color: '#64748b' }}>No completed donations yet.</p>}
      {completed.map((row) => (
        <div key={row.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <div>
              <strong style={{ color: '#f1f5f9' }}>{row.playerName}</strong>
              <div style={{ color: '#64748b', fontSize: 13 }}>Steam {row.steamId.slice(-4)} · {when(row.completedAt || row.createdAt)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#c4b5fd', fontWeight: 700, fontSize: '1.05rem' }}>{money(row.amountCents)}</div>
              <div style={{ color: '#64748b', fontSize: 12 }}>{row.status}</div>
            </div>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: '#cbd5e1', fontSize: 14 }}>
            {row.lines.map((line) => (
              <li key={line.id}>
                {line.itemName} · {money(line.amountCents)}
                {line.grantItems?.length
                  ? ` · In-Game Gifts: ${line.grantItems.map((grant) => `${grant.quantity}× ${grant.name}${grant.status ? ` (${grant.status})` : ''}`).join(', ')}`
                  : (line.grantStatus && line.grantStatus !== 'none' ? ` · gift ${line.grantStatus}` : '')}
                {line.grantError ? ` (${line.grantError})` : ''}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
