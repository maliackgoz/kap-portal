import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { LayoutDashboard, Database, GitBranch, Building2, LogOut, ShieldCheck, Newspaper } from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/company', icon: Building2, label: 'Sirket Detay' },
  { to: '/ratings', icon: ShieldCheck, label: 'Kredi Rating' },
  { to: '/news', icon: Newspaper, label: 'Haberler' },
  { to: '/processing', icon: Database, label: 'Veri Isle' },
  { to: '/graph', icon: GitBranch, label: 'Graph' },
];

export default function Layout() {
  const { username, logout } = useAuth();

  const navStyle = (isActive: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
    borderRadius: 8, textDecoration: 'none', fontSize: 13, fontWeight: 700,
    color: isActive ? 'var(--accent)' : 'var(--text-dim)',
    background: isActive ? 'var(--accent-bg)' : 'transparent',
    border: isActive ? '1px solid color-mix(in srgb, var(--accent) 18%, transparent)' : '1px solid transparent',
    transition: 'all 0.15s',
  });

  return (
    <div className="app-shell" style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <aside className="app-sidebar" style={{
        width: 248, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: 0 }}>Finansal Portal</div>
        </div>

        {/* Nav */}
        <nav className="app-nav" style={{ padding: '16px 12px', flex: 1 }}>
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'} style={({ isActive }) => navStyle(isActive)}>
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom */}
        <div className="app-sidebar-bottom" style={{ padding: '16px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Oturum</div>
              <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{username}</span>
            </div>
            <button onClick={logout} title="Cikis" style={{
              background: 'var(--bg-surface-2)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '8px', cursor: 'pointer', color: 'var(--text-dim)',
              display: 'flex', alignItems: 'center',
            }}>
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Content */}
      <main className="app-main" style={{ flex: 1, overflow: 'auto', padding: '30px 34px' }}>
        <Outlet />
      </main>
      <style>{`
        @media (max-width: 760px) {
          .app-shell { flex-direction: column; }
          .app-sidebar {
            width: 100% !important;
            border-right: none !important;
            border-bottom: 1px solid var(--border);
          }
          .app-sidebar > div:first-child { padding: 14px 16px !important; }
          .app-nav {
            display: flex;
            gap: 6px;
            overflow-x: auto;
            padding: 10px 12px !important;
            flex: none !important;
          }
          .app-nav a { flex: 0 0 auto; }
          .app-sidebar-bottom { display: none; }
          .app-main { padding: 18px 14px !important; }
        }
      `}</style>
    </div>
  );
}
