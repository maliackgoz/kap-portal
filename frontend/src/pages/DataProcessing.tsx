import { Fragment, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { api, type Company } from '../api';
import { useSSE } from '../hooks/useSSE';
import { Play, RefreshCw, Square, Loader, CheckCircle, XCircle, MinusCircle, Search, ExternalLink, Star } from 'lucide-react';
import { useMemberCompanies } from '../hooks/useMemberCompanies';

interface ProgressInfo {
  current: number;
  total: number;
  percent: number;
  companyName: string;
}

interface LogItem {
  type: 'done' | 'error' | 'skip';
  name: string;
  detail?: string;
  rawDetail?: KapLogDetail | null;
  time: string;
}

type ProcessingScope = 'pending' | 'all' | 'members';
type CompanyStatusFilter = 'all' | 'not_done' | 'problem' | 'pending' | 'processing' | 'done' | 'error' | 'no_data';

type KapLogDetail = {
  companyName?: string;
  kapId?: string;
  resolvedKapUrl?: string;
  requestUrl?: string;
  httpStatus?: number;
  statusText?: string;
  errorType?: string;
  errorMessage?: string;
  errorCause?: string;
  durationMs?: number;
  retryCount?: number;
  responseLength?: number;
  processingStartedAt?: string;
  processingFinishedAt?: string;
};

const KAP_COMPANY_BASE = 'https://www.kap.org.tr/tr/sirket-bilgileri/genel';

const statusFilters: Array<{ value: CompanyStatusFilter; label: string }> = [
  { value: 'all', label: 'Tumu' },
  { value: 'not_done', label: 'Cekilmeyen' },
  { value: 'problem', label: 'Sorunlu' },
  { value: 'pending', label: 'Bekleyen' },
  { value: 'done', label: 'Cekildi' },
  { value: 'error', label: 'Hata' },
  { value: 'no_data', label: 'Veri Yok' },
];

function normalizeSearch(value: string | null | undefined) {
  return (value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[\u0131\u0130]/g, 'i')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function kapCompanyUrl(slug: string) {
  return `${KAP_COMPANY_BASE}/${slug}`;
}

function statusMeta(status: string) {
  if (status === 'done') return { label: 'Cekildi', color: 'var(--green)', bg: 'var(--green-bg)' };
  if (status === 'error') return { label: 'Cekilemedi', color: 'var(--red)', bg: 'var(--red-bg)' };
  if (status === 'no_data') return { label: 'Veri Yok', color: 'var(--amber)', bg: 'var(--amber-bg)' };
  if (status === 'processing') return { label: 'Cekiliyor', color: 'var(--blue)', bg: 'var(--blue-bg)' };
  return { label: 'Bekliyor', color: 'var(--text-muted)', bg: 'var(--bg-surface-2)' };
}

function matchesStatus(company: Company, filter: CompanyStatusFilter) {
  if (filter === 'all') return true;
  if (filter === 'not_done') return company.status !== 'done';
  if (filter === 'problem') return company.status === 'error' || company.status === 'no_data';
  return company.status === filter;
}

function eventData(data: unknown): Record<string, unknown> {
  return typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function parseLogDetail(value: string | null | undefined): KapLogDetail | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed as KapLogDetail : null;
  } catch {
    return null;
  }
}

function shortLogMessage(value: string | null | undefined) {
  const detail = parseLogDetail(value);
  if (!detail) return value || '-';
  const primary = detail.errorType || detail.errorMessage || 'OK';
  const retry = typeof detail.retryCount === 'number' ? `${detail.retryCount} retry` : null;
  const duration = typeof detail.durationMs === 'number' ? `${detail.durationMs}ms` : null;
  return [primary, detail.errorMessage && detail.errorType ? detail.errorMessage : null, retry, duration].filter(Boolean).join(' - ');
}

export default function DataProcessing() {
  const [running, setRunning] = useState(false);
  const [activeScope, setActiveScope] = useState<ProcessingScope>('pending');
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [summary, setSummary] = useState<{ processed: number; errors: number } | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companyQuery, setCompanyQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<CompanyStatusFilter>('all');
  const [scrapingId, setScrapingId] = useState<number | null>(null);
  const [companyListError, setCompanyListError] = useState<string | null>(null);
  const [expandedLogIndex, setExpandedLogIndex] = useState<number | null>(null);
  const [expandedCompanyId, setExpandedCompanyId] = useState<number | null>(null);
  const [membersOnly, setMembersOnly] = useState(false);
  const { memberIds, members } = useMemberCompanies(companies);
  const logsRef = useRef<HTMLDivElement>(null);

  const addLog = (item: LogItem) => {
    setLogs(prev => [item, ...prev].slice(0, 200));
  };

  const loadCompanies = useCallback(async () => {
    setCompanyListError(null);
    try {
      const rows = await api.getAllCompanies();
      setCompanies(rows);
    } catch (err) {
      setCompanyListError(err instanceof Error ? err.message : 'Sirket listesi alinamadi');
    } finally {
      setCompaniesLoading(false);
    }
  }, []);

  const updateCompanyStatus = useCallback((id: number, status: Company['status']) => {
    if (!id) return;
    setCompanies(prev => prev.map(company => (
      company.id === id
        ? { ...company, status, last_processed_at: new Date().toISOString() }
        : company
    )));
  }, []);

  const handleSSE = useCallback((event: string, rawData: unknown) => {
    const data = eventData(rawData);
    switch (event) {
      case 'state':
        setRunning(data.running === true);
        if (data.scope === 'all' || data.scope === 'pending' || data.scope === 'members') setActiveScope(data.scope);
        if (data.running === true) {
          const current = numberValue(data.current);
          const total = numberValue(data.total);
          setProgress({
            current,
            total,
            percent: total > 0 ? Math.round((current / total) * 100) : 0,
            companyName: stringValue(data.currentCompany),
          });
        }
        break;
      case 'batch_start':
        setRunning(true);
        if (data.scope === 'all' || data.scope === 'pending' || data.scope === 'members') setActiveScope(data.scope);
        setSummary(null);
        setLogs([]);
        setProgress({ current: 0, total: numberValue(data.total), percent: 0, companyName: '' });
        break;
      case 'progress':
        setProgress({
          current: numberValue(data.current),
          total: numberValue(data.total),
          percent: numberValue(data.percent),
          companyName: stringValue(data.companyName),
        });
        break;
      case 'company_done':
        addLog({
          type: 'done',
          name: stringValue(data.name),
          detail: `${numberValue(data.keys)} veri`,
          rawDetail: parseLogDetail(stringValue(data.detail)),
          time: new Date().toLocaleTimeString('tr-TR'),
        });
        updateCompanyStatus(numberValue(data.id), 'done');
        break;
      case 'company_error':
        addLog({
          type: 'error',
          name: stringValue(data.name),
          detail: shortLogMessage(stringValue(data.detail)) || stringValue(data.error),
          rawDetail: parseLogDetail(stringValue(data.detail)),
          time: new Date().toLocaleTimeString('tr-TR'),
        });
        updateCompanyStatus(numberValue(data.id), 'error');
        break;
      case 'company_skip':
        addLog({
          type: 'skip',
          name: stringValue(data.name),
          detail: shortLogMessage(stringValue(data.detail)) || 'Genel bilgiler yok',
          rawDetail: parseLogDetail(stringValue(data.detail)),
          time: new Date().toLocaleTimeString('tr-TR'),
        });
        updateCompanyStatus(numberValue(data.id), 'no_data');
        break;
      case 'cooldown':
        addLog({
          type: 'skip',
          name: 'KAP bekleme',
          detail: stringValue(data.message, 'KAP ag hatasi nedeniyle bekleniyor'),
          time: new Date().toLocaleTimeString('tr-TR'),
        });
        break;
      case 'batch_done':
      case 'batch_stopped':
        setRunning(false);
        setSummary({ processed: numberValue(data.processed), errors: numberValue(data.errors) });
        void loadCompanies();
        break;
    }
  }, [loadCompanies, updateCompanyStatus]);

  const { connect, disconnect } = useSSE('/api/processing/events', handleSSE);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  const handleStart = async (scope: ProcessingScope) => {
    try {
      if (scope === 'members' && memberIds.length === 0) {
        alert('Once uye sirket eklemen gerekiyor');
        return;
      }
      setActiveScope(scope);
      await api.startProcessing(scope, scope === 'members' ? memberIds : undefined);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Isleme baslatilamadi');
    }
  };

  const handleStop = async () => {
    try {
      await api.stopProcessing();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Isleme durdurulamadi');
    }
  };

  const handleScrapeCompany = async (company: Company) => {
    setScrapingId(company.id);
    updateCompanyStatus(company.id, 'processing');
    try {
      await api.scrapeCompany(company.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Sirket cekilemedi');
    } finally {
      await loadCompanies();
      setScrapingId(null);
    }
  };

  const doneCount = logs.filter(l => l.type === 'done').length;
  const errorCount = logs.filter(l => l.type === 'error').length;
  const skipCount = logs.filter(l => l.type === 'skip').length;
  const activeScopeLabel = activeScope === 'all'
    ? 'Tum KAP verileri yenileniyor'
    : activeScope === 'members'
      ? 'Uye sirketlerin KAP verileri yenileniyor'
      : 'Bekleyen, hatali ve veri-yok kayitlar isleniyor';
  const memberIdSet = useMemo(() => new Set(memberIds), [memberIds]);
  const filteredCompanies = useMemo(() => {
    const query = normalizeSearch(companyQuery);
    return companies
      .filter(company => !membersOnly || memberIdSet.has(company.id))
      .filter(company => matchesStatus(company, statusFilter))
      .filter(company => {
        if (!query) return true;
        const haystack = normalizeSearch([
          company.name,
          company.slug,
          company.oid,
          company.ticker || '',
          String(company.id),
        ].join(' '));
        return haystack.includes(query);
      });
  }, [companies, companyQuery, memberIdSet, membersOnly, statusFilter]);
  const visibleCompanies = filteredCompanies.slice(0, 160);

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: 0, marginBottom: 6 }}>Veri Isleme</h1>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>KAP sirket verilerini toplu guncelle, canli islem logunu takip et.</div>
      </div>

      {/* Controls */}
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: 22, marginBottom: 20, boxShadow: 'var(--shadow)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: running ? 20 : 0, flexWrap: 'wrap' }}>
          {!running ? (
            <>
              <button onClick={() => void handleStart('pending')} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px',
                background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8,
                fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}>
                <Play size={16} /> Bekleyen, Hatali ve Veri Yok Olanlari Isle
              </button>
              <button onClick={() => void handleStart('all')} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px',
                background: 'var(--blue-bg)', color: 'var(--blue)', border: '1px solid color-mix(in srgb, var(--blue) 22%, transparent)', borderRadius: 8,
                fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}>
                <RefreshCw size={16} /> Tum KAP Verilerini Yenile
              </button>
              <button
                onClick={() => void handleStart('members')}
                disabled={memberIds.length === 0}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px',
                  background: memberIds.length ? 'var(--green-bg)' : 'var(--bg-surface-2)',
                  color: memberIds.length ? 'var(--green)' : 'var(--text-muted)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  fontSize: 14, fontWeight: 800,
                  cursor: memberIds.length ? 'pointer' : 'not-allowed',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                <Star size={16} /> Uye KAP Verilerini Cek
              </button>
            </>
          ) : (
            <button onClick={handleStop} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px',
              background: 'var(--bg-surface-3)', color: 'var(--text)', border: '1px solid var(--border)',
              borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)',
            }}>
              <Square size={14} /> Durdur
            </button>
          )}

          {running && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-dim)', fontSize: 13 }}>
              <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
              <span style={{ fontWeight: 700 }}>{activeScopeLabel}</span>
              <span>{progress?.companyName}</span>
            </div>
          )}

          {summary && !running && (
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              Tamamlandi: <span style={{ color: 'var(--green)', fontWeight: 600 }}>{summary.processed} basarili</span>,{' '}
              <span style={{ color: 'var(--red)', fontWeight: 600 }}>{summary.errors} hata</span>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        {running && progress && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, fontFamily: 'var(--font-mono)' }}>
              <span style={{ color: 'var(--text-dim)' }}>{progress.current} / {progress.total}</span>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>%{progress.percent}</span>
            </div>
            <div style={{ height: 6, background: 'var(--bg-surface-3)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', background: 'var(--accent)', borderRadius: 3,
                width: `${progress.percent}%`, transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        )}
      </div>

      {/* Member Scope */}
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: 16, marginBottom: 20, boxShadow: 'var(--shadow)',
        display: 'grid', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--accent)', fontSize: 13, fontWeight: 850 }}>
            <Star size={15} /> Uye Sirketler
            <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              {members.length.toLocaleString('tr-TR')} uye
            </span>
          </div>
          <button
            type="button"
            onClick={() => setMembersOnly(value => !value)}
            disabled={members.length === 0}
            style={{
              height: 32, padding: '0 10px', borderRadius: 8,
              border: membersOnly ? '1px solid var(--accent)' : '1px solid var(--border)',
              background: membersOnly ? 'var(--accent-bg)' : 'var(--bg-surface-2)',
              color: membersOnly ? 'var(--accent)' : 'var(--text-dim)',
              cursor: members.length ? 'pointer' : 'not-allowed',
              opacity: members.length ? 1 : 0.55,
              fontSize: 12, fontWeight: 850, fontFamily: 'inherit',
            }}
          >
            {membersOnly ? 'Tum sirketleri goster' : 'Sadece uyeleri goster'}
          </button>
        </div>

        {members.length === 0 ? (
          <div style={{
            padding: '10px 12px', borderRadius: 8, border: '1px dashed var(--border)',
            background: 'var(--bg-surface-2)', color: 'var(--text-muted)', fontSize: 12,
          }}>
            Uye listesi bos. Sirket Detay veya Ortaklik Grafi ekranindan uye ekleyince burada sadece o listeyi cekebilirsin.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxHeight: 120, overflowY: 'auto' }}>
            {members.map(member => {
              const meta = statusMeta(member.status);
              return (
                <span
                  key={member.id}
                  title={member.name}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    maxWidth: 260, padding: '7px 9px', borderRadius: 8,
                    border: '1px solid var(--border)', background: 'var(--bg-surface-2)',
                    color: 'var(--text)', fontSize: 12, fontWeight: 800,
                  }}
                >
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: meta.color, flexShrink: 0,
                  }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {member.name}
                  </span>
                  <span style={{ color: meta.color, fontSize: 10, fontWeight: 850, whiteSpace: 'nowrap' }}>
                    {meta.label}
                  </span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Company Status Search */}
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', overflow: 'hidden', boxShadow: 'var(--shadow)', marginBottom: 20,
      }}>
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
          display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) auto', gap: 12, alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <Search size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <input
              value={companyQuery}
              onChange={event => setCompanyQuery(event.target.value)}
              placeholder="Sirket, kod, OID veya slug ara..."
              style={{
                width: '100%', height: 36, padding: '0 12px',
                borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--bg-surface-2)', color: 'var(--text)',
                outline: 'none', fontSize: 13, fontFamily: 'inherit',
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {statusFilters.map(filter => {
              const active = statusFilter === filter.value;
              return (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setStatusFilter(filter.value)}
                  style={{
                    height: 32, padding: '0 10px', borderRadius: 8,
                    border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: active ? 'var(--accent-bg)' : 'var(--bg-surface-2)',
                    color: active ? 'var(--accent)' : 'var(--text-dim)',
                    cursor: 'pointer', fontSize: 12, fontWeight: 850, fontFamily: 'inherit',
                  }}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{
          padding: '10px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
          fontSize: 12, color: 'var(--text-muted)',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            {filteredCompanies.length.toLocaleString('tr-TR')} eslesme
            {filteredCompanies.length > visibleCompanies.length ? ` / ilk ${visibleCompanies.length}` : ''}
          </span>
          {companyListError && <span style={{ color: 'var(--red)', fontWeight: 700 }}>{companyListError}</span>}
        </div>

        <div style={{ overflowX: 'auto' }}>
          {companiesLoading ? (
            <div style={{ padding: 34, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Sirket listesi yukleniyor...
            </div>
          ) : visibleCompanies.length === 0 ? (
            <div style={{ padding: 34, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Eslesen sirket yok.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1040 }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface-2)' }}>
                  {['Sirket', 'Durum', 'Son Detay', 'Son Cekim', 'KAP Link', 'Aksiyon'].map(head => (
                    <th key={head} style={{ textAlign: 'left', padding: '9px 14px', fontWeight: 850, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0 }}>
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleCompanies.map(company => {
                  const meta = statusMeta(company.status);
                  const isBusy = scrapingId === company.id || company.status === 'processing';
                  const lastDetail = parseLogDetail(company.last_log_message);
                  const expanded = expandedCompanyId === company.id;
                  return (
                    <Fragment key={company.id}>
                      <tr style={{ borderBottom: expanded ? 'none' : '1px solid var(--border)' }}>
                        <td style={{ padding: '10px 14px', minWidth: 320 }}>
                          <div style={{ fontWeight: 850, color: 'var(--text)', maxWidth: 480, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {company.name}
                          </div>
                          <div style={{ marginTop: 3, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                            ID: {company.id} {company.ticker ? ` / ${company.ticker}` : ''} / OID: {company.oid}
                          </div>
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '4px 9px', borderRadius: 8, color: meta.color, background: meta.bg,
                            fontSize: 11, fontWeight: 850,
                          }}>
                            {company.status === 'done' && <CheckCircle size={13} />}
                            {company.status === 'error' && <XCircle size={13} />}
                            {company.status === 'no_data' && <MinusCircle size={13} />}
                            {company.status === 'processing' && <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} />}
                            {meta.label}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', maxWidth: 260 }}>
                          <button
                            type="button"
                            onClick={() => setExpandedCompanyId(expanded ? null : company.id)}
                            disabled={!company.last_log_message}
                            style={{
                              border: 'none', background: 'transparent', padding: 0, textAlign: 'left',
                              color: company.last_log_message ? 'var(--text-dim)' : 'var(--text-muted)',
                              cursor: company.last_log_message ? 'pointer' : 'default',
                              fontSize: 12, fontFamily: 'inherit', maxWidth: 250,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}
                            title={shortLogMessage(company.last_log_message)}
                          >
                            {shortLogMessage(company.last_log_message)}
                          </button>
                        </td>
                        <td style={{ padding: '10px 14px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'nowrap' }}>
                          {company.last_processed_at ? new Date(company.last_processed_at).toLocaleString('tr-TR') : '-'}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <a
                            href={kapCompanyUrl(company.slug)}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 6,
                              color: company.status === 'error' || company.status === 'no_data' ? 'var(--red)' : 'var(--accent)',
                              fontSize: 12, fontWeight: 850, textDecoration: 'none',
                            }}
                          >
                            <ExternalLink size={13} /> KAP'ta Ac
                          </a>
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <button
                            type="button"
                            onClick={() => void handleScrapeCompany(company)}
                            disabled={running || isBusy || scrapingId !== null}
                            style={{
                              height: 32, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 10px',
                              borderRadius: 8, border: '1px solid var(--border)',
                              background: running || isBusy || scrapingId !== null ? 'var(--bg-surface-2)' : 'var(--blue-bg)',
                              color: running || isBusy || scrapingId !== null ? 'var(--text-muted)' : 'var(--blue)',
                              cursor: running || isBusy || scrapingId !== null ? 'not-allowed' : 'pointer',
                              fontSize: 12, fontWeight: 850, fontFamily: 'inherit',
                            }}
                          >
                            <RefreshCw size={13} style={isBusy ? { animation: 'spin 1s linear infinite' } : undefined} />
                            {isBusy ? 'Cekiliyor' : 'Yenile'}
                          </button>
                        </td>
                      </tr>
                      {expanded && lastDetail && (
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <td colSpan={6} style={{ padding: '0 14px 12px 14px' }}>
                            <div style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface-2)', padding: 12, display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
                              {[
                                ['Request URL', lastDetail.requestUrl],
                                ['HTTP Status', lastDetail.httpStatus ? `${lastDetail.httpStatus} ${lastDetail.statusText || ''}` : '-'],
                                ['Error Type', lastDetail.errorType || '-'],
                                ['Error Message', lastDetail.errorMessage || '-'],
                                ['Error Cause', lastDetail.errorCause || '-'],
                                ['Retry', typeof lastDetail.retryCount === 'number' ? String(lastDetail.retryCount) : '-'],
                                ['Duration', typeof lastDetail.durationMs === 'number' ? `${lastDetail.durationMs}ms` : '-'],
                                ['Response Length', typeof lastDetail.responseLength === 'number' ? String(lastDetail.responseLength) : '-'],
                              ].map(([label, value]) => (
                                <div key={label} style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 8 }}>
                                  <span style={{ color: 'var(--text-muted)', fontWeight: 850 }}>{label}</span>
                                  <span style={{ fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' }}>{value || '-'}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Mini Stats */}
      {logs.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: 'var(--green-bg)', borderRadius: 6, fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>
            <CheckCircle size={14} /> {doneCount}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: 'var(--red-bg)', borderRadius: 6, fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>
            <XCircle size={14} /> {errorCount}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: 'var(--bg-surface-2)', borderRadius: 6, fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
            <MinusCircle size={14} /> {skipCount}
          </div>
        </div>
      )}

      {/* Log Table */}
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', overflow: 'hidden', boxShadow: 'var(--shadow)',
      }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Islem Kayitlari</h2>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{logs.length} kayit</span>
        </div>
        <div ref={logsRef} style={{ maxHeight: 450, overflowY: 'auto' }}>
          {logs.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Islem baslatildiginda sirket bazli sonuclar burada gorunur.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                {logs.map((log, i) => {
                  const expanded = expandedLogIndex === i;
                  return (
                    <Fragment key={`${log.time}-${log.name}-${i}`}>
                      <tr style={{ borderBottom: expanded ? 'none' : '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 16px', width: 30 }}>
                          {log.type === 'done' && <CheckCircle size={14} color="var(--green)" />}
                          {log.type === 'error' && <XCircle size={14} color="var(--red)" />}
                          {log.type === 'skip' && <MinusCircle size={14} color="var(--text-muted)" />}
                        </td>
                        <td style={{ padding: '8px 0', fontWeight: 500, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {log.name}
                        </td>
                        <td style={{ padding: '8px 16px', color: log.type === 'error' ? 'var(--red)' : 'var(--text-muted)', fontSize: 12 }}>
                          <button
                            type="button"
                            onClick={() => setExpandedLogIndex(expanded ? null : i)}
                            disabled={!log.rawDetail}
                            style={{
                              border: 'none', background: 'transparent', padding: 0, color: 'inherit',
                              cursor: log.rawDetail ? 'pointer' : 'default', font: 'inherit', textAlign: 'left',
                            }}
                          >
                            {log.detail}
                          </button>
                        </td>
                        <td style={{ padding: '8px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {log.time}
                        </td>
                      </tr>
                      {expanded && log.rawDetail && (
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <td />
                          <td colSpan={3} style={{ padding: '0 16px 12px 0' }}>
                            <div style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface-2)', padding: 12, display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
                              {[
                                ['Request URL', log.rawDetail.requestUrl],
                                ['HTTP Status', log.rawDetail.httpStatus ? `${log.rawDetail.httpStatus} ${log.rawDetail.statusText || ''}` : '-'],
                                ['Error Type', log.rawDetail.errorType || '-'],
                                ['Error Message', log.rawDetail.errorMessage || '-'],
                                ['Error Cause', log.rawDetail.errorCause || '-'],
                                ['Retry', typeof log.rawDetail.retryCount === 'number' ? String(log.rawDetail.retryCount) : '-'],
                                ['Duration', typeof log.rawDetail.durationMs === 'number' ? `${log.rawDetail.durationMs}ms` : '-'],
                                ['Response Length', typeof log.rawDetail.responseLength === 'number' ? String(log.rawDetail.responseLength) : '-'],
                              ].map(([label, value]) => (
                                <div key={label} style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 8 }}>
                                  <span style={{ color: 'var(--text-muted)', fontWeight: 850 }}>{label}</span>
                                  <span style={{ fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' }}>{value || '-'}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
