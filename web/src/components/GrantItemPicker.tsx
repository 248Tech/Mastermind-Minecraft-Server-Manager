'use client';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type UIEvent } from 'react';

export type GrantDraft = { name: string; quantity: number };
export const emptyGrant = (): GrantDraft => ({ name: '', quantity: 1 });

const inputStyle: CSSProperties = { padding: '0.55rem 0.875rem', borderRadius: 7, border: '1px solid #252532', fontSize: '0.875rem', background: '#0d0d14', color: '#f1f5f9', width: '100%', outline: 'none' };
const btnPrimary: CSSProperties = { padding: '0.5rem 1.125rem', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 };
const labelStyle: CSSProperties = { display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.3rem', fontWeight: 500 };

export function GrantList({
  value,
  onChange,
  catalog,
  loading,
  sourceLabel,
  onRefresh,
}: {
  value: GrantDraft[];
  onChange: (value: GrantDraft[]) => void;
  catalog: string[];
  loading: boolean;
  sourceLabel: string;
  onRefresh: () => void;
}) {
  const rows = value.length ? value : [emptyGrant()];
  function update(index: number, patch: Partial<GrantDraft>) {
    const next = rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row);
    onChange(next.some((row) => row.name.trim()) || next.length > 1 ? next : []);
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((row, index) => (
        <div key={index} style={{ display: 'grid', gap: 8, padding: 10, border: '1px solid #252532', borderRadius: 8 }}>
          <GrantItemPicker
            value={row.name}
            onChange={(name) => update(index, { name })}
            catalog={catalog}
            loading={loading}
            sourceLabel={sourceLabel}
            onRefresh={onRefresh}
            showReload={index === 0}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}>
            <div><label style={labelStyle}>Quantity</label><input type="number" min="1" max="9999" step="1" value={row.quantity} onChange={(e) => update(index, { quantity: Number(e.target.value) || 1 })} style={inputStyle} /></div>
            <button type="button" onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))} style={{ ...btnPrimary, background: '#334155' }}>Remove</button>
          </div>
        </div>
      ))}
      {rows.length < 8 && (
        <button type="button" onClick={() => onChange([...rows, emptyGrant()])} style={{ ...btnPrimary, background: '#4338ca', justifySelf: 'start' }}>Add another item</button>
      )}
    </div>
  );
}

function rankCatalogMatches(catalog: string[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return catalog;
  const prefix: string[] = [];
  const contains: string[] = [];
  for (const name of catalog) {
    const lower = name.toLowerCase();
    if (lower.startsWith(needle)) prefix.push(name);
    else if (lower.includes(needle)) contains.push(name);
  }
  return [...prefix, ...contains];
}

const CATALOG_PAGE = 100;

function GrantItemPicker({
  value,
  onChange,
  catalog,
  loading,
  sourceLabel,
  onRefresh,
  showReload = true,
}: {
  value: string;
  onChange: (value: string) => void;
  catalog: string[];
  loading: boolean;
  sourceLabel: string;
  onRefresh: () => void;
  showReload?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [visibleCount, setVisibleCount] = useState(CATALOG_PAGE);
  const listRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => rankCatalogMatches(catalog, value), [catalog, value]);
  const visible = matches.slice(0, visibleCount);
  const hasMore = visibleCount < matches.length;

  useEffect(() => {
    setHighlight(0);
    setVisibleCount(CATALOG_PAGE);
  }, [value, open, catalog]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  function loadMore() {
    setVisibleCount((count) => Math.min(count + CATALOG_PAGE, matches.length));
  }

  function onListScroll(event: UIEvent<HTMLDivElement>) {
    const node = event.currentTarget;
    if (node.scrollTop + node.clientHeight >= node.scrollHeight - 48) loadMore();
  }

  function choose(name: string) {
    onChange(name);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlight((index) => {
        const next = Math.min(index + 1, Math.max(matches.length - 1, 0));
        if (next >= visibleCount - 5) loadMore();
        return next;
      });
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setHighlight((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Enter' && open && matches[highlight]) {
      event.preventDefault();
      choose(matches[highlight]);
      return;
    }
    if (event.key === 'Escape') setOpen(false);
  }

  return (
    <div style={{ position: 'relative' }}>
      <label style={labelStyle}>Item name</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            value={value}
            onChange={(e) => { onChange(e.target.value); setOpen(true); }}
            onFocus={() => {
              setOpen(true);
              if (!catalog.length && !loading) onRefresh();
            }}
            onClick={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 180)}
            onKeyDown={onKeyDown}
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
            placeholder={loading ? 'Loading item directory…' : catalog.length ? 'Click for A–Z list, or type to filter' : 'minecraft:diamond'}
            aria-autocomplete="list"
            aria-expanded={open}
            style={{ ...inputStyle, paddingRight: 40 }}
          />
          <button
            type="button"
            aria-label="Show item names"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpen((current) => !current);
              if (!catalog.length && !loading) onRefresh();
            }}
            style={{
              position: 'absolute',
              right: 6,
              top: '50%',
              transform: 'translateY(-50%)',
              border: 0,
              background: 'transparent',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: 14,
              padding: '4px 6px',
            }}
          >
            ▾
          </button>
        </div>
        <button type="button" disabled={loading} onMouseDown={(e) => e.preventDefault()} onClick={onRefresh} style={{ ...btnPrimary, background: '#334155', whiteSpace: 'nowrap', display: showReload ? undefined : 'none' }}>
          {loading ? 'Reading…' : 'Reload'}
        </button>
      </div>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          onScroll={onListScroll}
          style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: showReload ? 88 : 0, marginTop: 4, maxHeight: 280, overflow: 'auto', background: '#0d0d14', border: '1px solid #303044', borderRadius: 7, boxShadow: '0 12px 28px rgba(0,0,0,.45)' }}
        >
          {!catalog.length && (
            <div style={{ padding: '0.65rem 0.75rem', color: '#94a3b8', fontSize: 13 }}>
              {loading ? 'Loading item names…' : 'No item directory loaded yet. Click Reload, or type a name.'}
            </div>
          )}
          {catalog.length > 0 && !value.trim() && (
            <div style={{ padding: '0.45rem 0.75rem', color: '#64748b', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: '1px solid #252532' }}>
              A–Z · {catalog.length.toLocaleString()} names · scroll for more
            </div>
          )}
          {value.trim() !== '' && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose('')} style={optionStyle(false)}>Clear</button>
          )}
          {visible.map((name, index) => (
            <button
              key={name}
              type="button"
              role="option"
              data-active={index === highlight ? 'true' : 'false'}
              aria-selected={name === value}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => choose(name)}
              style={optionStyle(name === value || index === highlight)}
            >
              {name}
            </button>
          ))}
          {catalog.length > 0 && matches.length === 0 && (
            <div style={{ padding: '0.55rem 0.75rem', color: '#64748b', fontSize: 13 }}>No matching item names</div>
          )}
          {hasMore && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={loadMore}
              style={{ ...optionStyle(false), color: '#94a3b8', textAlign: 'center', borderTop: '1px solid #252532' }}
            >
              Showing {visible.length.toLocaleString()} of {matches.length.toLocaleString()} · load more
            </button>
          )}
          {!hasMore && matches.length > CATALOG_PAGE && (
            <div style={{ padding: '0.45rem 0.75rem', color: '#64748b', fontSize: 12, textAlign: 'center', borderTop: '1px solid #252532' }}>
              All {matches.length.toLocaleString()} matches
            </div>
          )}
        </div>
      )}
      <small style={{ display: showReload ? 'block' : 'none', marginTop: 6, color: '#64748b' }}>
        {loading
          ? 'Reading ItemIcons and game item lists…'
          : sourceLabel
            ? `${sourceLabel}. Click the empty box for the full alphabetical list.`
            : 'Catalog unavailable — you can still type a name'}
      </small>
    </div>
  );
}

function optionStyle(active: boolean): CSSProperties {
  return {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: active ? '#1f1b3a' : 'transparent',
    color: '#e2e8f0',
    border: 0,
    padding: '0.45rem 0.75rem',
    cursor: 'pointer',
    fontFamily: 'ui-monospace, monospace',
    fontSize: 13,
  };
}
