import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Database,
  ExternalLink,
  ListFilter,
  Newspaper,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, type RatingNewsRow, type RatingSource } from '../api';

function formatDateTime(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatNewsDateTime(value: string | null, source: string) {
  if (!value) return '-';
  const normalizedSource = source
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('tr-TR');
  const fixedValue = normalizedSource === 'yeni safak' && /(?:Z|\+00:00)$/.test(value)
    ? value.replace(/(?:Z|\+00:00)$/, '+03:00')
    : value;
  return formatDateTime(fixedValue);
}

function normalize(value: string | null | undefined) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i');
}

function matchesQuery(haystack: string, query: string) {
  if (!query) return true;
  if (haystack.includes(query)) return true;
  const tokens = query.split(/\s+/).filter(token => token.length > 1);
  return tokens.length > 0 && tokens.every(token => haystack.includes(token));
}

function summarizeSourceErrors(errors: string[]) {
  const labels = Array.from(new Set(errors.map(error => {
    const match = error.match(/^(.+?)\s+(RSS|page)\s+/);
    return match?.[1] || error.split(':')[0] || 'Kaynak';
  })));
  const visible = labels.slice(0, 3).join(', ');
  const suffix = labels.length > 3 ? ` +${labels.length - 3}` : '';
  return `${visible}${suffix} icin gecici erisim sorunu var.`;
}

function isLiveNewsSource(source: RatingSource) {
  if (!source.enabled || source.type !== 'news') return false;
  return source.status_class !== 'disabled' && source.status_class !== 'manual';
}

function statusStyle(status: string) {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    success: { color: 'var(--green)', bg: 'var(--green-bg)', label: 'Hazir' },
    partial: { color: 'var(--amber)', bg: 'var(--amber-bg)', label: 'Kismi' },
    error: { color: 'var(--red)', bg: 'var(--red-bg)', label: 'Hata' },
    empty: { color: 'var(--text-muted)', bg: 'var(--bg-surface-2)', label: 'Bos' },
    pending: { color: 'var(--text-muted)', bg: 'var(--bg-surface-2)', label: 'Bekliyor' },
    manual: { color: 'var(--blue)', bg: 'var(--blue-bg)', label: 'Manuel' },
    disabled: { color: 'var(--text-muted)', bg: 'var(--bg-surface-2)', label: 'Kapali' },
  };
  return map[status] || map.pending;
}

function riskStyle(level: string | null) {
  const key = normalize(level);
  const map: Record<string, { color: string; bg: string; label: string }> = {
    high: { color: 'var(--red)', bg: 'var(--red-bg)', label: 'Yuksek' },
    medium: { color: 'var(--amber)', bg: 'var(--amber-bg)', label: 'Orta' },
    low: { color: 'var(--green)', bg: 'var(--green-bg)', label: 'Dusuk' },
  };
  return map[key] || { color: 'var(--text-muted)', bg: 'var(--bg-surface-2)', label: 'Belirsiz' };
}

function MetricCard({ label, value, icon: Icon, color, bg }: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  color: string;
  bg: string;
}) {
  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '14px 16px', boxShadow: 'var(--shadow)',
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0 }}>{label}</span>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: bg, color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={15} />
        </span>
      </div>
      <div style={{ color, fontSize: 24, lineHeight: 1, fontWeight: 850, fontFamily: 'var(--font-mono)' }}>{value}</div>
    </div>
  );
}

function SourceChip({ source, active, busy, onClick }: {
  source: RatingSource;
  active: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  const style = statusStyle(source.status_class);
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={`${source.name} haberlerini anlik yenile`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 10px',
        borderRadius: 8, border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
        background: active ? 'var(--accent-bg)' : 'var(--bg-surface)',
        color: active ? 'var(--accent)' : 'var(--text)', cursor: busy ? 'wait' : 'pointer',
        fontWeight: 800, fontSize: 12, whiteSpace: 'nowrap', boxShadow: 'var(--shadow)',
      }}
    >
      {busy ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <span style={{ width: 8, height: 8, borderRadius: 999, background: style.color }} />}
      {source.name}
      <span style={{ color: style.color, background: style.bg, padding: '2px 6px', borderRadius: 6, fontSize: 10, fontWeight: 850 }}>
        {source.record_count.toLocaleString('tr-TR')}
      </span>
    </button>
  );
}

function LiveSourceToggle({ source, selected, onToggle }: {
  source: RatingSource;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={`${source.name} canli aramaya ${selected ? 'dahil' : 'dahil degil'}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, height: 32, padding: '0 10px',
        borderRadius: 8, border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
        background: selected ? 'var(--accent-bg)' : 'var(--bg-surface-2)',
        color: selected ? 'var(--accent)' : 'var(--text-dim)', cursor: 'pointer',
        fontWeight: 850, fontSize: 12, whiteSpace: 'nowrap',
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        readOnly
        tabIndex={-1}
        style={{ width: 13, height: 13, accentColor: 'var(--accent)', pointerEvents: 'none' }}
      />
      {source.name}
    </button>
  );
}

function SectionHeader({ icon: Icon, title, meta, action }: {
  icon: LucideIcon;
  title: string;
  meta: string;
  action?: ReactNode;
}) {
  return (
    <div style={{
      padding: '13px 16px', borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      background: 'var(--bg-surface)',
    }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: 14, fontWeight: 850 }}>
        <Icon size={15} /> {title}
      </h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>{meta}</span>
        {action}
      </div>
    </div>
  );
}

function RiskBadge({ level }: { level: string | null }) {
  const style = riskStyle(level);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 8px',
      borderRadius: 6, color: style.color, background: style.bg,
      fontSize: 11, fontWeight: 850, whiteSpace: 'nowrap',
    }}>
      {style.label}
    </span>
  );
}

export default function NewsCenter() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sources, setSources] = useState<RatingSource[]>([]);
  const [news, setNews] = useState<RatingNewsRow[]>([]);
  const [query, setQuery] = useState(() => searchParams.get('q') || searchParams.get('company') || '');
  const [source, setSource] = useState(() => searchParams.get('source') || '');
  const [risk, setRisk] = useState(() => searchParams.get('risk') || '');
  const [days, setDays] = useState(() => searchParams.get('days') || '60');
  const [loading, setLoading] = useState(true);
  const [refreshingKey, setRefreshingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedLiveSources, setSelectedLiveSources] = useState<string[]>([]);
  const [liveSourcesTouched, setLiveSourcesTouched] = useState(false);
  const [liveSearching, setLiveSearching] = useState(false);
  const [liveMode, setLiveMode] = useState(() => searchParams.get('live') === '1');

  const newsSources = useMemo(() => sources.filter(isLiveNewsSource), [sources]);
  const sourceIssues = useMemo(() => newsSources.filter(item => ['error', 'partial'].includes(item.status_class)), [newsSources]);

  useEffect(() => {
    if (!newsSources.length || liveSourcesTouched) return;
    const urlSources = (searchParams.get('sources') || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
    const available = new Set(newsSources.map(item => item.key));
    const selectedFromUrl = urlSources.filter(key => available.has(key));
    setSelectedLiveSources(selectedFromUrl.length ? selectedFromUrl : newsSources.map(item => item.key));
    if (selectedFromUrl.length) setLiveSourcesTouched(true);
  }, [liveSourcesTouched, newsSources, searchParams]);

  const filteredNews = useMemo(() => {
    const key = normalize(query.trim());
    if (!key) return news;
    return news.filter(row => {
      const haystack = normalize([
        row.title,
        row.summary,
        row.company,
        row.source,
        row.event_type,
        ...(row.matched_keywords || []),
      ].join(' '));
      return matchesQuery(haystack, key);
    });
  }, [news, query]);

  const loadNews = async (overrides?: {
    source?: string;
    risk?: string;
    days?: string;
  }) => {
    setLoading(true);
    setError(null);
    setLiveMode(false);
    const selectedSource = overrides?.source ?? source;
    const selectedRisk = overrides?.risk ?? risk;
    const selectedDays = overrides?.days ?? days;

    try {
      const params: Record<string, string> = {};
      if (selectedSource) params.source = selectedSource;
      if (selectedRisk) params.risk_level = selectedRisk;
      if (selectedDays) params.days = selectedDays;

      const [sourceRes, newsRes] = await Promise.all([
        api.getRatingSources(),
        api.getRatingNews(params),
      ]);
      setSources(sourceRes.data);
      setNews(newsRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Haber verisi alinamadi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadNews({ source, risk, days });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, risk, days]);

  const refreshSources = async (selectedSources: RatingSource[], message: string, nextSource?: string) => {
    if (!selectedSources.length) return;
    const key = selectedSources.length === 1 ? selectedSources[0].key : 'bulk';
    setRefreshingKey(key);
    setError(null);
    setNotice(null);
    try {
      await api.refreshRatings(selectedSources.map(item => item.key));
      setNotice(message);
      await loadNews(nextSource !== undefined ? { source: nextSource } : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Haber kaynagi yenilenemedi');
      await loadNews(nextSource !== undefined ? { source: nextSource } : undefined);
    } finally {
      setRefreshingKey(null);
    }
  };

  const handleSourceClick = async (item: RatingSource) => {
    setSource(item.name);
    await refreshSources([item], `${item.name} haberleri yeniden cekildi.`, item.name);
  };

  const toggleLiveSource = (key: string) => {
    setLiveSourcesTouched(true);
    setSelectedLiveSources(prev => (
      prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key]
    ));
  };

  const selectAllLiveSources = () => {
    setLiveSourcesTouched(true);
    setSelectedLiveSources(newsSources.map(item => item.key));
  };

  const clearLiveSources = () => {
    setLiveSourcesTouched(true);
    setSelectedLiveSources([]);
  };

  const handleLiveSearch = async () => {
    const term = query.trim();
    if (!term) {
      setError('Canli arama icin haber konusu veya baslik yaz.');
      return;
    }
    if (!selectedLiveSources.length) {
      setError('Canli arama icin en az bir haber kaynagi sec.');
      return;
    }

    setLiveSearching(true);
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.searchRatingNews({
        q: term,
        sources: selectedLiveSources,
        limit: '120',
      });
      setNews(result.data);
      setLiveMode(true);
      setNotice(`${result.data.length.toLocaleString('tr-TR')} canli sonuc bulundu.`);
      if (result.source_errors?.length) {
        setError(summarizeSourceErrors(result.source_errors));
      }
      setSearchParams({
        q: term,
        live: '1',
        sources: selectedLiveSources.join(','),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Canli haber aramasi tamamlanamadi');
    } finally {
      setLiveSearching(false);
      setLoading(false);
    }
  };

  const returnToSavedFeed = async () => {
    setLiveMode(false);
    await loadNews({ source, risk, days });
  };

  const clearFilters = () => {
    setQuery('');
    setSource('');
    setRisk('');
    setDays('60');
    setLiveMode(false);
    setSelectedLiveSources(newsSources.map(item => item.key));
    setLiveSourcesTouched(false);
    setSearchParams({});
  };

  const handleSearch = async () => {
    const params: Record<string, string> = {};
    if (query.trim()) params.q = query.trim();
    if (source) params.source = source;
    if (risk) params.risk = risk;
    if (days) params.days = days;
    setSearchParams(params);
    if (liveMode) await loadNews({ source, risk, days });
  };

  const latestSourceTime = newsSources
    .map(item => item.last_refresh)
    .filter(Boolean)
    .sort()
    .pop() || null;
  const riskyCount = filteredNews.filter(row => ['high', 'medium'].includes(normalize(row.risk_level))).length;
  const visibleNews = filteredNews.slice(0, 240);
  const periodLabel = liveMode ? 'Canli arama' : (days ? `${days} gun` : 'Tum arsiv');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 850, letterSpacing: 0, marginBottom: 6 }}>Haberler</h1>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Haber kaynagini sec, anlik cek; sirket, baslik, ozet veya anahtar kelimeyle ara.
          </div>
        </div>
        <button
          onClick={() => void refreshSources(newsSources, 'Canli haber kaynaklari yenilendi.')}
          disabled={refreshingKey !== null}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, padding: '0 14px',
            borderRadius: 8, border: 'none', background: 'var(--accent)',
            color: '#fff', cursor: refreshingKey ? 'wait' : 'pointer', fontWeight: 850,
          }}
        >
          <RefreshCw size={15} style={refreshingKey === 'bulk' ? { animation: 'spin 1s linear infinite' } : {}} />
          Haberleri cek
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 14 }}>
        <MetricCard label="Haber" value={filteredNews.length.toLocaleString('tr-TR')} icon={Newspaper} color="var(--blue)" bg="var(--blue-bg)" />
        <MetricCard label="Canli Kaynak" value={newsSources.length.toLocaleString('tr-TR')} icon={Database} color="var(--accent)" bg="var(--accent-bg)" />
        <MetricCard label="Riskli Haber" value={riskyCount.toLocaleString('tr-TR')} icon={AlertTriangle} color="var(--amber)" bg="var(--amber-bg)" />
        <MetricCard label="Son Cekim" value={latestSourceTime ? formatDateTime(latestSourceTime) : '-'} icon={CalendarDays} color="var(--text-dim)" bg="var(--bg-surface-2)" />
      </div>

      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: 14, marginBottom: 14, boxShadow: 'var(--shadow)',
      }}>
        <div className="news-filter-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 190px 150px 130px auto auto auto', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11, fontWeight: 850, textTransform: 'uppercase', letterSpacing: 0, marginBottom: 6 }}>Arama</label>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') void handleLiveSearch(); }}
                placeholder="Baslik, sirket, kaynak veya kelime ara"
                style={{
                  width: '100%', height: 38, padding: '0 12px 0 34px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--bg-surface-2)',
                  color: 'var(--text)', outline: 'none',
                }}
              />
            </div>
          </div>
          <div>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11, fontWeight: 850, textTransform: 'uppercase', letterSpacing: 0, marginBottom: 6 }}>Kaynak</label>
            <select
              value={source}
              onChange={event => setSource(event.target.value)}
              style={{ width: '100%', height: 38, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text)', outline: 'none' }}
            >
              <option value="">Tum kaynaklar</option>
              {newsSources.map(item => <option key={item.key} value={item.name}>{item.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11, fontWeight: 850, textTransform: 'uppercase', letterSpacing: 0, marginBottom: 6 }}>Risk</label>
            <select
              value={risk}
              onChange={event => setRisk(event.target.value)}
              style={{ width: '100%', height: 38, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text)', outline: 'none' }}
            >
              <option value="">Tum riskler</option>
              <option value="low">Dusuk</option>
              <option value="medium">Orta</option>
              <option value="high">Yuksek</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11, fontWeight: 850, textTransform: 'uppercase', letterSpacing: 0, marginBottom: 6 }}>Aralik</label>
            <select
              value={days}
              onChange={event => setDays(event.target.value)}
              style={{ width: '100%', height: 38, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text)', outline: 'none' }}
            >
              <option value="7">7 gun</option>
              <option value="30">30 gun</option>
              <option value="60">60 gun</option>
              <option value="365">1 yil</option>
              <option value="">Tum arsiv</option>
            </select>
          </div>
          <button
            onClick={() => void handleLiveSearch()}
            disabled={loading || liveSearching}
            style={{
              height: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              gap: 7, padding: '0 16px', borderRadius: 8, border: 'none',
              background: 'var(--accent)', color: '#fff', cursor: (loading || liveSearching) ? 'wait' : 'pointer',
              fontWeight: 850,
            }}
          >
            {liveSearching ? <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={14} />}
            Canli ara
          </button>
          <button
            onClick={() => void handleSearch()}
            disabled={loading || liveSearching}
            style={{
              height: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              gap: 7, padding: '0 14px', borderRadius: 8, border: 'none',
              background: 'var(--text)', color: '#fff', cursor: (loading || liveSearching) ? 'wait' : 'pointer',
              fontWeight: 850, whiteSpace: 'nowrap',
            }}
          >
            <Search size={14} /> Akista ara
          </button>
          <button
            onClick={clearFilters}
            style={{
              height: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              gap: 7, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--bg-surface)', color: 'var(--text-dim)', cursor: 'pointer',
              fontWeight: 850,
            }}
          >
            Temizle
          </button>
        </div>

        <div style={{
          marginTop: 12, padding: 10, borderRadius: 8, border: '1px solid var(--border)',
          background: 'var(--bg-surface-2)', display: 'grid', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)', fontSize: 12, fontWeight: 850 }}>
              <Search size={14} />
              Canli kaynak arama
              <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 650 }}>
                {selectedLiveSources.length}/{newsSources.length}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={selectAllLiveSources}
                style={{
                  height: 28, padding: '0 9px', borderRadius: 7, border: '1px solid var(--border)',
                  background: 'var(--bg-surface)', color: 'var(--text-dim)', cursor: 'pointer',
                  fontSize: 11, fontWeight: 850,
                }}
              >
                Tumunu sec
              </button>
              <button
                type="button"
                onClick={clearLiveSources}
                style={{
                  height: 28, padding: '0 9px', borderRadius: 7, border: '1px solid var(--border)',
                  background: 'var(--bg-surface)', color: 'var(--text-dim)', cursor: 'pointer',
                  fontSize: 11, fontWeight: 850,
                }}
              >
                Temizle
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            {newsSources.map(item => (
              <LiveSourceToggle
                key={item.key}
                source={item}
                selected={selectedLiveSources.includes(item.key)}
                onToggle={() => toggleLiveSource(item.key)}
              />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingTop: 12, paddingBottom: 2 }}>
          {newsSources.map(item => (
            <SourceChip
              key={item.key}
              source={item}
              active={source === item.name}
              busy={refreshingKey === item.key}
              onClick={() => void handleSourceClick(item)}
            />
          ))}
        </div>
      </div>

      {(error || notice || sourceIssues.length > 0) && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, background: 'var(--red-bg)', color: 'var(--red)', fontWeight: 800 }}>
              <AlertTriangle size={15} /> {error}
            </div>
          )}
          {notice && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, background: 'var(--green-bg)', color: 'var(--green)', fontWeight: 800 }}>
              <CheckCircle2 size={15} /> {notice}
            </div>
          )}
          {sourceIssues.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, background: 'var(--amber-bg)', color: 'var(--amber)', fontWeight: 800 }}>
              <AlertTriangle size={15} /> Haber kaynak kontrolu: {sourceIssues.map(item => item.name).join(', ')}
            </div>
          )}
        </div>
      )}

      <section style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        <SectionHeader
          icon={ListFilter}
          title={liveMode ? 'Canli Haber Aramasi' : 'Haber Akisi'}
          meta={`${visibleNews.length.toLocaleString('tr-TR')} / ${filteredNews.length.toLocaleString('tr-TR')} haber | ${periodLabel}`}
          action={liveMode ? (
            <button
              type="button"
              onClick={() => void returnToSavedFeed()}
              style={{
                height: 28, padding: '0 10px', borderRadius: 7, border: '1px solid var(--border)',
                background: 'var(--bg-surface-2)', color: 'var(--text-dim)', cursor: 'pointer',
                fontSize: 11, fontWeight: 850,
              }}
            >
              Akisa don
            </button>
          ) : undefined}
        />
        <div style={{ maxHeight: 'calc(100vh - 360px)', minHeight: 430, overflowY: 'auto', background: 'var(--bg-surface-2)' }}>
          {loading ? (
            <div style={{ padding: 34, textAlign: 'center', color: 'var(--text-muted)' }}>Haberler yukleniyor...</div>
          ) : visibleNews.length === 0 ? (
            <div style={{ padding: 34, textAlign: 'center', color: 'var(--text-muted)' }}>Bu filtrelerle haber bulunamadi.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10, padding: 12 }}>
              {visibleNews.map((row, index) => (
                <article key={`${row.source}-${row.title}-${row.published_at}-${index}`} style={{
                  background: 'var(--bg-surface)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '13px 14px', boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                        <span style={{ color: 'var(--blue)', background: 'var(--blue-bg)', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 850 }}>
                          {row.source}
                        </span>
                        <RiskBadge level={row.risk_level} />
                        <span style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                          {formatNewsDateTime(row.published_at || row.extracted_at, row.source)}
                        </span>
                        {row.company && (
                          <span style={{ color: 'var(--text-dim)', fontSize: 11, fontWeight: 800 }}>
                            {row.company}
                          </span>
                        )}
                      </div>
                      <h3 style={{ margin: 0, color: 'var(--text)', fontSize: 14, lineHeight: 1.35, fontWeight: 850 }}>
                        {row.title}
                      </h3>
                    </div>
                    {row.url && (
                      <a href={row.url} target="_blank" rel="noreferrer" title="Habere git" style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 32, height: 32, borderRadius: 8, color: 'var(--accent)',
                        background: 'var(--accent-bg)', flexShrink: 0,
                      }}>
                        <ExternalLink size={15} />
                      </a>
                    )}
                  </div>

                  {(row.summary || row.event_type || row.matched_keywords?.length > 0) && (
                    <div style={{ marginTop: 9, display: 'grid', gap: 8 }}>
                      {row.summary && (
                        <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 12.5, lineHeight: 1.55 }}>
                          {row.summary}
                        </p>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {row.event_type && (
                          <span style={{ color: 'var(--text-muted)', background: 'var(--bg-surface-2)', border: '1px solid var(--border)', padding: '3px 7px', borderRadius: 6, fontSize: 11, fontWeight: 800 }}>
                            {row.event_type}
                          </span>
                        )}
                        {(row.matched_keywords || []).slice(0, 5).map(keyword => (
                          <span key={keyword} style={{ color: 'var(--text-muted)', background: 'var(--bg-surface-2)', border: '1px solid var(--border)', padding: '3px 7px', borderRadius: 6, fontSize: 11 }}>
                            {keyword}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 1080px) {
          .news-filter-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 720px) {
          .news-filter-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
