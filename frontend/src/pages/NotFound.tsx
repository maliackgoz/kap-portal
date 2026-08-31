import { ArrowLeft, FileQuestion } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <section className="empty-page">
      <FileQuestion size={28} />
      <h1>Sayfa bulunamadı</h1>
      <p>Aradığınız sayfa taşınmış veya artık kullanılmıyor olabilir.</p>
      <button type="button" onClick={() => navigate('/')}>
        <ArrowLeft size={16} />
        Ana Panele Dön
      </button>
    </section>
  );
}
