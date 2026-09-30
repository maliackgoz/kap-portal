import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { LayoutDashboard, Database, GitBranch, Building2, LogOut, ShieldCheck, Newspaper } from 'lucide-react';
import { api } from '../api';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Ana Panel', adminOnly: true },
  { to: '/processing', icon: Database, label: 'Veri İşleme', adminOnly: true },
  { to: '/company', icon: Building2, label: 'Şirket Detayı' },
  { to: '/graph', icon: GitBranch, label: 'Ortaklık Ağı' },
  { to: '/ratings', icon: ShieldCheck, label: 'Kredi Rating' },
  { to: '/news', icon: Newspaper, label: 'Haberler' },
];

export default function Layout() {
  const { username, isAdmin, logout } = useAuth();
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const check = () => {
      api.getHealth()
        .then(() => { if (active) setOnline(true); })
        .catch(() => { if (active) setOnline(false); });
    };
    check();
    const timer = window.setInterval(check, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <NavLink to={isAdmin ? '/' : '/company'} className="app-brand">
            <span className="app-brand__mark">KP</span>
            KAP Portal
          </NavLink>

          <nav className="app-nav">
            {navItems.filter(item => isAdmin || !item.adminOnly).map(({ to, icon: Icon, label }) => (
              <NavLink key={to} to={to} end={to === '/'} className="app-nav__link">
                <Icon size={15} />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="app-header__user">
            <span
              className={`service-state__dot ${online === false ? 'is-offline' : online ? 'is-online' : ''}`}
              title={online === false ? 'Portal servisine ulaşılamıyor' : online ? 'Sistem aktif' : 'Kontrol ediliyor'}
            />
            <span className="app-header__username">{username}</span>
            <button onClick={logout} title="Çıkış" aria-label="Oturumu kapat" className="app-header__logout">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
