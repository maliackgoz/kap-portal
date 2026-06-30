import { useEffect, useMemo, useState } from 'react';
import { api, type ActivityLog, type DashboardStats } from '../api';
import {
  AlertCircle,
  BarChart3,
  Building2,
  CheckCircle,
  Clock,
  FileX,
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

function ActionBadge({ action }: { action: string }) {
  const meta: Record<string, { label: string; color: string }> = {
    process_company: { label: 'Sirket guncellendi', color: 'var(--green)' },
    error: { label: 'Hata', color: 'var(--red)' },
    start_batch: { label: 'Toplu islem basladi', color: 'var(--blue)' },
    complete_batch: { label: 'Toplu islem tamamlandi', color: 'var(--green)' },
    stop_batch: { label: 'Toplu islem durdu', color: 'var(--amber)' },
    no_data: { label: 'Veri bulunamadi', color: 'var(--text-muted)' },
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
      const retry = typeof parsed.retryCount === 'number' ? `${parsed.retryCount} retry` : null;
      const duration = typeof parsed.durationMs === 'number' ? `${parsed.durationMs}ms` : null;
      return [primary, parsed.errorMessage && parsed.errorType ? parsed.errorMessage : null, retry, duration].filter(Boolean).join(' - ');
    }
  } catch {
    // Plain legacy log message.
  }
  if (log.message === 'fetch failed') return 'Kaynak baglantisi basarisiz';
  return log.message;
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getStats(), api.getActivity()])
      .then(([s, a]) => { setStats(s); setActivity(a); })
      .finally(() => setLoading(false));
  }, []);

  const completion = useMemo(() => {
    if (!stats?.total) return 0;
    return Math.round(((stats.processed + stats.no_data) / stats.total) * 100);
  }, [stats]);

  if (loading) {
    return <div style={{ color: 'var(--text-muted)', padding: 40 }}>Yukleniyor...</div>;
  }

  const cards = [
    { label: 'Toplam Sirket', value: stats?.total || 0, icon: Building2, color: 'var(--blue)', bg: 'var(--blue-bg)' },
    { label: 'Islenmis', value: stats?.processed || 0, icon: CheckCircle, color: 'var(--green)', bg: 'var(--green-bg)' },
    { label: 'Bekleyen', value: stats?.pending || 0, icon: Clock, color: 'var(--amber)', bg: 'var(--amber-bg)' },
    { label: 'Hata', value: stats?.errors || 0, icon: AlertCircle, color: 'var(--red)', bg: 'var(--red-bg)' },
    { label: 'Veri Yok', value: stats?.no_data || 0, icon: FileX, color: 'var(--text-muted)', bg: 'var(--bg-surface-2)' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: 0, marginBottom: 6 }}>Dashboard</h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>KAP isleme durumu, rating merkezi ve ortaklik grafigi tek ekranda.</div>
        </div>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 18 }}>
        {cards.map(card => <StatCard key={card.label} {...card} />)}
      </div>

      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800, margin: 0 }}>
            <BarChart3 size={16} /> Son Islemler
          </h2>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{activity.length} kayit</span>
        </div>
        <div style={{ maxHeight: 430, overflowY: 'auto' }}>
          {activity.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Henuz islem yapilmadi.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface-2)' }}>
                  {['Zaman', 'Islem', 'Sirket', 'Detay'].map(head => (
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
