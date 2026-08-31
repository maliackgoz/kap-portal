import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}
interface State {
  failed: boolean;
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Portal arayüz hatası:', error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="fatal-error">
        <div className="fatal-error__icon"><AlertTriangle size={24} /></div>
        <h1>Sayfa yüklenemedi</h1>
        <p>Beklenmeyen bir arayüz hatası oluştu. Sayfayı yenileyerek tekrar deneyin.</p>
        <button type="button" onClick={() => window.location.reload()}>
          <RefreshCw size={16} />
          Sayfayı Yenile
        </button>
      </main>
    );
  }
}
