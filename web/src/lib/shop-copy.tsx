'use client';

import { useEffect, useState } from 'react';
import {
  formatShopGrantLabel,
  shopGrantItems,
  shopItemIconUrl,
  type ShopGrantItem,
  type ShopItem,
} from './shop-player';
import './shop-ui.css';

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) => {
        const bold = part.match(/^\*\*(.+)\*\*$/);
        return bold ? <strong key={index}>{bold[1]}</strong> : <span key={index}>{part}</span>;
      })}
    </>
  );
}

export function ShopDescription({ text, muted }: { text: string; muted?: boolean }) {
  const color = muted ? '#94a3b8' : '#cbd5e1';
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];

  function flushList(key: string) {
    if (!bullets.length) return;
    blocks.push(
      <ul key={key} className="shop-copy-list">
        {bullets.map((item, index) => (
          <li key={index}><Inline text={item} /></li>
        ))}
      </ul>,
    );
    bullets = [];
  }

  lines.forEach((line, index) => {
    const bullet = line.match(/^\s*\*\s+(.+)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      return;
    }
    flushList(`list-${index}`);
    if (!line.trim()) return;
    blocks.push(
      <p key={`p-${index}`} className="shop-copy-p">
        <Inline text={line} />
      </p>,
    );
  });
  flushList('list-end');

  return (
    <div className="shop-copy" style={{ color }}>
      {blocks}
    </div>
  );
}

export function ShopThumb({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="shop-thumb-wrap">
      <img src={src} alt={alt} className="shop-thumb" loading="lazy" decoding="async" />
    </div>
  );
}

export function ShopImage({ src, alt, compact }: { src: string; alt: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={compact ? 'shop-image-btn shop-image-btn-compact' : 'shop-image-btn'}
        onClick={() => setOpen(true)}
        aria-label={`View full picture of ${alt}`}
      >
        <img src={src} alt={alt} className={compact ? 'shop-image shop-image-compact' : 'shop-image'} loading="lazy" decoding="async" />
      </button>
      {open && (
        <div className="shop-lightbox" role="dialog" aria-modal="true" aria-label={alt} onClick={() => setOpen(false)}>
          <img src={src} alt={alt} decoding="async" />
        </div>
      )}
    </>
  );
}

function GrantIcon({ name }: { name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="shop-grant-icon shop-grant-icon-fallback" aria-hidden />;
  return (
    <img
      className="shop-grant-icon"
      src={shopItemIconUrl(name)}
      alt=""
      width={40}
      height={40}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export function ShopGrantList({
  item,
  grants,
  compact,
  title = 'In-Game Gifts',
  note = 'Thank-you gifts after your donation — not a purchase of in-game items.',
}: {
  item?: Pick<ShopItem, 'grantItems' | 'grantItemName' | 'grantQuantity'>;
  grants?: ShopGrantItem[];
  compact?: boolean;
  title?: string;
  note?: string;
}) {
  const rows = grants ?? (item ? shopGrantItems(item) : []);
  if (!rows.length) return null;

  return (
    <div className={compact ? 'shop-grants shop-grants-compact' : 'shop-grants'}>
      {!compact && (
        <>
          <p className="shop-grants-title">{title}</p>
          {note ? <p className="shop-grants-note">{note}</p> : null}
        </>
      )}
      {rows.length > 0 && (
        <ul className="shop-grants-list">
          {rows.map((grant) => (
            <li key={`${grant.name}:${grant.quantity}`} className="shop-grant-row" title={formatShopGrantLabel(grant)}>
              <GrantIcon name={grant.name} />
              <span className="shop-grant-copy">
                <strong>{grant.quantity}×</strong> {grant.name}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
