import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Company } from '../api';
import { RefreshCw, Search, ChevronDown, Clock, CheckCircle, XCircle, AlertTriangle, Filter, GitBranch, ShieldCheck, Newspaper, Users, Star, Plus, X, ExternalLink } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMemberCompanies } from '../hooks/useMemberCompanies';
import { useAuth } from '../context/useAuth';

const SECTION_LABELS: Record<string, string> = {
  acc1: 'İletişim Bilgileri',
  acc2: 'Faaliyet Alanı ve Denetim',
  acc3: 'Pazar, Endeks ve SPK',
  acc4: 'Tescil ve Vergi',
  acc5: 'Sermaye ve Ortaklık',
  acc6: 'Yönetim',
  acc7: 'Bağlı Ortaklıklar',
  acc8: 'SPK Bilgileri',
  acc9: 'Denetim Bilgileri',
  acc10: 'Diğer Hususlar',
};

const KEY_LABELS: Record<string, string> = {
  kpy41_acc5_odenmis_sermaye: 'Ödenmiş Sermaye',
  kpy41_acc5_kayitli_sermaye_tavani: 'Kayıtlı Sermaye Tavanı',
  kpy41_acc5_sermayede_dogrudan: '%5+ Doğrudan Pay Sahipleri',
  kpy41_acc5_fiili_dolasimdaki_pay: 'Fiili Dolaşımdaki Paylar',
  kpy41_acc5_sermayeyi_temsil_eden: 'Sermayeyi Temsil Eden Paylar',
  kpy41_acc5_son_durum_sermayeye: 'Dolaylı Pay Sahipleri',
  kpy41_acc5_ortaklik_yapisi: 'Ortaklık Yapısı',
  kpy41_acc5_odenmis_sermaye_2: 'Ödenmiş Sermaye',
  kpy41_acc5_kayitli_sermaye_tavani_2: 'Kayıtlı Sermaye Tavanı',
  kpy41_acc5_sermayeyi_temsil_eden_2: 'Sermayeyi Temsil Eden Paylar',
  kpy41_acc1_merkez_adresi: 'Merkez Adresi',
  kpy41_acc1_int_addres: 'İnternet Adresi',
  kpy41_acc1_ilet_email: 'E-Posta',
  kpy41_acc1_ilet_adres_tel_fax: 'Adres / Tel / Faks',
  kpy41_acc1_yatirimci_iliskileri: 'Yatırımcı İlişkileri',
  kpy41_acc2_faaliyet_konu: 'Faaliyet Konusu',
  kpy41_acc2_bdk: 'Bağımsız Denetim Kuruluşu',
  kpy41_acc2_sektor: 'Sektör',
  kpy41_acc2_sure: 'Şirket Süresi',
  kpy41_acc3_sermaye_arac_pazar: 'İşlem Gördüğü Pazar',
  kpy41_acc3_endeksler: 'Endeksler',
  kpy41_acc4_tescil_tarihi: 'Tescil Tarihi',
  kpy41_acc4_ticaret_sicil_numarasi: 'Ticaret Sicil Numarası',
  kpy41_acc4_vergi_dairesi: 'Vergi Dairesi',
  kpy41_acc4_vergi_no: 'Vergi Numarası',
  kpy41_acc6_sorumlu_ortaklar: 'Sorumlu Ortaklar',
  kpy41_acc6_yonetim_kurulu_uyeleri: 'Yönetim Kurulu Üyeleri',
  kpy41_acc6_yonetim_kurulu_uyeleri_2: 'Yönetim Kurulu Üyeleri',
  kpy41_acc7_bagli_ortakliklar: 'Bağlı Ortaklıklar',
  kpy41_acc8_spk_liste_giris: 'SPK Liste Giriş Tarihi',
  kpy41_acc9_son_durum_denetledigi_kap: 'KAP Kapsamında Denetlenen Şirketler',
  kpy41_acc10_diger_hususlar: 'Diğer Hususlar',
};

function getSection(key: string): string {
  const m = key.match(/acc(\d+)/);
  return m ? `acc${m[1]}` : 'other';
}

const COLUMN_LABELS: Record<string, string> = {
  shareholder: 'Ortak',
  shareholderName: 'Ortak',
  shareInCapital: 'Sermayedeki Pay',
  capitalShare: 'Sermayedeki Pay',
  ratioInCapital: 'Sermaye Oranı',
  capitalRatio: 'Sermaye Oranı',
  votingRightRatio: 'Oy Hakkı Oranı',
  votingRightsRatio: 'Oy Hakkı Oranı',
  title: 'Unvan',
  name: 'Ad',
  surname: 'Soyad',
  task: 'Görev',
  position: 'Görev',
  profession: 'Meslek',
  company: 'Şirket',
  sector: 'Sektör',
  country: 'Ülke',
  address: 'Adres',
  phone: 'Telefon',
  fax: 'Faks',
  email: 'E-Posta',
  webAddress: 'İnternet Adresi',
  startDate: 'Başlangıç Tarihi',
  endDate: 'Bitiş Tarihi',
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string; icon: LucideIcon; label: string }> = {
    done: { color: 'var(--green)', bg: 'var(--green-bg)', icon: CheckCircle, label: 'İşlendi' },
    error: { color: 'var(--red)', bg: 'var(--red-bg)', icon: XCircle, label: 'Hata' },
    pending: { color: 'var(--amber)', bg: 'var(--amber-bg)', icon: Clock, label: 'Bekliyor' },
    no_data: { color: 'var(--text-muted)', bg: 'var(--bg-surface-2)', icon: AlertTriangle, label: 'Veri Yok' },
    processing: { color: 'var(--blue)', bg: 'var(--blue-bg)', icon: RefreshCw, label: 'İşleniyor' },
  };
  const s = map[status] || map.pending;
  const Icon = s.icon;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, color: s.color, background: s.bg }}>
      <Icon size={13} /> {s.label}
    </span>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getCellText(value: unknown): string {
  if (isRecord(value) && typeof value.text === 'string') return value.text;
  return String(value ?? '-');
}

function decodeHtmlEntities(value: string): string {
  if (typeof document === 'undefined') return value;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

function cleanValue(value: unknown): string {
  let text = getCellText(value);
  for (let i = 0; i < 2; i += 1) {
    const decoded = decodeHtmlEntities(text);
    if (decoded === text) break;
    text = decoded;
  }

  const cleaned = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/<\/?[a-z][^<>\n\r]*$/gi, ' ')
    .replace(/\bstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^;\s>]*)/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || '-';
}

function firstValue(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') return data[key];
  }
  return null;
}

function compactValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return `${value.length.toLocaleString('tr-TR')} kayıt`;
  const text = cleanValue(value);
  return text.length > 72 ? `${text.slice(0, 72)}...` : text;
}

function arrayCount(value: unknown, suffix: string) {
  return Array.isArray(value) ? `${value.length.toLocaleString('tr-TR')} ${suffix}` : compactValue(value);
}

function parsePct(value: unknown) {
  const number = Number(String(value ?? '').replace('%', '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : -1;
}

function ownerName(record: Record<string, unknown>) {
  return String(record.shareholder || record.shareholderName || record.title || record.name || '');
}

function normalizedText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTotalOwner(record: Record<string, unknown>) {
  const name = normalizedText(ownerName(record));
  return name === 'TOPLAM' || name === 'TOTAL';
}

function isOtherOwner(record: Record<string, unknown>) {
  const name = normalizedText(ownerName(record));
  return name === 'DIGER' || name === 'DIGER ORTAKLAR' || name === 'OTHER' || name === 'OTHERS';
}

function ownerCountText(value: unknown) {
  if (!Array.isArray(value)) return compactValue(value);
  const records = value.filter(isRecord).filter(record => !isTotalOwner(record) && !isOtherOwner(record));
  return `${records.length.toLocaleString('tr-TR')} ortak`;
}

function topOwnerText(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return compactValue(value);
  const records = value.filter(isRecord).filter(record => {
    if (isTotalOwner(record)) return false;
    return !isOtherOwner(record);
  });
  if (!records.length) return `${value.length.toLocaleString('tr-TR')} kayıt`;
  const sorted = [...records].sort((a, b) => parsePct(b.ratioInCapital || b.votingRightRatio) - parsePct(a.ratioInCapital || a.votingRightRatio));
  const top = sorted[0];
  const name = compactValue(ownerName(top));
  const ratio = compactValue(top.ratioInCapital || top.votingRightRatio);
  return ratio !== '-' ? `${name} - %${ratio.replace('%', '')}` : name;
}

function amountText(value: unknown) {
  const text = compactValue(value);
  if (text === '-') return text;
  return /[a-zA-Z]/.test(text) ? text : `${text} TL`;
}

function publicFloatText(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return compactValue(value);
  const row = value.find(isRecord);
  if (!row) return compactValue(value);
  const ratio = compactValue(row.actualOutstandingSharesRatio || row.ratio || row.rate);
  const shares = compactValue(row.actualSharesOutstanding || row.share || row.nominalValue);
  if (ratio !== '-' && shares !== '-') return `%${ratio.replace('%', '')} - ${shares} pay`;
  if (ratio !== '-') return `%${ratio.replace('%', '')}`;
  return shares;
}

type DirectOwnerRow = {
  name: string;
  share: string;
  capitalRatio: string;
  votingRatio: string;
};

function ratioText(value: unknown) {
  const text = compactValue(value);
  return text === '-' ? text : `%${text.replace('%', '')}`;
}

function ownerShareText(record: Record<string, unknown>) {
  return compactValue(record.shareInCapital || record.capitalShare || record.share || record.nominalValue || record.amount);
}

function ownerCapitalRatioText(record: Record<string, unknown>) {
  return ratioText(record.ratioInCapital || record.capitalRatio || record.ratio || record.rate);
}

function ownerVotingRatioText(record: Record<string, unknown>) {
  return ratioText(record.votingRightRatio || record.voteRatio || record.votingRatio || record.votingRightsRatio);
}

function toDirectOwnerRow(record: Record<string, unknown>): DirectOwnerRow {
  return {
    name: cleanValue(ownerName(record)) || '-',
    share: ownerShareText(record),
    capitalRatio: ownerCapitalRatioText(record),
    votingRatio: ownerVotingRatioText(record),
  };
}

function directOwnerRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .filter(record => ownerName(record) && !isTotalOwner(record) && !isOtherOwner(record))
    .sort((a, b) => parsePct(b.ratioInCapital || b.capitalRatio || b.votingRightRatio) - parsePct(a.ratioInCapital || a.capitalRatio || a.votingRightRatio))
    .map(toDirectOwnerRow);
}

function otherOwnerRow(value: unknown) {
  if (!Array.isArray(value)) return null;
  const row = value.filter(isRecord).find(isOtherOwner);
  return row ? toDirectOwnerRow(row) : null;
}

function DataTable({ data }: { data: Record<string, unknown>[] }) {
  if (!data || data.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Veri yok</span>;
  const keys = Object.keys(data[0]).filter(k => !k.startsWith('disable') && !k.startsWith('hide'));
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--bg-surface-2)' }}>
            {keys.map(k => (
              <th key={k} style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                {COLUMN_LABELS[k] || fieldLabel(k)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
              {keys.map(k => (
                <td key={k} style={{ padding: '8px 12px', fontFamily: typeof row[k] === 'number' || /^\d/.test(String(row[k] || '')) ? 'var(--font-mono)' : 'inherit', fontSize: 13 }}>
                  {cleanValue(row[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fieldLabel(key: string) {
  return KEY_LABELS[key]
    || key
      .replace(/^kpy\d+_acc\d+_/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, letter => letter.toLocaleUpperCase('tr-TR'));
}

function StructuredValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (Array.isArray(value)) {
    const records = value.filter(isRecord);
    if (records.length === value.length) return <DataTable data={records} />;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {value.map((item, index) => (
          <span key={index} style={{
            padding: '5px 8px', borderRadius: 6, background: 'var(--bg-surface-2)',
            border: '1px solid var(--border)', color: 'var(--text-dim)', fontSize: 12,
          }}>
            {cleanValue(item)}
          </span>
        ))}
      </div>
    );
  }

  if (isRecord(value)) {
    if (typeof value.text === 'string') {
      return <span style={{ color: 'var(--blue)', fontWeight: 700 }}>{cleanValue(value)}</span>;
    }
    const entries = Object.entries(value).filter(([key]) => !key.startsWith('disable') && !key.startsWith('hide'));
    if (!entries.length) return <span style={{ color: 'var(--text-muted)' }}>-</span>;
    return (
      <div style={{
        borderTop: depth ? '1px solid var(--border)' : undefined,
        display: 'grid',
      }}>
        {entries.map(([key, item]) => (
          <div key={key} style={{
            display: 'grid', gridTemplateColumns: 'minmax(150px, 0.35fr) minmax(0, 1fr)',
            gap: 14, padding: '9px 0', borderBottom: '1px solid var(--border)',
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 750 }}>
              {fieldLabel(key)}
            </div>
            <div style={{ color: 'var(--text)', fontSize: 13, minWidth: 0 }}>
              <StructuredValue value={item} depth={depth + 1} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return <span style={{ color: 'var(--blue)', fontWeight: 700 }}>{cleanValue(value)}</span>;
}

export default function CompanyDetail() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scraping, setScraping] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [membersOnly, setMembersOnly] = useState(false);
  const [memberAddQuery, setMemberAddQuery] = useState('');
  const [memberAddOpen, setMemberAddOpen] = useState(false);
  const [memberPanelOpen, setMemberPanelOpen] = useState(false);
  const [companySelectOpen, setCompanySelectOpen] = useState(true);
  const [companySelectQuery, setCompanySelectQuery] = useState('');
  const [companyStatusFilter, setCompanyStatusFilter] = useState<'all' | 'done' | 'pending' | 'error' | 'no_data'>('all');
  const [scrapeNotice, setScrapeNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null);
  const { memberIds, members, error: memberError, addMember, removeMember } = useMemberCompanies(companies);

  // Load company list once
  useEffect(() => {
    api.getAllCompanies().then(setCompanies);
  }, []);

  useEffect(() => {
    const rawId = searchParams.get('id') || searchParams.get('company_id');
    const routeId = rawId ? Number(rawId) : null;
    if (!routeId || !Number.isFinite(routeId) || selectedId === routeId) return;
    setSelectedId(routeId);
    setActiveFilter('all');
    setCompanySelectOpen(false);
  }, [searchParams, selectedId]);

  useEffect(() => {
    setExpandedSections({});
  }, [selectedId]);

  // Load company data when selected
  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    setLoadError(null);
    Promise.all([api.getCompany(selectedId), api.getCompanyData(selectedId)])
      .then(([c, d]) => { setCompany(c); setData(d); })
      .catch(err => {
        setCompany(null);
        setData(null);
        setLoadError(err instanceof Error ? err.message : 'Şirket verisi alınamadı');
      })
      .finally(() => setLoading(false));
  }, [selectedId]);

  const selectCompany = (id: number | null) => {
    setSelectedId(id);
    setActiveFilter('all');
    setExpandedSections({});
    if (id) {
      setSearchParams({ id: String(id) });
      setCompanySelectOpen(false);
    } else {
      setSearchParams({});
      setCompany(null);
      setData(null);
    }
  };

  const handleScrape = async () => {
    if (!selectedId) return;
    setScraping(true);
    setScrapeNotice(null);
    try {
      const result = await api.scrapeCompany(selectedId);
      const [c, d] = await Promise.all([api.getCompany(selectedId), api.getCompanyData(selectedId)]);
      setCompany(c);
      setData(d);
      setCompanies(current => current.map(item => item.id === c.id ? { ...item, ...c } : item));
      if (result.status === 'no_data') {
        setScrapeNotice({
          tone: 'warning',
          message: 'KAP bu şirket için yeni profil verisi döndürmedi. Mevcut kayıtlar korunuyor.',
        });
      } else {
        setScrapeNotice({
          tone: 'success',
          message: `${(result.keys || Object.keys(d).length).toLocaleString('tr-TR')} KAP alanı, şirket profili ve ortaklık ağı güncellendi.`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Veri güncellenemedi';
      setScrapeNotice({ tone: 'error', message });
    } finally {
      setScraping(false);
    }
  };

  const selectorCompanies = useMemo(() => membersOnly ? members : companies, [companies, members, membersOnly]);
  const selectedIsMember = selectedId ? memberIds.includes(selectedId) : false;
  const selectedCompanyListItem = selectedId ? companies.find(c => c.id === selectedId) || null : null;

  // Tek liste: arama + durum filtresi bir arada. "Çekilmiş şirketler" artik
  // ayri bir panel degil, bu listede "Çekildi" filtresine tikliyor.
  const STATUS_FILTERS: { value: typeof companyStatusFilter; label: string }[] = [
    { value: 'all', label: 'Tümü' },
    { value: 'done', label: 'Çekildi' },
    { value: 'pending', label: 'Bekliyor' },
    { value: 'error', label: 'Hata' },
    { value: 'no_data', label: 'Veri Yok' },
  ];
  const filteredSelectorCompanies = useMemo(() => {
    const term = normalizedText(companySelectQuery);
    return selectorCompanies
      .filter(c => companyStatusFilter === 'all' || c.status === companyStatusFilter)
      .filter(c => !term || normalizedText(c.name).includes(term) || normalizedText(c.ticker || '').includes(term) || normalizedText(c.oid).includes(term));
  }, [selectorCompanies, companySelectQuery, companyStatusFilter]);

  const memberAddOptions = useMemo(() => {
    const term = normalizedText(memberAddQuery);
    if (term.length < 2) return [];
    return companies
      .filter(c => !memberIds.includes(c.id))
      .filter(c => normalizedText(c.name).includes(term) || normalizedText(c.slug || '').includes(term))
      .slice(0, 16);
  }, [companies, memberAddQuery, memberIds]);

  const addManualMember = (member: Company) => {
    addMember(member.id);
    setMemberAddQuery('');
    setMemberAddOpen(false);
  };

  // Group data by section
  const sections = useMemo(() => {
    if (!data) return {};
    const grouped: Record<string, { key: string; label: string; value: unknown }[]> = {};
    for (const [key, val] of Object.entries(data)) {
      const sec = getSection(key);
      if (!grouped[sec]) grouped[sec] = [];
      grouped[sec].push({ key, label: fieldLabel(key), value: val });
    }
    return grouped;
  }, [data]);

  const sectionKeys = Object.keys(sections);
  const financialSnapshot = useMemo(() => {
    if (!data) return [];
    const paidCapital = firstValue(data, ['kpy41_acc5_odenmis_sermaye', 'kpy41_acc5_odenmis_sermaye_2']);
    const registeredCapital = firstValue(data, ['kpy41_acc5_kayitli_sermaye_tavani', 'kpy41_acc5_kayitli_sermaye_tavani_2']);
    const publicFloat = firstValue(data, ['kpy41_acc5_fiili_dolasimdaki_pay']);
    const directOwners = firstValue(data, ['kpy41_acc5_sermayede_dogrudan', 'kpy41_acc5_ortaklik_yapisi']);
    const subsidiaries = firstValue(data, ['kpy41_acc7_bagli_ortakliklar']);
    const sector = firstValue(data, ['kpy41_acc2_sektor']);
    const market = firstValue(data, ['kpy41_acc3_sermaye_arac_pazar']);

    return [
      { label: 'Ödenmiş Sermaye', value: amountText(paidCapital), tone: 'var(--blue)' },
      { label: 'Kayıtlı Sermaye Tavanı', value: amountText(registeredCapital), tone: 'var(--accent)' },
      { label: 'Fiili Dolaşım', value: publicFloatText(publicFloat), tone: 'var(--green)' },
      { label: 'En Büyük Ortak', value: topOwnerText(directOwners), tone: 'var(--amber)' },
      { label: 'Doğrudan Ortak', value: ownerCountText(directOwners), tone: 'var(--amber)' },
      { label: 'Bağlı Ortaklık', value: arrayCount(subsidiaries, 'kayıt'), tone: 'var(--blue)' },
      { label: 'Sektör / Pazar', value: [compactValue(sector), compactValue(market)].filter(item => item !== '-').join(' / ') || '-', tone: 'var(--text-dim)' },
    ].filter(item => item.value && item.value !== '-');
  }, [data]);

  const directOwnerSource = useMemo(() => {
    if (!data) return null;
    return firstValue(data, ['kpy41_acc5_sermayede_dogrudan', 'kpy41_acc5_ortaklik_yapisi']);
  }, [data]);

  const directOwnerRecords = useMemo(() => directOwnerRows(directOwnerSource), [directOwnerSource]);
  const otherDirectOwner = useMemo(() => otherOwnerRow(directOwnerSource), [directOwnerSource]);
  const directOwnersOpen = Boolean(expandedSections.directOwners);

  const toggleSection = (key: string) => {
    setExpandedSections(current => ({ ...current, [key]: !current[key] }));
  };

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: 0, marginBottom: 6 }}>Şirket Detayı</h1>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>KAP profil alanlarını, sermaye bilgilerini ve ortaklık verilerini şirket bazında inceleyin.</div>
      </div>

      {/* Company Selector */}
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow)',
      }}>
        <div>
          {/* Şirket Seç — arama + liste */}
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0 }}>
                Şirket Seç
                {selectedCompanyListItem && !companySelectOpen && (
                  <span style={{ marginLeft: 8, color: 'var(--accent)', fontWeight: 800, textTransform: 'none' }}>
                    {selectedCompanyListItem.name}
                  </span>
                )}
              </label>
              <button
                type="button"
                onClick={() => setCompanySelectOpen(value => !value)}
                aria-expanded={companySelectOpen}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent',
                  color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0,
                }}
              >
                {companySelectOpen ? 'Kapat' : 'Şirket değiştir'}
                <ChevronDown size={13} style={{ transform: companySelectOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s ease' }} />
              </button>
            </div>

            {companySelectOpen && (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
                  <input
                    value={companySelectQuery}
                    onChange={e => setCompanySelectQuery(e.target.value)}
                    autoFocus
                    placeholder="Şirket adı, ticker veya KAP kodu ile arayın"
                    style={{
                      width: '100%', height: 38, padding: '0 12px 0 34px', borderRadius: 8,
                      border: '1px solid var(--border)', background: 'var(--bg-surface-2)',
                      color: 'var(--text)', outline: 'none', fontSize: 13, fontFamily: 'inherit',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {STATUS_FILTERS.map(filter => (
                    <button
                      key={filter.value}
                      type="button"
                      onClick={() => setCompanyStatusFilter(filter.value)}
                      style={{
                        padding: '5px 11px', borderRadius: 999, border: '1px solid var(--border)',
                        background: companyStatusFilter === filter.value ? 'var(--accent-bg)' : 'var(--bg-surface)',
                        color: companyStatusFilter === filter.value ? 'var(--accent)' : 'var(--text-dim)',
                        fontSize: 11, fontWeight: 800, cursor: 'pointer',
                      }}
                    >
                      {filter.label}
                    </button>
                  ))}
                  <span style={{ alignSelf: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11, marginLeft: 4 }}>
                    {filteredSelectorCompanies.length.toLocaleString('tr-TR')} şirket
                  </span>
                </div>

                <div style={{
                  maxHeight: 340, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8,
                  background: 'var(--bg-surface-2)',
                }}>
                  {filteredSelectorCompanies.length === 0 ? (
                    <div style={{ padding: 14, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
                      Eşleşen şirket yok.
                    </div>
                  ) : filteredSelectorCompanies.slice(0, 200).map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectCompany(item.id)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 12, padding: '9px 12px', border: 'none', borderBottom: '1px solid var(--border)',
                        background: selectedId === item.id ? 'var(--accent-bg)' : 'transparent',
                        color: selectedId === item.id ? 'var(--accent)' : 'var(--text)',
                        cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', textAlign: 'left',
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700, minWidth: 0 }}>
                        {item.name}{item.ticker ? ` (${item.ticker})` : ''}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                        <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                          {item.last_processed_at ? new Date(item.last_processed_at).toLocaleDateString('tr-TR') : '-'}
                        </span>
                        <StatusBadge status={item.status} />
                      </span>
                    </button>
                  ))}
                  {filteredSelectorCompanies.length > 200 && (
                    <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: 11, textAlign: 'center' }}>
                      İlk 200 sonuç gösteriliyor, daraltmak için arayın.
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        </div>

        {scrapeNotice && (
          <div style={{
            marginTop: 12, padding: '10px 12px', borderRadius: 8,
            color: scrapeNotice.tone === 'success' ? 'var(--green)' : scrapeNotice.tone === 'warning' ? 'var(--amber)' : 'var(--red)',
            background: scrapeNotice.tone === 'success' ? 'var(--green-bg)' : scrapeNotice.tone === 'warning' ? 'var(--amber-bg)' : 'var(--red-bg)',
            fontSize: 12, fontWeight: 700,
          }}>
            {scrapeNotice.message}
          </div>
        )}

        <button
          type="button"
          onClick={() => setMemberPanelOpen(value => !value)}
          aria-expanded={memberPanelOpen}
          style={{
            width: '100%', marginTop: 16, padding: '12px 0 0', border: 'none',
            borderTop: '1px solid var(--border)', background: 'transparent',
            color: 'var(--accent)', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: 12, cursor: 'pointer',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 850 }}>
            <Star size={15} /> Üye Portföyü
            <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              {members.length.toLocaleString('tr-TR')} şirket
            </span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--text-muted)', fontSize: 11, fontWeight: 700 }}>
            {memberPanelOpen ? 'Kapat' : 'Yönet'}
            <ChevronDown size={15} style={{ transform: memberPanelOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s ease' }} />
          </span>
        </button>

        <div style={{
          marginTop: memberPanelOpen ? 14 : 0,
          display: memberPanelOpen ? 'grid' : 'none', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Kayıtlı üyeleri filtreleyin veya seçili şirketi portföye ekleyin.</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setMembersOnly(value => !value)}
                style={{
                  height: 32, padding: '0 10px', borderRadius: 8,
                  border: membersOnly ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: membersOnly ? 'var(--accent-bg)' : 'var(--bg-surface-2)',
                  color: membersOnly ? 'var(--accent)' : 'var(--text-dim)',
                  cursor: 'pointer', fontSize: 12, fontWeight: 850,
                }}
              >
                Sadece üyeler
              </button>
              {isAdmin && selectedId && (
                <button
                  type="button"
                  onClick={() => selectedIsMember ? removeMember(selectedId) : addMember(selectedId)}
                  style={{
                    height: 32, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 10px',
                    borderRadius: 8, border: '1px solid var(--border)',
                    background: selectedIsMember ? 'var(--red-bg)' : 'var(--blue-bg)',
                    color: selectedIsMember ? 'var(--red)' : 'var(--blue)',
                    cursor: 'pointer', fontSize: 12, fontWeight: 850,
                  }}
                >
                  {selectedIsMember ? <X size={13} /> : <Plus size={13} />}
                  {selectedIsMember ? 'Üyelerden Çıkar' : 'Üyelere Ekle'}
                </button>
              )}
            </div>
          </div>

          {isAdmin && <div style={{
            display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) auto', gap: 8, alignItems: 'end',
            padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface-2)',
          }}>
            <div style={{ position: 'relative' }}>
              <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 10, fontWeight: 850, textTransform: 'uppercase', letterSpacing: 0, marginBottom: 6 }}>
                Üye şirket ekle
              </label>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 11, top: 10, color: 'var(--text-muted)' }} />
                <input
                  value={memberAddQuery}
                  onFocus={() => setMemberAddOpen(true)}
                  onBlur={() => window.setTimeout(() => setMemberAddOpen(false), 120)}
                  onChange={event => {
                    setMemberAddQuery(event.target.value);
                    setMemberAddOpen(true);
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && memberAddOptions[0]) {
                      event.preventDefault();
                      addManualMember(memberAddOptions[0]);
                    }
                  }}
                  placeholder="Şirket adıyla arayın"
                  style={{
                    width: '100%', height: 34, padding: '0 11px 0 34px',
                    borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)',
                    color: 'var(--text)', outline: 'none', fontSize: 12, fontFamily: 'inherit',
                  }}
                />
              </div>
              {memberAddOpen && memberAddOptions.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 80,
                  marginTop: 4, maxHeight: 240, overflowY: 'auto', background: 'var(--bg-surface)',
                  border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-md)',
                }}>
                  {memberAddOptions.map(option => (
                    <button
                      key={option.id}
                      type="button"
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => addManualMember(option)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 10, padding: '9px 11px', border: 'none', borderBottom: '1px solid var(--border)',
                        background: 'transparent', color: 'var(--text)', cursor: 'pointer',
                        fontSize: 12, fontFamily: 'inherit', textAlign: 'left',
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option.name}</span>
                      <StatusBadge status={option.status} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => memberAddOptions[0] && addManualMember(memberAddOptions[0])}
              disabled={memberAddOptions.length === 0}
              style={{
                height: 34, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 11px',
                borderRadius: 8, border: '1px solid var(--border)',
                background: memberAddOptions.length ? 'var(--blue-bg)' : 'var(--bg-surface)',
                color: memberAddOptions.length ? 'var(--blue)' : 'var(--text-muted)',
                cursor: memberAddOptions.length ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 850,
              }}
            >
              <Plus size={13} /> Üyelere Ekle
            </button>
          </div>}

          {memberError && (
            <div style={{ padding: '9px 11px', borderRadius: 8, background: 'var(--red-bg)', color: 'var(--red)', fontSize: 12, fontWeight: 700 }}>
              {memberError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {members.length === 0 ? (
              <div style={{
                padding: '9px 11px', borderRadius: 8, border: '1px dashed var(--border)',
                background: 'var(--bg-surface-2)', color: 'var(--text-muted)', fontSize: 12,
              }}>
                Henüz üye şirket eklenmedi. Yukarıdaki aramadan şirket seçerek portföyü oluşturun.
              </div>
            ) : members.map(member => (
              <div
                key={member.id}
                style={{
                  display: 'inline-flex', alignItems: 'stretch', overflow: 'hidden',
                  border: `1px solid ${selectedId === member.id ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 8, background: selectedId === member.id ? 'var(--accent-bg)' : 'var(--bg-surface-2)',
                }}
              >
                <button
                  type="button"
                  onClick={() => selectCompany(member.id)}
                  title={member.name}
                  style={{
                    maxWidth: 220, padding: '8px 10px', border: 'none', background: 'transparent',
                    color: selectedId === member.id ? 'var(--accent)' : 'var(--text)',
                    cursor: 'pointer', fontSize: 12, fontWeight: 850, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {member.name}
                </button>
                {isAdmin && <button
                  type="button"
                  onClick={() => removeMember(member.id)}
                  title="Üyelerden çıkar"
                  style={{
                    width: 30, border: 'none', borderLeft: '1px solid var(--border)',
                    background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <X size={13} />
                </button>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Company Info */}
      {loading && <div style={{ color: 'var(--text-muted)', padding: 20 }}>Şirket verileri yükleniyor...</div>}

      {company && !loading && (
        <>
          {/* Header Card */}
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap',
          }}>
            <div style={{ minWidth: 260, flex: '1 1 320px' }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{company.name}</h2>
              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                <span>OID: {company.oid}</span>
                <span>Slug: {company.slug.substring(0, 30)}...</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {isAdmin && (
                <button
                  onClick={handleScrape}
                  disabled={scraping}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
                    background: scraping ? 'var(--bg-surface-3)' : 'var(--accent)',
                    color: scraping ? 'var(--text-dim)' : '#fff',
                    border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700,
                    cursor: scraping ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
                  }}
                >
                  <RefreshCw size={14} style={scraping ? { animation: 'spin 1s linear infinite' } : {}} />
                  {scraping ? 'KAP verisi çekiliyor...' : 'KAP Verisini Yenile'}
                </button>
              )}
              <a
                href={`https://www.kap.org.tr/tr/sirket-bilgileri/genel/${company.slug}`}
                target="_blank"
                rel="noreferrer"
                title="Şirketin KAP sayfasını aç"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text-dim)', textDecoration: 'none', fontWeight: 700, fontSize: 12 }}
              >
                <ExternalLink size={14} /> KAP
              </a>
              <button
                onClick={() => navigate(`/graph?company_id=${company.id}`)}
                title="Ortaklık grafiğini aç"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text-dim)', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
              >
                <GitBranch size={14} /> Graf
              </button>
              <button
                onClick={() => navigate(`/ratings?company=${encodeURIComponent(company.name)}`)}
                title="Rating kayıtlarını aç"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--blue-bg)', color: 'var(--blue)', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
              >
                <ShieldCheck size={14} /> Rating
              </button>
              <button
                onClick={() => navigate(`/news?q=${encodeURIComponent(company.name)}`)}
                title="Haberleri ara"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--accent-bg)', color: 'var(--accent)', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
              >
                <Newspaper size={14} /> Haber
              </button>
              <div style={{ minWidth: 94, textAlign: 'right' }}>
                <StatusBadge status={company.status} />
                {company.last_processed_at && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
                    Son: {new Date(company.last_processed_at).toLocaleString('tr-TR')}
                  </div>
                )}
              </div>
            </div>
          </div>

          {financialSnapshot.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
              {financialSnapshot.map(item => (
                <div key={item.label} style={{
                  background: 'var(--bg-surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '13px 14px', boxShadow: 'var(--shadow)',
                  minWidth: 0,
                }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', marginBottom: 6 }}>
                    {item.label}
                  </div>
                  <div title={item.value} style={{ color: item.tone, fontSize: 14, fontWeight: 850, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {directOwnerRecords.length > 0 && (
            <div style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', marginBottom: 18, overflow: 'hidden', boxShadow: 'var(--shadow)',
            }}>
              <button
                type="button"
                onClick={() => toggleSection('directOwners')}
                aria-expanded={directOwnersOpen}
                style={{
                width: '100%', padding: '14px 20px', border: 'none', borderBottom: directOwnersOpen ? '1px solid var(--border)' : 'none',
                background: 'transparent', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, color: 'var(--accent)' }}>
                  <Users size={15} /> Doğrudan Ortaklar
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {directOwnerRecords.length.toLocaleString('tr-TR')} ortak
                  </span>
                  <span style={{
                    width: 26, height: 26, borderRadius: 7, border: '1px solid var(--border)',
                    background: directOwnersOpen ? 'var(--accent-bg)' : 'var(--bg-surface-2)',
                    color: directOwnersOpen ? 'var(--accent)' : 'var(--text-muted)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <ChevronDown size={14} style={{ transform: directOwnersOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }} />
                  </span>
                </div>
              </button>
              {directOwnersOpen && (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-surface-2)' }}>
                          {['Ortak', 'Sermayedeki Pay', 'Sermaye Oranı', 'Oy Hakkı'].map(label => (
                            <th key={label} style={{ textAlign: 'left', padding: '9px 16px', fontWeight: 800, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {directOwnerRecords.map((owner, index) => (
                          <tr key={`${owner.name}-${index}`} style={{ borderBottom: index === directOwnerRecords.length - 1 ? 'none' : '1px solid var(--border)' }}>
                            <td title={owner.name} style={{ padding: '11px 16px', fontWeight: 800, color: 'var(--text)', minWidth: 260, lineHeight: 1.35 }}>
                              {owner.name}
                            </td>
                            <td style={{ padding: '11px 16px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                              {owner.share}
                            </td>
                            <td style={{ padding: '11px 16px', fontFamily: 'var(--font-mono)', color: 'var(--amber)', fontWeight: 800, whiteSpace: 'nowrap' }}>
                              {owner.capitalRatio}
                            </td>
                            <td style={{ padding: '11px 16px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                              {owner.votingRatio}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {otherDirectOwner && (
                    <div style={{
                      padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-surface-2)',
                      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)',
                    }}>
                      <span style={{ fontWeight: 800, color: 'var(--text-dim)' }}>Diğer paylar</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>Pay: {otherDirectOwner.share}</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>Sermaye: {otherDirectOwner.capitalRatio}</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>Oy hakkı: {otherDirectOwner.votingRatio}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Filter Tabs */}
          {data && Object.keys(data).length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
              <button
                onClick={() => setActiveFilter('all')}
                style={{
                  padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)',
                  background: activeFilter === 'all' ? 'var(--accent-bg)' : 'var(--bg-surface)',
                  color: activeFilter === 'all' ? 'var(--accent)' : 'var(--text-dim)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)',
                }}
              >
                Tümü
              </button>
              {sectionKeys.map(sec => (
                <button key={sec} onClick={() => setActiveFilter(sec)}
                  style={{
                    padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)',
                    background: activeFilter === sec ? 'var(--accent-bg)' : 'var(--bg-surface)',
                    color: activeFilter === sec ? 'var(--accent)' : 'var(--text-dim)',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)',
                  }}
                >
                  {SECTION_LABELS[sec] || sec}
                </button>
              ))}
            </div>
          )}

          {/* Data Sections */}
          {data && Object.keys(data).length > 0 ? (
            (activeFilter === 'all' ? sectionKeys : [activeFilter]).map(sec => {
              const sectionOpen = Boolean(expandedSections[`section:${sec}`]);
              const fieldCount = sections[sec]?.length || 0;
              return (
                <div key={sec} style={{
                  background: 'var(--bg-surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', marginBottom: 16, overflow: 'hidden', boxShadow: 'var(--shadow)',
                }}>
                  <button
                    type="button"
                    onClick={() => toggleSection(`section:${sec}`)}
                    aria-expanded={sectionOpen}
                    style={{
                      width: '100%', padding: '14px 20px', border: 'none',
                      borderBottom: sectionOpen ? '1px solid var(--border)' : 'none',
                      background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                      color: 'var(--accent)', display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between', gap: 12,
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <Filter size={13} /> {SECTION_LABELS[sec] || sec}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {fieldCount.toLocaleString('tr-TR')} alan
                      </span>
                      <span style={{
                        width: 26, height: 26, borderRadius: 7, border: '1px solid var(--border)',
                        background: sectionOpen ? 'var(--accent-bg)' : 'var(--bg-surface-2)',
                        color: sectionOpen ? 'var(--accent)' : 'var(--text-muted)',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <ChevronDown size={14} style={{ transform: sectionOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }} />
                      </span>
                    </span>
                  </button>
                  {sectionOpen && (
                    <div style={{ padding: 20 }}>
                      {sections[sec]?.map(item => (
                        <div key={item.key} style={{ marginBottom: 20 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0 }}>
                            {item.label}
                          </div>
                          <StructuredValue value={item.value} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          ) : company.status !== 'pending' ? (
            <div style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: 40, textAlign: 'center',
              color: 'var(--text-muted)', fontSize: 14,
            }}>
              Bu şirket için henüz KAP verisi yok. "KAP Verisini Yenile" düğmesini kullanın.
            </div>
          ) : null}
        </>
      )}

      {loadError && !loading && (
        <div style={{
          background: 'var(--red-bg)', border: '1px solid color-mix(in srgb, var(--red) 18%, transparent)',
          borderRadius: 'var(--radius)', padding: 16, color: 'var(--red)', fontWeight: 700, marginBottom: 16,
        }}>
          {loadError}
        </div>
      )}

      {!company && !loading && !loadError && (
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: 60, textAlign: 'center',
          color: 'var(--text-muted)', fontSize: 14,
        }}>
          Yukarıdaki seçim alanından bir şirket seçin.
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
