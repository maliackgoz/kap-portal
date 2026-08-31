import { useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { useAuth } from '../context/useAuth';

export default function LoginForm() {
  const { login, error } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(username, password);
    } catch {
      setLoading(false);
      return;
    }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 20,
    }}>
      <form onSubmit={handleSubmit} style={{
        width: 380, background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '42px 34px', boxShadow: 'var(--shadow-md)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 48, height: 48, background: 'var(--accent)', borderRadius: 8,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 800, color: '#fff', fontFamily: 'var(--font-mono)',
            marginBottom: 16,
          }}><LockKeyhole size={22} /></div>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: 0, margin: 0 }}>Finansal Portal</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6 }}>Kurumsal finansal analiz platformu</p>
        </div>

        {error && (
          <div style={{
            background: 'var(--red-bg)', color: 'var(--red)', padding: '10px 14px',
            borderRadius: 8, fontSize: 13, marginBottom: 16, textAlign: 'center',
          }}>{error}</div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0 }}>
            Kullanıcı Adı
          </label>
          <input
            type="text" value={username} onChange={e => setUsername(e.target.value)}
            placeholder="Kullanıcı adınızı girin" autoFocus autoComplete="username"
            disabled={loading} required
            style={{
              width: '100%', padding: '10px 14px', background: 'var(--bg-surface-2)',
              border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)',
              fontSize: 14, fontFamily: 'var(--font-mono)', outline: 'none',
            }}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0 }}>
            Şifre
          </label>
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Şifrenizi girin" autoComplete="current-password"
            disabled={loading} required
            style={{
              width: '100%', padding: '10px 14px', background: 'var(--bg-surface-2)',
              border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)',
              fontSize: 14, fontFamily: 'var(--font-mono)', outline: 'none',
            }}
          />
        </div>

        <button type="submit" disabled={loading} style={{
          width: '100%', padding: '12px', background: 'var(--accent)', color: '#fff',
          border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700,
          cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
          fontFamily: 'var(--font-sans)',
        }}>
          {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
        </button>
      </form>
    </div>
  );
}
