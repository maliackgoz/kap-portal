import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Database,
  ExternalLink,
  FileText,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, type RatingRow, type RatingSource } from '../api';

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('tr-TR');
}

function formatDateTime(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const DATE_FILTERS = [
  { value: 'all', label: 'Tüm zamanlar' },
  { value: '3d', label: 'Son 3 gün', days: 3 },
  { value: '7d', label: 'Son 7 gün', days: 7 },
  { value: '14d', label: 'Son 14 gün', days: 14 },
  { value: '30d', label: 'Son 1 ay', days: 30 },
  { value: 'custom', label: 'Özel aralık' },
] as const;

const GLOBAL_RATING_AGENCIES = new Set([
  'Fitch Ratings',
  'S&P Global Ratings',
  "Moody's Ratings",
]);

type DateFilterValue = typeof DATE_FILTERS[number]['value'];

function isDateFilterValue(value: string | null): value is DateFilterValue {
  return DATE_FILTERS.some(filter => filter.value === value);
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - Math.max(days - 1, 0));
  return toDateInputValue(date);
}

function todayInputValue() {
  return toDateInputValue(new Date());
}

function normalizeDateBounds(minDate: string, maxDate: string) {
  if (minDate && maxDate && minDate > maxDate) {
    return { min_date: maxDate, max_date: minDate };
  }
  return {
    ...(minDate ? { min_date: minDate } : {}),
    ...(maxDate ? { max_date: maxDate } : {}),
  };
}

function resolveDateFilter(range: DateFilterValue, minDate: string, maxDate: string) {
  if (range === 'all') return {};
  if (range === 'custom') return normalizeDateBounds(minDate, maxDate);
  const selected = DATE_FILTERS.find(filter => filter.value === range);
  if (!selected || !('days' in selected)) return {};
  return {
    min_date: dateDaysAgo(selected.days),
    max_date: todayInputValue(),
  };
}

function sourceLink(row: RatingRow) {
  return row.report_url || row.pdf_url || row.source_url;
}

function normalizeSearch(value: string | null | undefined) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[\u0131\u0130]/g, 'i')
    .replace(/ı/g, 'i')
    .replace(/ı/g, 'i')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLiveRatingSource(source: RatingSource) {
  if (!source.enabled || source.type !== 'rating') return false;
  if (source.status_class === 'disabled') return false;
  return true;
}

function statusStyle(status: string) {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    success: { color: 'var(--green)', bg: 'var(--green-bg)', label: 'Hazır' },
    partial: { color: 'var(--amber)', bg: 'var(--amber-bg)', label: 'Kısmi' },
    error: { color: 'var(--red)', bg: 'var(--red-bg)', label: 'Hata' },
    empty: { color: 'var(--text-muted)', bg: 'var(--bg-surface-2)', label: 'Boş' },
    pending: { color: 'var(--text-muted)', bg: 'var(--bg-surface-2)', label: 'Bekliyor' },
    manual: { color: 'var(--blue)', bg: 'var(--blue-bg)', label: 'Manuel' },
    disabled: { color: 'var(--text-muted)', bg: 'var(--bg-surface-2)', label: 'Kapalı' },
  };
  return map[status] || map.pending;
}

function providerStatusStyle(status: string | null | undefined) {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    FOUND: { color: 'var(--green)', bg: 'var(--green-bg)', label: 'Bulundu' },
    NO_MATCH: { color: 'var(--text-muted)', bg: 'var(--bg-surface-2)', label: 'Eşleşmedi' },
    LOGIN_REQUIRED: { color: 'var(--amber)', bg: 'var(--amber-bg)', label: 'Giriş Gerekli' },
    SUBSCRIPTION_REQUIRED: { color: 'var(--amber)', bg: 'var(--amber-bg)', label: 'Abonelik Gerekli' },
    BLOCKED: { color: 'var(--red)', bg: 'var(--red-bg)', label: 'Erişim Engeli' },
    PARSE_ERROR: { color: 'var(--red)', bg: 'var(--red-bg)', label: 'Okuma Hatası' },
  };
  return map[status || 'FOUND'] || map.FOUND;
}

function ratingReason(row: RatingRow) {
  if (row.provider_status === 'FOUND') return row.matched_name || '-';
  const message = row.error_message || row.provider_status || '-';
  const key = message.toLocaleUpperCase('tr-TR');
  if (key.includes('CLOUDFLARE')) return 'Cloudflare / guvenlik engeli';
  if (key.includes('SUBSCRIPTION')) return 'Abonelik/entitlement gerekli';
  if (key.includes('LOGIN')) return 'Login gerekli';
  if (key.includes('LOW_CONFIDENCE')) return 'Eşleşme güveni düşük';
  if (key.includes('NO_MATCH')) return 'Resmi aramada aday yok';
  if (key.includes('PARSE_ERROR')) return 'Aday var, not parse edilemedi';
  if (key.includes('BLOCKED')) return 'Kaynak erisimi engellendi';
  return message;
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
      title={`${source.name} kaynağını şimdi yenile`}
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
        {style.label}
      </span>
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

export default function RatingCenter() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [ratings, setRatings] = useState<RatingRow[]>([]);
  const [sources, setSources] = useState<RatingSource[]>([]);
  const [company, setCompany] = useState(() => searchParams.get('company') || '');
  const [agency, setAgency] = useState(() => searchParams.get('agency') || '');
  const [dateRange, setDateRange] = useState<DateFilterValue>(() => {
    const raw = searchParams.get('date_range');
    if (isDateFilterValue(raw)) return raw;
    return searchParams.get('min_date') || searchParams.get('max_date') ? 'custom' : 'all';
  });
  const [minDate, setMinDate] = useState(() => searchParams.get('min_date') || '');
  const [maxDate, setMaxDate] = useState(() => searchParams.get('max_date') || '');
  const [latestOnly, setLatestOnly] = useState(() => searchParams.get('latest_only') !== 'false');
  const [loading, setLoading] = useState(true);
  const [refreshingKey, setRefreshingKey] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ratingSources = useMemo(() => sources.filter(isLiveRatingSource), [sources]);
  const hiddenSources = useMemo(() => sources.filter(source => source.type === 'rating' && !isLiveRatingSource(source)), [sources]);
  const sourceIssues = useMemo(() => ratingSources.filter(s => ['error', 'partial'].includes(s.status_class)), [ratingSources]);

  const loadData = async (overrides?: {
    agency?: string;
    latestOnly?: boolean;
    dateRange?: DateFilterValue;
    minDate?: string;
    maxDate?: string;
  }) => {
    setLoading(true);
    setError(null);
    const selectedAgency = overrides?.agency ?? agency;
    const selectedLatest = overrides?.latestOnly ?? latestOnly;
    const selectedDateRange = overrides?.dateRange ?? dateRange;
    const selectedMinDate = overrides?.minDate ?? minDate;
    const selectedMaxDate = overrides?.maxDate ?? maxDate;
    const dateParams = resolveDateFilter(selectedDateRange, selectedMinDate, selectedMaxDate);

    try {
      const ratingParams: Record<string, string> = { latest_only: String(selectedLatest), ...dateParams };
      if (selectedAgency) ratingParams.agency = selectedAgency;

      const [sourceRes, ratingRes] = await Promise.all([
        api.getRatingSources(),
        api.getRatings(ratingParams),
      ]);
      setSources(sourceRes.data);
      setRatings(ratingRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rating verisi alınamadı');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData({ agency, latestOnly, dateRange, minDate, maxDate });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agency, latestOnly, dateRange, minDate, maxDate]);

  const refreshSources = async (selectedSources: RatingSource[], message: string, nextAgency?: string) => {
    if (!selectedSources.length) return;
    const key = selectedSources.length === 1 ? selectedSources[0].key : 'bulk';
    setRefreshingKey(key);
    setError(null);
    setNotice(null);
    try {
      const result = await api.refreshRatings(selectedSources.map(source => source.key));
      const failed = result.data.filter(item => item.status === 'error' || item.status === 'partial');
      await loadData(nextAgency !== undefined ? { agency: nextAgency } : undefined);
      if (failed.length > 0) {
        const details = failed
          .map(item => `${item.source}: ${item.errors[0] || item.status}`)
          .join(' | ');
        setError(`Kaynak kontrol edildi ancak tam yenilenemedi. ${details}`);
      } else {
        setNotice(message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaynak yenilenemedi');
      await loadData(nextAgency !== undefined ? { agency: nextAgency } : undefined);
    } finally {
      setRefreshingKey(null);
    }
  };

  const handleSourceClick = async (source: RatingSource) => {
    setAgency(source.name);
    await refreshSources([source], `${source.name} yeniden çekildi.`, source.name);
  };

  const clearFilters = () => {
    setCompany('');
    setAgency('');
    setDateRange('all');
    setMinDate('');
    setMaxDate('');
    setLatestOnly(true);
    setSearchParams({});
  };

  const handleSearch = () => {
    const params: Record<string, string> = {};
    const dateParams = resolveDateFilter(dateRange, minDate, maxDate);
    if (company.trim()) params.company = company.trim();
    if (agency) params.agency = agency;
    if (dateRange !== 'all') params.date_range = dateRange;
    if (dateParams.min_date) params.min_date = dateParams.min_date;
    if (dateParams.max_date) params.max_date = dateParams.max_date;
    if (!latestOnly) params.latest_only = 'false';
    setSearchParams(params);
  };

  const reportCount = ratingSources.reduce((sum, source) => sum + (source.report_count || 0), 0);
  const latestSourceTime = ratingSources
    .map(source => source.last_refresh)
    .filter(Boolean)
    .sort()
    .pop() || null;
  const selectedSource = agency ? ratingSources.find(source => source.name === agency) || null : null;
  const globalSummarySources = selectedSource && GLOBAL_RATING_AGENCIES.has(selectedSource.name)
    ? [selectedSource]
    : ratingSources.filter(source => GLOBAL_RATING_AGENCIES.has(source.name));
  const globalSummary = globalSummarySources.reduce((acc, source) => ({
    searched: acc.searched + (source.searched_count || 0),
    found: acc.found + (source.found_count || 0),
    noMatch: acc.noMatch + (source.no_match_count || 0),
    access: acc.access + (source.login_required_count || 0) + (source.subscription_required_count || 0),
    parse: acc.parse + (source.parse_error_count || 0),
    blocked: acc.blocked + (source.blocked_count || 0),
    lastRefresh: [acc.lastRefresh, source.last_refresh].filter(Boolean).sort().pop() || null,
  }), {
    searched: 0,
    found: 0,
    noMatch: 0,
    access: 0,
    parse: 0,
    blocked: 0,
    lastRefresh: null as string | null,
  });
  const filteredRatings = useMemo(() => {
    const keys = normalizeSearch(company)
      .split(/[/,;|]+/)
      .map(item => item.trim())
      .filter(Boolean);
    if (!keys.length) return ratings;

    const prefixMatches: RatingRow[] = [];
    const otherMatches: RatingRow[] = [];
    for (const row of ratings) {
      const companyKey = normalizeSearch(row.company);
      if (keys.some(key => companyKey.startsWith(key))) {
        prefixMatches.push(row);
      } else if (keys.some(key => key.length >= 3 && companyKey.includes(key))) {
        otherMatches.push(row);
      }
    }
    return [...prefixMatches, ...otherMatches];
  }, [company, ratings]);
  const visibleRatings = filteredRatings.slice(0, 160);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 850, letterSpacing: 0, marginBottom: 6 }}>Kredi Rating</h1>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Rating kaynağını seçin; son notları ve raporları inceleyin.
          </div>
        </div>
        <button
          onClick={() => void refreshSources(ratingSources, 'Canlı rating kaynakları yenilendi.')}
          disabled={refreshingKey !== null}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, padding: '0 14px',
            borderRadius: 8, border: 'none', background: 'var(--accent)',
            color: '#fff', cursor: refreshingKey ? 'wait' : 'pointer', fontWeight: 850,
          }}
        >
          <RefreshCw size={15} style={refreshingKey === 'bulk' ? { animation: 'spin 1s linear infinite' } : {}} />
          Ratingleri yenile
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 14 }}>
        <MetricCard label="Rating" value={filteredRatings.length.toLocaleString('tr-TR')} icon={ShieldCheck} color="var(--blue)" bg="var(--blue-bg)" />
        <MetricCard label="Kaynak" value={ratingSources.length.toLocaleString('tr-TR')} icon={Database} color="var(--accent)" bg="var(--accent-bg)" />
        <MetricCard label="Link" value={reportCount.toLocaleString('tr-TR')} icon={FileText} color="var(--amber)" bg="var(--amber-bg)" />
        <MetricCard label="Son Çekim" value={latestSourceTime ? formatDateTime(latestSourceTime) : '-'} icon={CheckCircle2} color="var(--text-dim)" bg="var(--bg-surface-2)" />
      </div>

      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: 14, marginBottom: 14, boxShadow: 'var(--shadow)',
      }}>
        <div
          className="rating-filter-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: dateRange === 'custom'
              ? 'minmax(220px, 1fr) minmax(170px, 210px) minmax(150px, 170px) minmax(135px, 150px) minmax(135px, 150px) auto auto'
              : 'minmax(220px, 1fr) minmax(170px, 210px) minmax(150px, 170px) auto auto',
            gap: 10,
            alignItems: 'end',
          }}
        >
          <div>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11, fontWeight: 850, textTransform: 'uppercase', letterSpacing: 0, marginBottom: 6 }}>Şirket</label>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
              <input
                value={company}
                onChange={e => setCompany(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
                placeholder="Şirket adıyla arayın"
                style={{
                  width: '100%', height: 38, padding: '0 12px 0 34px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--bg-surface-2)',
                  color: 'var(--text)', outline: 'none',
                }}
              />
            </div>
          </div>
          <div>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11, fontWeight: 850, textTransform: 'uppercase', letterSpacing: 0, marginBottom: 6 }}>Rating kaynağı</label>
            <select
              value={agency}
              onChange={e => setAgency(e.target.value)}
              style={{ width: '100%', height: 38, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text)', outline: 'none' }}
            >
              <option value="">Tüm ratingler</option>
              {ratingSources.map(source => <option key={source.key} value={source.name}>{source.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11, fontWeight: 850, textTransform: 'uppercase', letterSpacing: 0, marginBottom: 6 }}>Tarih</label>
            <div style={{ position: 'relative' }}>
              <CalendarDays size={14} style={{ position: 'absolute', left: 10, top: 12, color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <select
                value={dateRange}
                onChange={e => {
                  const next = isDateFilterValue(e.target.value) ? e.target.value : 'all';
                  setDateRange(next);
                  if (next !== 'custom') {
                    setMinDate('');
                    setMaxDate('');
                  }
                }}
                style={{ width: '100%', height: 38, padding: '0 10px 0 31px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text)', outline: 'none' }}
              >
                {DATE_FILTERS.map(filter => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
              </select>
            </div>
          </div>
          {dateRange === 'custom' && (
            <>
              <div>
                <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11, fontWeight: 850, textTransform: 'uppercase', letterSpacing: 0, marginBottom: 6 }}>Başlangıç</label>
                <input
                  type="date"
                  value={minDate}
                  onChange={e => setMinDate(e.target.value)}
                  style={{ width: '100%', height: 38, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text)', outline: 'none', fontFamily: 'var(--font-sans)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11, fontWeight: 850, textTransform: 'uppercase', letterSpacing: 0, marginBottom: 6 }}>Bitiş</label>
                <input
                  type="date"
                  value={maxDate}
                  onChange={e => setMaxDate(e.target.value)}
                  style={{ width: '100%', height: 38, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text)', outline: 'none', fontFamily: 'var(--font-sans)' }}
                />
              </div>
            </>
          )}
          <label style={{
            height: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            gap: 7, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--bg-surface-2)', color: 'var(--text-dim)', fontWeight: 800, whiteSpace: 'nowrap',
          }}>
            <input type="checkbox" checked={latestOnly} onChange={e => setLatestOnly(e.target.checked)} />
            Son not
          </label>
          <button
            onClick={handleSearch}
            disabled={loading}
            style={{
              height: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              gap: 7, padding: '0 16px', borderRadius: 8, border: 'none',
              background: 'var(--text)', color: '#fff', cursor: loading ? 'wait' : 'pointer',
              fontWeight: 850,
            }}
          >
            <Search size={14} /> Ara
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            {ratingSources.map(source => (
              <SourceChip
                key={source.key}
                source={source}
                active={agency === source.name}
                busy={refreshingKey === source.key}
                onClick={() => void handleSourceClick(source)}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={clearFilters}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 10px',
                borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)',
                color: 'var(--text-dim)', cursor: 'pointer', fontWeight: 800, whiteSpace: 'nowrap',
              }}
            >
              Filtreleri temizle
            </button>
            <button
              onClick={() => setShowSources(value => !value)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 10px',
                borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)',
                color: 'var(--text-dim)', cursor: 'pointer', fontWeight: 800, whiteSpace: 'nowrap',
              }}
            >
              <SlidersHorizontal size={14} />
              Kaynak yönetimi
              <ChevronDown size={14} style={{ transform: showSources ? 'rotate(180deg)' : undefined }} />
            </button>
          </div>
        </div>

        {showSources && (
          <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 850, textTransform: 'uppercase', marginBottom: 8 }}>Pasife alınan rating kaynakları</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {hiddenSources.length === 0 ? (
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Pasif rating kaynağı yok</span>
              ) : hiddenSources.map(source => {
                const style = statusStyle(source.status_class);
                return (
                  <span key={source.key} title={source.last_errors?.[0] || source.display_status} style={{
                    display: 'inline-flex', gap: 6, alignItems: 'center', padding: '7px 9px',
                    borderRadius: 8, background: style.bg, color: style.color, fontSize: 12, fontWeight: 800,
                  }}>
                    {source.name} <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>{style.label}</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
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
              <AlertTriangle size={15} /> Rating kaynağı kontrolü: {sourceIssues.map(source => source.name).join(', ')}
            </div>
          )}
        </div>
      )}

      {globalSummarySources.length > 0 && (
        <section style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden',
          marginBottom: 14,
        }}>
          <SectionHeader
            icon={Database}
            title={selectedSource && GLOBAL_RATING_AGENCIES.has(selectedSource.name) ? `${selectedSource.name} Özeti` : 'Global Ajans Özeti'}
            meta={`${globalSummarySources.length} kaynak`}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, padding: 12 }}>
            {[
              ['Aranan Şirket', globalSummary.searched.toLocaleString('tr-TR'), 'var(--blue)', 'var(--blue-bg)'],
              ['Bulunan Kayıt', globalSummary.found.toLocaleString('tr-TR'), 'var(--green)', 'var(--green-bg)'],
              ['Eşleşmeyen', globalSummary.noMatch.toLocaleString('tr-TR'), 'var(--text-dim)', 'var(--bg-surface-2)'],
              ['Giriş/Abonelik', globalSummary.access.toLocaleString('tr-TR'), 'var(--amber)', 'var(--amber-bg)'],
              ['Erişim/Okuma Hatası', (globalSummary.blocked + globalSummary.parse).toLocaleString('tr-TR'), 'var(--red)', 'var(--red-bg)'],
              ['Son Çekim', globalSummary.lastRefresh ? formatDateTime(globalSummary.lastRefresh) : '-', 'var(--text-dim)', 'var(--bg-surface-2)'],
            ].map(([label, value, color, bg]) => (
              <div key={label} style={{ border: '1px solid var(--border)', borderRadius: 8, background: bg, padding: '10px 11px', minWidth: 0 }}>
                <div style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 850, textTransform: 'uppercase', marginBottom: 5 }}>{label}</div>
                <div style={{ color, fontFamily: 'var(--font-mono)', fontWeight: 850, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        <SectionHeader icon={ShieldCheck} title="Rating Kayıtları" meta={`${filteredRatings.length.toLocaleString('tr-TR')} kayıt`} />
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 360px)', minHeight: 420 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-surface-2)', position: 'sticky', top: 0, zIndex: 1 }}>
                {['Şirket', 'Ajans', 'Durum', 'Sebep', 'Tarih', 'UVD', 'KVD', 'Görünüm', 'Aksiyon', 'Sektör', 'Çekim', 'Link'].map(head => (
                  <th key={head} style={{ textAlign: 'left', padding: '9px 12px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 850, textTransform: 'uppercase', letterSpacing: 0, whiteSpace: 'nowrap' }}>{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRatings.map((row, index) => {
                const link = sourceLink(row);
                return (
                  <tr key={`${row.company}-${row.agency}-${row.rating_date}-${index}`} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 800, minWidth: 220 }}>{row.company}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{row.agency}</td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <span title={row.error_message || row.matched_name || row.provider_status || 'FOUND'} style={{
                        display: 'inline-flex', alignItems: 'center', padding: '4px 7px',
                        borderRadius: 6, fontSize: 10, fontWeight: 850,
                        color: providerStatusStyle(row.provider_status).color,
                        background: providerStatusStyle(row.provider_status).bg,
                      }}>
                        {providerStatusStyle(row.provider_status).label}
                      </span>
                    </td>
                    <td
                      title={row.error_message || row.matched_name || row.provider_status || '-'}
                      style={{
                        padding: '10px 12px',
                        color: 'var(--text-dim)',
                        minWidth: 180,
                        maxWidth: 270,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {ratingReason(row)}
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: row.rating_is_old ? 'var(--amber)' : 'var(--text-dim)', whiteSpace: 'nowrap' }}>{formatDate(row.rating_date)}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--blue)', fontWeight: 850, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{row.long_term_rating || '-'}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{row.short_term_rating || '-'}</td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{row.outlook || '-'}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{row.action || '-'}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-dim)', minWidth: 150 }}>{row.sector || '-'}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{formatDateTime(row.extracted_at)}</td>
                    <td style={{ padding: '10px 12px' }}>
                      {link ? (
                        <a href={link} target="_blank" rel="noreferrer" title="Kaynak" style={{ display: 'inline-flex', color: 'var(--accent)' }}>
                          <ExternalLink size={15} />
                        </a>
                      ) : '-'}
                    </td>
                  </tr>
                );
              })}
              {!visibleRatings.length && !loading && (
                <tr><td colSpan={12} style={{ padding: 34, textAlign: 'center', color: 'var(--text-muted)' }}>Rating kaydi yok</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 980px) {
          .rating-filter-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
