import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api,
  type ActivityLog,
  type DashboardStats,
  type GraphStats,
  type RatingSource,
} from '../api';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle,
  Clock,
  Database,
  FileX,
  GitBranch,
  Newspaper,
  RefreshCw,
  ShieldCheck,
  Star,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

function number(value: number | undefined) {
  return (value || 0).toLocaleString('tr-TR');
}

function StatCard({ label, value, icon: Icon, color, bg }: {
  label: string;
  value: number;
  icon: LucideIcon;
  color: string;
  bg: string;
}) {
  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: 18, boxShadow: 'var(--shadow)', minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0 }}>{label}</span>
        <span style={{ width: 32, height: 32, background: bg, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color }}>
          <Icon size={16} />
        </span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-mono)', color }}>{number(value)}</div>
    </div>
  );
}

function DataStatusCard({ label, value, meta, icon: Icon, color, onClick }: {
  label: string;
  value: string;
  meta: string;
  icon: LucideIcon;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minWidth: 0, minHeight: 104, padding: 15, textAlign: 'left',
        display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr) 20px',
        alignItems: 'center', gap: 11, border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', background: 'var(--bg-surface)',
        color: 'var(--text)', boxShadow: 'var(--shadow)', cursor: 'pointer',
      }}
    >
      <span style={{
        width: 34, height: 34, display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', borderRadius: 8, color,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}>
        <Icon size={17} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>
          {label}
        </span>
        <strong style={{ display: 'block', marginTop: 5, fontSize: 15, lineHeight: 1.25, color }}>
          {value}
        </strong>
        <span style={{ display: 'block', marginTop: 4, color: 'var(--text-muted)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {meta}
        </span>
      </span>
      <ArrowRight size={16} color="var(--text-muted)" />
    </button>
  );
}

function ActionBadge({ action }: { action: string }) {
  const meta: Record<string, { label: string; color: string }> = {
    process_company: { label: 'Şirket güncellendi', color: 'var(--green)' },
    error: { label: 'Hata', color: 'var(--red)' },
    start_batch: { label: 'Toplu işlem başladı', color: 'var(--blue)' },
    complete_batch: { label: 'Toplu işlem tamamlandı', color: 'var(--green)' },
    stop_batch: { label: 'Toplu işlem durdu', color: 'var(--amber)' },
    no_data: { label: 'Veri bulunamadı', color: 'var(--text-muted)' },
  };
  const item = meta[action] || { label: action.replace(/_/g, ' '), color: 'var(--text-dim)' };
  const color = item.color;
  return (
    <span style={{
      display: 'inline-flex', padding: '3px 8px', borderRadius: 6,
      color, background: `color-mix(in srgb, ${color} 11%, transparent)`,
      fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
    }}>
      {item.label}
    </span>
  );
}

function activityDetail(log: ActivityLog) {
  if (!log.message) return '-';
  try {
    const parsed = JSON.parse(log.message) as {
      errorType?: string;
      errorMessage?: string;
      retryCount?: number;
      durationMs?: number;
    };
    if (parsed && typeof parsed === 'object') {
      const primary = parsed.errorType || parsed.errorMessage || log.message;
      const retry = typeof parsed.retryCount === 'number' ? `${parsed.retryCount} tekrar` : null;
      const duration = typeof parsed.durationMs === 'number' ? `${parsed.durationMs}ms` : null;
      return [primary, parsed.errorMessage && parsed.errorType ? parsed.errorMessage : null, retry, duration].filter(Boolean).join(' - ');
    }
  } catch {
    // Plain legacy log message.
  }
  if (log.message === 'fetch failed') return 'Kaynak bağlantısı başarısız';
  return log.message;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null);
  const [ratingSources, setRatingSources] = useState<RatingSource[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [s, a] = await Promise.all([api.getStats(), api.getActivity()]);
      setStats(s);
      setActivity(a);

      const [graphResult, sourceResult, memberResult] = await Promise.allSettled([
        api.getGraphStats(),
        api.getRatingSources(),
        api.getMembers(),
      ]);
      if (graphResult.status === 'fulfilled') setGraphStats(graphResult.value);
      if (sourceResult.status === 'fulfilled') setRatingSources(sourceResult.value.data);
      if (memberResult.status === 'fulfilled') setMemberCount(memberResult.value.members.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Panel verileri yüklenemedi');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const completion = useMemo(() => {
    if (!stats?.total) return 0;
    return Math.round(((stats.processed + stats.no_data) / stats.total) * 100);
  }, [stats]);

  const sourceOverview = useMemo(() => {
    const enabled = ratingSources.filter(source => source.enabled);
    const summarize = (type: RatingSource['type']) => {
      const rows = enabled.filter(source => source.type === type);
      const issues = rows.filter(source => ['error', 'partial'].includes(source.status_class)).length;
      const lastRefresh = rows
        .map(source => source.last_refresh)
        .filter((value): value is string => Boolean(value))
        .sort()
        .pop();
      return { total: rows.length, issues, lastRefresh };
    };
    return { ratings: summarize('rating'), news: summarize('news') };
  }, [ratingSources]);

  const formatRefresh = (value?: string) => {
    if (!value) return 'Henüz çekim yok';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('tr-TR');
  };

  if (loading) {
    return <div style={{ color: 'var(--text-muted)', padding: 40 }}>Yükleniyor...</div>;
  }

  if (error) {
    return (
      <section className="empty-page" style={{ minHeight: 'calc(100vh - 100px)' }}>
        <AlertCircle size={28} color="var(--red)" />
        <h1>Panel verileri alınamadı</h1>
        <p>{error}</p>
        <button type="button" onClick={loadDashboard}>
          <RefreshCw size={16} />
          Tekrar Dene
        </button>
      </section>
    );
  }

  const cards = [
    { label: 'Toplam Şirket', value: stats?.total || 0, icon: Building2, color: 'var(--blue)', bg: 'var(--blue-bg)' },
    { label: 'İşlenmiş', value: stats?.processed || 0, icon: CheckCircle, color: 'var(--green)', bg: 'var(--green-bg)' },
    { label: 'Bekleyen', value: stats?.pending || 0, icon: Clock, color: 'var(--amber)', bg: 'var(--amber-bg)' },
    { label: 'Hata', value: stats?.errors || 0, icon: AlertCircle, color: 'var(--red)', bg: 'var(--red-bg)' },
    { label: 'Veri Yok', value: stats?.no_data || 0, icon: FileX, color: 'var(--text-muted)', bg: 'var(--bg-surface-2)' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: 0, marginBottom: 6 }}>Ana Panel</h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>KAP işleme durumu, rating merkezi ve ortaklık grafiği tek ekranda.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={loadDashboard}
            disabled={refreshing}
            title="Panel durumunu yenile"
            aria-label="Panel durumunu yenile"
            style={{
              width: 42, minHeight: 42, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface)',
              color: 'var(--accent)', cursor: refreshing ? 'wait' : 'pointer', boxShadow: 'var(--shadow)',
            }}
          >
            <RefreshCw size={16} style={refreshing ? { animation: 'spin 1s linear infinite' } : undefined} />
          </button>
          <div style={{
            minWidth: 210, background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: 12, boxShadow: 'var(--shadow)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>Tamamlanma</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--accent)' }}>%{completion}</span>
            </div>
            <div style={{ height: 7, borderRadius: 999, background: 'var(--bg-surface-3)', overflow: 'hidden' }}>
              <div style={{ width: `${completion}%`, height: '100%', background: 'var(--accent)' }} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 18 }}>
        {cards.map(card => <StatCard key={card.label} {...card} />)}
      </div>

      <section style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800, margin: 0 }}>
            <Database size={16} /> Veri Durumu
          </h2>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Canlı servis özeti</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
          <DataStatusCard
            label="KAP Kapsamı"
            value={`${number(stats?.processed)} / ${number(stats?.total)} şirket`}
            meta={`${number(stats?.errors)} hata, ${number(stats?.pending)} bekleyen`}
            icon={Building2}
            color="var(--blue)"
            onClick={() => navigate('/processing')}
          />
          <DataStatusCard
            label="Rating Kaynakları"
            value={`${sourceOverview.ratings.total - sourceOverview.ratings.issues} / ${sourceOverview.ratings.total} erişilebilir`}
            meta={sourceOverview.ratings.issues ? `${sourceOverview.ratings.issues} kaynak dikkat gerektiriyor` : formatRefresh(sourceOverview.ratings.lastRefresh)}
            icon={ShieldCheck}
            color={sourceOverview.ratings.issues ? 'var(--amber)' : 'var(--green)'}
            onClick={() => navigate('/ratings')}
          />
          <DataStatusCard
            label="Haber Kaynakları"
            value={`${sourceOverview.news.total - sourceOverview.news.issues} / ${sourceOverview.news.total} erişilebilir`}
            meta={sourceOverview.news.issues ? `${sourceOverview.news.issues} kaynak dikkat gerektiriyor` : formatRefresh(sourceOverview.news.lastRefresh)}
            icon={Newspaper}
            color={sourceOverview.news.issues ? 'var(--amber)' : 'var(--green)'}
            onClick={() => navigate('/news')}
          />
          <DataStatusCard
            label="Ortaklık Ağı"
            value={`${number(graphStats?.totalNodes)} düğüm`}
            meta={`${number(graphStats?.totalEdges)} bağlantı, ${memberCount.toLocaleString('tr-TR')} üye şirket`}
            icon={graphStats?.totalEdges ? GitBranch : Star}
            color="var(--accent)"
            onClick={() => navigate('/graph')}
          />
        </div>
      </section>

      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800, margin: 0 }}>
            <BarChart3 size={16} /> Son İşlemler
          </h2>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{activity.length} kayıt</span>
        </div>
        <div style={{ maxHeight: 430, overflowY: 'auto' }}>
          {activity.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Henüz işlem yapılmadı.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface-2)' }}>
                  {['Zaman', 'İşlem', 'Şirket', 'Detay'].map(head => (
                    <th key={head} style={{ textAlign: 'left', padding: '9px 16px', fontWeight: 800, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0 }}>{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activity.map(log => (
                  <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(log.created_at).toLocaleString('tr-TR')}
                    </td>
                    <td style={{ padding: '10px 16px' }}><ActionBadge action={log.action} /></td>
                    <td style={{ padding: '10px 16px', fontWeight: 700, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.company_name || '-'}
                    </td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-dim)', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {activityDetail(log)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
