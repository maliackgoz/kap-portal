import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DataSet } from 'vis-data';
import { Network } from 'vis-network';
import type { IdType } from 'vis-network';
import {
  ArrowDownToLine,
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  CircleDot,
  ExternalLink,
  Filter,
  Focus,
  GitBranch,
  Layers3,
  Maximize2,
  Minimize2,
  Minus,
  Network as NetworkIcon,
  Newspaper,
  Plus,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  User,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  api,
  type Company,
  type GraphData,
  type GraphEdge,
  type GraphNode,
  type GraphRelationship,
  type GraphRelationshipSummary,
  type GraphStats,
} from '../api';
import { useMemberCompanies } from '../hooks/useMemberCompanies';
import { useAuth } from '../context/useAuth';
import './ownership-graph.css';

type CompanyOption = Pick<Company, 'id' | 'name' | 'status' | 'ticker' | 'oid' | 'last_processed_at'>;
type CompanyStatusFilter = 'all' | 'done' | 'pending' | 'error' | 'no_data';
type GraphMode = 'focus' | 'network';
type Notice = { tone: 'info' | 'success' | 'error'; text: string };

const EDGE_META: Record<GraphEdge['type'], { label: string; color: string }> = {
  OWNS_DIRECTLY: { label: 'Doğrudan ortak', color: '#0033A0' },
  OWNS_INDIRECTLY: { label: 'Dolaylı ortak', color: '#6d5bd0' },
  HAS_SUBSIDIARY: { label: 'Bağlı ortaklık', color: '#b1760f' },
};

const COMPANY_STATUS: Record<string, string> = {
  done: 'Graf hazır',
  pending: 'KAP verisi bekliyor',
  processing: 'İşleniyor',
  error: 'Son çekim hatalı',
  no_data: 'KAP verisi yok',
};

const STATUS_FILTERS: { value: CompanyStatusFilter; label: string }[] = [
  { value: 'all', label: 'Tümü' },
  { value: 'done', label: 'Çekildi' },
  { value: 'pending', label: 'Bekliyor' },
  { value: 'error', label: 'Hata' },
  { value: 'no_data', label: 'Veri Yok' },
];

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleUpperCase('tr-TR')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactLabel(value: string, max = 32) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function parseRatio(value?: string) {
  if (!value) return null;
  const parsed = Number(value.replace('%', '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function ratioLabel(value?: string) {
  if (!value) return '-';
  return `%${value.replace('%', '')}`;
}

function edgeDetail(edge: GraphEdge) {
  return [
    edge.oran_pct ? ratioLabel(edge.oran_pct) : null,
    edge.oy_hakki_pct ? `Oy ${ratioLabel(edge.oy_hakki_pct)}` : null,
    edge.pay_tl ? `${edge.pay_tl} TL` : null,
  ].filter(Boolean).join(' · ');
}

function nodeTypeLabel(node: GraphNode) {
  if (node.type === 'company') return 'KAP şirketi';
  if (node.type === 'shareholder') return 'Kuruluş';
  return 'Kişi';
}

function buildLevels(graph: GraphData, rootId: string) {
  const levels = new Map<string, number>([[rootId, 0]]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const level = levels.get(current) || 0;
    for (const edge of graph.edges) {
      if (edge.target === current && !levels.has(edge.source)) {
        levels.set(edge.source, level - 1);
        queue.push(edge.source);
      }
      if (edge.source === current && !levels.has(edge.target)) {
        levels.set(edge.target, level + 1);
        queue.push(edge.target);
      }
    }
  }
  // vis-network'un hiyerarsik layout'u "ya hic node'da level olmali ya da hepsinde"
  // seklinde katı bir kural uyguluyor. rootId'den BFS ile erisilemeyen (kopuk bilesen)
  // node'lar olursa level'sız kalip bu kurali bozuyor ve Network olusturma aninda
  // "levels have to be defined for all nodes" hatasiyla tum sayfayi cokertiyordu.
  // Erisilemeyen node'lari da 0. seviyeye sabitleyerek her node'un bir level'i olmasini
  // garantiliyoruz.
  for (const node of graph.nodes) {
    if (!levels.has(node.id)) levels.set(node.id, 0);
  }
  const min = Math.min(0, ...levels.values());
  return new Map(Array.from(levels, ([id, level]) => [id, level - min]));
}

function mergeGraphs(graphs: GraphData[]): GraphData {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  for (const graph of graphs) {
    for (const node of graph.nodes) nodes.set(node.id, node);
    for (const edge of graph.edges) {
      edges.set(`${edge.source}|${edge.target}|${edge.type}`, edge);
    }
  }
  return { nodes: Array.from(nodes.values()), edges: Array.from(edges.values()) };
}

function IconButton({ title, onClick, disabled, children }: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button className="og-icon-button" type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function CountMetric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="og-count-metric">
      <span className="og-count-dot" style={{ background: tone }} />
      <span>{label}</span>
      <strong>{value.toLocaleString('tr-TR')}</strong>
    </div>
  );
}

function RelationshipList({ title, items, empty, onSelect }: {
  title: string;
  items: GraphRelationship[];
  empty: string;
  onSelect: (node: GraphNode) => void;
}) {
  return (
    <section className="og-relation-group">
      <div className="og-relation-heading">
        <span>{title}</span>
        <strong>{items.length.toLocaleString('tr-TR')}</strong>
      </div>
      {items.length === 0 ? (
        <div className="og-relation-empty">{empty}</div>
      ) : (
        <div className="og-relation-list">
          {items.map(({ node, edge }) => (
            <button key={`${node.id}-${edge.type}`} type="button" className="og-relation-row" onClick={() => onSelect(node)}>
              <span className={`og-node-mark is-${node.type}`} />
              <span className="og-relation-name" title={node.label}>{node.label}</span>
              <span className="og-relation-ratio">{ratioLabel(edge.oran_pct)}</span>
              <ArrowRight size={13} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export default function OwnershipGraph() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canvasRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);

  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([]);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [summary, setSummary] = useState<GraphRelationshipSummary | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [mode, setMode] = useState<GraphMode>('focus');
  const [depth, setDepth] = useState(2);
  const [loading, setLoading] = useState(false);
  const [kapRefreshing, setKapRefreshing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [membersOnly, setMembersOnly] = useState(false);
  const [companyListOpen, setCompanyListOpen] = useState(true);
  const [companyListQuery, setCompanyListQuery] = useState('');
  const [companyListStatusFilter, setCompanyListStatusFilter] = useState<CompanyStatusFilter>('all');
  const [memberPanelOpen, setMemberPanelOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pathOpen, setPathOpen] = useState(false);
  const [pathFrom, setPathFrom] = useState('');
  const [pathTo, setPathTo] = useState('');

  const [showDirect, setShowDirect] = useState(true);
  const [showIndirect, setShowIndirect] = useState(true);
  const [showSubsidiaries, setShowSubsidiaries] = useState(true);
  const [minRatio, setMinRatio] = useState(0);

  const { memberIds, members, error: memberError, addMember, removeMember } = useMemberCompanies(allCompanies);

  const selectedCompany = useMemo(
    () => allCompanies.find(company => company.id === selectedCompanyId) || null,
    [allCompanies, selectedCompanyId],
  );
  const memberIdSet = useMemo(() => new Set(memberIds), [memberIds]);
  const graphReadyMembers = useMemo(() => members.filter(member => member.status === 'done'), [members]);

  const companyPool = useMemo(
    () => membersOnly ? members : allCompanies,
    [allCompanies, members, membersOnly],
  );
  const searchResults = useMemo(() => {
    const key = normalize(query);
    if (key.length < 2 || selectedCompany?.name === query) return [];
    return companyPool
      .filter(company => normalize(company.name).includes(key))
      .sort((a, b) => {
        const aStart = normalize(a.name).startsWith(key) ? 0 : 1;
        const bStart = normalize(b.name).startsWith(key) ? 0 : 1;
        return aStart - bStart || a.name.localeCompare(b.name, 'tr');
      })
      .slice(0, 18);
  }, [companyPool, query, selectedCompany]);

  const companyListResults = useMemo(() => {
    const term = normalize(companyListQuery);
    return companyPool
      .filter(company => companyListStatusFilter === 'all' || company.status === companyListStatusFilter)
      .filter(company => (
        !term
        || normalize(company.name).includes(term)
        || normalize(company.ticker || '').includes(term)
        || normalize(company.oid || '').includes(term)
      ))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }, [companyPool, companyListQuery, companyListStatusFilter]);

  const memberSearchResults = useMemo(() => {
    const key = normalize(memberQuery);
    if (key.length < 2) return [];
    return allCompanies
      .filter(company => !memberIdSet.has(company.id) && normalize(company.name).includes(key))
      .slice(0, 12);
  }, [allCompanies, memberIdSet, memberQuery]);

  const filteredGraph = useMemo<GraphData | null>(() => {
    if (!graph) return null;
    const edges = graph.edges.filter(edge => {
      if (edge.type === 'OWNS_DIRECTLY' && !showDirect) return false;
      if (edge.type === 'OWNS_INDIRECTLY' && !showIndirect) return false;
      if (edge.type === 'HAS_SUBSIDIARY' && !showSubsidiaries) return false;
      const ratio = parseRatio(edge.oran_pct);
      return minRatio === 0 || ratio === null || ratio >= minRatio;
    });
    const used = new Set<string>();
    for (const edge of edges) {
      used.add(edge.source);
      used.add(edge.target);
    }
    if (selectedCompanyId) used.add(`company_${selectedCompanyId}`);
    return {
      edges,
      nodes: graph.nodes.filter(node => used.has(node.id)),
    };
  }, [graph, minRatio, selectedCompanyId, showDirect, showIndirect, showSubsidiaries]);

  const selectedNodeCompany = useMemo(() => {
    if (!selectedNode) return null;
    if (selectedNode.company_id) {
      return allCompanies.find(company => company.id === selectedNode.company_id) || null;
    }
    const key = normalize(selectedNode.label);
    return allCompanies.find(company => normalize(company.name) === key) || null;
  }, [allCompanies, selectedNode]);

  const selectedNodeRelations = useMemo<GraphRelationship[]>(() => {
    if (!selectedNode || !filteredGraph) return [];
    const lookup = new Map(filteredGraph.nodes.map(node => [node.id, node]));
    return filteredGraph.edges.flatMap(edge => {
      if (edge.source !== selectedNode.id && edge.target !== selectedNode.id) return [];
      const otherId = edge.source === selectedNode.id ? edge.target : edge.source;
      const node = lookup.get(otherId);
      return node ? [{ node, edge }] : [];
    });
  }, [filteredGraph, selectedNode]);

  const loadCompanyGraph = useCallback(async (company: CompanyOption, requestedDepth = depth) => {
    setLoading(true);
    setNotice(null);
    setSelectedCompanyId(company.id);
    setQuery(company.name);
    setMode('focus');
    setSearchOpen(false);
    setSearchParams({ company_id: String(company.id) });
    try {
      const [nextGraph, nextSummary, nextStats] = await Promise.all([
        api.getGraphData(company.id, requestedDepth),
        api.getGraphRelationshipSummary(company.id),
        api.getGraphStats(),
      ]);
      setGraph(nextGraph);
      setSummary(nextSummary);
      setStats(nextStats);
      setSelectedNode(nextSummary.root);
      if (nextGraph.edges.length === 0) {
        setNotice({ tone: 'info', text: 'Bu şirket için henüz ortaklık bağlantısı bulunmuyor.' });
      }
    } catch (error) {
      setGraph(null);
      setSummary(null);
      setSelectedNode(null);
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Ortaklık grafiği yüklenemedi.' });
    } finally {
      setLoading(false);
    }
  }, [depth, setSearchParams]);

  useEffect(() => {
    let active = true;
    Promise.all([api.getAllCompanies(), api.getGraphStats()])
      .then(([companies, nextStats]) => {
        if (!active) return;
        setAllCompanies(companies);
        setStats(nextStats);
      })
      .catch(error => {
        if (active) setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Portal verileri alınamadı.' });
      });
    return () => { active = false; };
  }, []);

  // URL'deki company_id'yi tek seferlik "senkronize edildi" olarak isaretliyoruz.
  // Onceden bu karsilastirma dogrudan `selectedCompanyId` state'ine bakiyordu; ama
  // Tam ag/Uye grubu/Yol bulma gibi akislar `setSelectedCompanyId(null)` ile
  // `setSearchParams({})`'i AYNI ANDA cagirdiginda (router'in kendi state guncellemesi
  // ayri bir render turunda isleniyor), bu effect araya girip searchParams'taki ESKI
  // company_id'yi hala goruyor + selectedCompanyId'nin null oldugunu goruyor ve
  // tekrar loadCompanyGraph tetikliyordu — bu da mode'u "focus"a geri dondurup
  // artik cok daha buyuk/kopuk bir graph uzerinde hiyerarsik layout'u zorlayarak
  // sayfayi cokertiyordu (bkz. buildLevels). lastSyncedIdRef, ayni id'yi zaten
  // isledigimizi bildigi icin bu yarisa girmiyor.
  const lastSyncedIdRef = useRef<number | null>(null);
  useEffect(() => {
    const raw = Number(searchParams.get('company_id') || searchParams.get('id'));
    if (!raw || allCompanies.length === 0 || lastSyncedIdRef.current === raw) return;
    lastSyncedIdRef.current = raw;
    const company = allCompanies.find(item => item.id === raw);
    if (company) void loadCompanyGraph(company);
  }, [allCompanies, loadCompanyGraph, searchParams]);

  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [fullscreen]);

  useEffect(() => {
    if (!canvasRef.current || !filteredGraph || filteredGraph.nodes.length === 0) {
      networkRef.current?.destroy();
      networkRef.current = null;
      return;
    }

    networkRef.current?.destroy();
    const rootId = selectedCompanyId ? `company_${selectedCompanyId}` : '';
    const focusLayout = mode === 'focus' && Boolean(rootId);
    const levels = focusLayout ? buildLevels(filteredGraph, rootId) : new Map<string, number>();
    const directOwnerIds = new Set(summary?.directOwners.map(item => item.node.id) || []);
    const indirectOwnerIds = new Set(summary?.indirectOwners.map(item => item.node.id) || []);
    const subsidiaryIds = new Set(summary?.subsidiaries.map(item => item.node.id) || []);
    const nodeLookup = new Map(filteredGraph.nodes.map(node => [node.id, node]));

    const visNodes = new DataSet(filteredGraph.nodes.map(node => {
      const isRoot = node.id === rootId;
      const isOwner = directOwnerIds.has(node.id) || indirectOwnerIds.has(node.id);
      const isSubsidiary = subsidiaryIds.has(node.id);
      let background = node.type === 'person' ? '#16835d' : node.type === 'shareholder' ? '#6f7d8c' : '#2f6acb';
      let border = node.type === 'person' ? '#0f6848' : node.type === 'shareholder' ? '#4f5c68' : '#0033A0';
      if (isOwner) {
        background = node.type === 'person' ? '#16835d' : '#12756b';
        border = node.type === 'person' ? '#0f6848' : '#0a554d';
      }
      if (isSubsidiary) {
        background = '#b1760f';
        border = '#875807';
      }
      if (isRoot) {
        background = '#0033A0';
        border = '#001f61';
      }

      return {
        id: node.id,
        label: compactLabel(node.label, isRoot ? 42 : 30),
        title: `${node.label}${node.sector ? `\nSektör: ${node.sector}` : ''}${node.sermaye ? `\nÖdenmiş sermaye: ${node.sermaye}` : ''}`,
        level: levels.get(node.id),
        shape: isRoot ? 'box' : node.type === 'person' ? 'triangle' : node.type === 'shareholder' ? 'diamond' : 'dot',
        size: isRoot ? 28 : Math.min(23, 12 + Math.sqrt(node.connectionCount || 1) * 2),
        margin: isRoot ? { top: 13, right: 16, bottom: 13, left: 16 } : undefined,
        color: {
          background,
          border,
          highlight: { background, border: '#0b1220' },
          hover: { background, border: '#0b1220' },
        },
        font: {
          color: isRoot ? '#ffffff' : '#17202a',
          size: isRoot ? 13 : 11,
          face: 'Segoe UI, Arial, sans-serif',
          bold: isRoot ? { color: '#ffffff', size: 13, face: 'Segoe UI, Arial, sans-serif' } : undefined,
          vadjust: isRoot ? 0 : 2,
        },
        borderWidth: isRoot ? 3 : 2,
        shadow: isRoot ? { enabled: true, color: 'rgba(0,51,160,.22)', size: 12, x: 0, y: 4 } : false,
      };
    }));

    // Bir dugume cok sayida kenar baglaniyorsa (ör. 16 bagli ortakligi olan bir
    // banka), her kenarin ustundeki oran etiketi ayni dar alanda ust uste
    // biniyor ve okunmuyordu. Bu "kalabalik" dugumlere bagli kenarlarda sabit
    // etiketi gizliyoruz; oran bilgisi hover tooltip'inde (title) ve sag
    // paneldeki iliski listesinde zaten eksiksiz duruyor.
    const CROWDED_DEGREE_THRESHOLD = 8;
    const edgeDegree = new Map<string, number>();
    for (const edge of filteredGraph.edges) {
      edgeDegree.set(edge.source, (edgeDegree.get(edge.source) || 0) + 1);
      edgeDegree.set(edge.target, (edgeDegree.get(edge.target) || 0) + 1);
    }

    const visEdges = new DataSet(filteredGraph.edges.map((edge, index) => {
      const meta = EDGE_META[edge.type];
      const ratio = parseRatio(edge.oran_pct);
      const isCrowded = (edgeDegree.get(edge.source) || 0) > CROWDED_DEGREE_THRESHOLD
        || (edgeDegree.get(edge.target) || 0) > CROWDED_DEGREE_THRESHOLD;
      return {
        id: `edge-${index}`,
        from: edge.source,
        to: edge.target,
        arrows: { to: { enabled: true, scaleFactor: 0.68 } },
        label: !isCrowded && edge.oran_pct ? ratioLabel(edge.oran_pct) : undefined,
        title: `${meta.label}${edgeDetail(edge) ? `\n${edgeDetail(edge)}` : ''}`,
        color: { color: meta.color, highlight: meta.color, hover: meta.color, opacity: 0.78 },
        width: ratio === null ? 1.5 : Math.max(1.5, Math.min(5, ratio / 22)),
        dashes: edge.type === 'OWNS_INDIRECTLY' ? [8, 6] : false,
        font: {
          color: '#394657',
          size: 10,
          face: 'Cascadia Mono, Consolas, monospace',
          strokeWidth: 4,
          strokeColor: '#ffffff',
          align: 'middle',
        },
        smooth: focusLayout
          ? { enabled: true, type: 'cubicBezier', forceDirection: 'vertical', roundness: 0.42 }
          : { enabled: true, type: 'continuous', roundness: 0.2 },
      };
    }));

    const network = new Network(canvasRef.current, { nodes: visNodes, edges: visEdges }, {
      autoResize: true,
      layout: focusLayout ? {
        hierarchical: {
          enabled: true,
          direction: 'UD',
          sortMethod: 'directed',
          levelSeparation: 170,
          nodeSpacing: 210,
          treeSpacing: 240,
          blockShifting: true,
          edgeMinimization: true,
          parentCentralization: true,
        },
      } : { improvedLayout: filteredGraph.nodes.length < 500 },
      physics: focusLayout ? false : {
        enabled: true,
        solver: 'forceAtlas2Based',
        forceAtlas2Based: {
          gravitationalConstant: -58,
          centralGravity: 0.018,
          springLength: 135,
          springConstant: 0.025,
          damping: 0.5,
        },
        stabilization: { enabled: true, iterations: 220, fit: true },
      },
      interaction: {
        hover: true,
        tooltipDelay: 180,
        zoomView: true,
        dragView: true,
        dragNodes: !focusLayout,
        multiselect: false,
      },
      nodes: { chosen: true },
      edges: { selectionWidth: 2, hoverWidth: 1.5 },
    });

    network.on('click', raw => {
      const params = raw as { nodes: IdType[] };
      if (!params.nodes.length) return;
      const node = nodeLookup.get(String(params.nodes[0]));
      if (node) setSelectedNode(node);
    });
    network.on('doubleClick', raw => {
      const params = raw as { nodes: IdType[] };
      if (!params.nodes.length) return;
      const node = nodeLookup.get(String(params.nodes[0]));
      const company = node?.company_id
        ? allCompanies.find(item => item.id === node.company_id)
        : allCompanies.find(item => normalize(item.name) === normalize(node?.label || ''));
      // Cift tiklama artik sayfadan ayrilip Sirket Detayi'na gitmek yerine, o
      // sirketin grafina dogrudan gecis yapiyor — kullanicinin "grafta
      // gezinirken baska bir sirketin grafina dogrudan gidebilmek" talebi.
      // Detay sayfasina gitmek icin inceleme panelindeki "Detay" butonu duruyor.
      if (company && company.id !== selectedCompanyId) void loadCompanyGraph(company);
    });
    network.once('afterDrawing', () => {
      window.setTimeout(() => {
        network.fit({ animation: { duration: 420, easingFunction: 'easeInOutQuad' }, maxZoomLevel: 1.05 });
        if (rootId && nodeLookup.has(rootId)) network.selectNodes([rootId]);
      }, 40);
    });
    networkRef.current = network;
    return () => {
      network.destroy();
      if (networkRef.current === network) networkRef.current = null;
    };
  }, [allCompanies, filteredGraph, loadCompanyGraph, mode, selectedCompanyId, summary]);

  const selectFromCompanyList = useCallback((company: CompanyOption) => {
    void loadCompanyGraph(company);
    setCompanyListOpen(false);
  }, [loadCompanyGraph]);

  const focusNode = useCallback((node: GraphNode) => {
    setSelectedNode(node);
    networkRef.current?.selectNodes([node.id], true);
    networkRef.current?.focus(node.id, {
      scale: Math.max(0.8, networkRef.current.getScale()),
      animation: { duration: 360, easingFunction: 'easeInOutQuad' },
    });
  }, []);

  async function refreshSelectedCompany() {
    if (!selectedCompany) return;
    setKapRefreshing(true);
    setNotice({ tone: 'info', text: 'KAP verisi alınıyor ve ortaklık ağı güncelleniyor…' });
    try {
      const result = await api.scrapeCompany(selectedCompany.id);
      await api.rebuildGraph();
      const companies = await api.getAllCompanies();
      setAllCompanies(companies);
      const latest = companies.find(company => company.id === selectedCompany.id) || selectedCompany;
      await loadCompanyGraph(latest);
      setNotice(result.status === 'no_data'
        ? { tone: 'info', text: 'KAP yeni profil verisi döndürmedi; mevcut ortaklık ağı korunuyor.' }
        : { tone: 'success', text: `${result.keys || 0} KAP alanı ve ortaklık ağı güncellendi.` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'KAP verisi yenilenemedi.' });
    } finally {
      setKapRefreshing(false);
    }
  }

  async function rebuildGraph() {
    setRebuilding(true);
    setNotice({ tone: 'info', text: 'Ortaklık ağı veritabanından yeniden oluşturuluyor…' });
    try {
      const result = await api.rebuildGraph();
      setStats(await api.getGraphStats());
      if (selectedCompany) await loadCompanyGraph(selectedCompany);
      setNotice({
        tone: 'success',
        text: `Ağ yeniden oluşturuldu: ${result.nodes.toLocaleString('tr-TR')} düğüm, ${result.edges.toLocaleString('tr-TR')} bağlantı.`,
      });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Ağ yeniden oluşturulamadı.' });
    } finally {
      setRebuilding(false);
    }
  }

  async function loadFullGraph() {
    setLoading(true);
    setNotice(null);
    try {
      const data = await api.getGraphData();
      setGraph(data);
      setSummary(null);
      setSelectedCompanyId(null);
      setSelectedNode(null);
      setMode('network');
      setQuery('');
      setSearchParams({});
      setNotice({ tone: 'info', text: `Tam ağ: ${data.nodes.length.toLocaleString('tr-TR')} düğüm ve ${data.edges.length.toLocaleString('tr-TR')} bağlantı.` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Tam ağ yüklenemedi.' });
    } finally {
      setLoading(false);
    }
  }

  async function loadMemberGroup(ids: number[], label: string) {
    const valid = Array.from(new Set(ids)).filter(id => graphReadyMembers.some(member => member.id === id));
    if (valid.length === 0) {
      setNotice({ tone: 'info', text: 'Grafiği hazır seçili üye bulunmuyor.' });
      return;
    }
    setLoading(true);
    try {
      const graphs = await Promise.all(valid.map(id => api.getGraphData(id, depth)));
      const merged = mergeGraphs(graphs);
      setGraph(merged);
      setSummary(null);
      setSelectedCompanyId(null);
      setSelectedNode(null);
      setMode('network');
      setQuery('');
      setSearchParams({});
      setNotice({ tone: 'success', text: `${label}: ${valid.length} şirket ve ${merged.edges.length} bağlantı gösteriliyor.` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Üye grafiği yüklenemedi.' });
    } finally {
      setLoading(false);
    }
  }

  async function findPath() {
    if (!pathFrom || !pathTo || pathFrom === pathTo) return;
    setLoading(true);
    try {
      const result = await api.getGraphPath(`company_${pathFrom}`, `company_${pathTo}`);
      if (!result.path.length) {
        setNotice({ tone: 'info', text: 'Seçilen şirketler arasında kayıtlı bağlantı bulunamadı.' });
        return;
      }
      const full = await api.getGraphData();
      const ids = new Set(result.path);
      const edgeKeys = new Set(result.edges.map(edge => `${edge.source}|${edge.target}|${edge.type}`));
      const pathGraph = {
        nodes: full.nodes.filter(node => ids.has(node.id)),
        edges: full.edges.filter(edge => edgeKeys.has(`${edge.source}|${edge.target}|${edge.type}`)),
      };
      setGraph(pathGraph);
      setSummary(null);
      setSelectedCompanyId(null);
      setSelectedNode(pathGraph.nodes[0] || null);
      setMode('network');
      setNotice({ tone: 'success', text: `${result.path.length - 1} adımda bağlantı bulundu.` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Bağlantı yolu bulunamadı.' });
    } finally {
      setLoading(false);
    }
  }

  const directCount = summary?.directOwners.length || 0;
  const indirectCount = summary?.indirectOwners.length || 0;
  const subsidiaryCount = summary?.subsidiaries.length || 0;
  const selectedRelationTitle = selectedNode?.id === summary?.root?.id ? 'Birinci derece bağlantılar' : 'Seçili düğüm bağlantıları';

  return (
    <div className="ownership-page">
      <header className="og-page-header">
        <div>
          <div className="og-eyebrow"><GitBranch size={14} /> KAP ortaklık verisi</div>
          <h1>Ortaklık Ağı</h1>
          <p>{selectedCompany ? selectedCompany.name : 'Şirket sahipliği ve bağlı ortaklık görünümü'}</p>
        </div>
        <div className="og-header-actions">
          <button className="og-button is-secondary" type="button" onClick={() => void loadFullGraph()} disabled={loading}>
            <NetworkIcon size={15} /> Tam ağ
          </button>
          {isAdmin && (
            <>
              <button className="og-button is-secondary" type="button" onClick={() => void rebuildGraph()} disabled={rebuilding}>
                <RefreshCw size={15} className={rebuilding ? 'is-spinning' : ''} />
                {rebuilding ? 'Oluşturuluyor' : 'Ağı oluştur'}
              </button>
              <button className="og-button is-primary" type="button" onClick={() => void refreshSelectedCompany()} disabled={!selectedCompany || kapRefreshing}>
                <RefreshCw size={15} className={kapRefreshing ? 'is-spinning' : ''} />
                {kapRefreshing ? 'KAP işleniyor' : "KAP'tan yenile"}
              </button>
            </>
          )}
        </div>
      </header>

      <section className="og-command-bar">
        <div className="og-search-wrap">
          <Search size={16} />
          <input
            value={query}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => window.setTimeout(() => setSearchOpen(false), 130)}
            onChange={event => {
              setQuery(event.target.value);
              setSearchOpen(true);
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' && searchResults[0]) void loadCompanyGraph(searchResults[0]);
            }}
            placeholder="Şirket adıyla arayın"
            aria-label="Şirket ara"
          />
          {query && (
            <button type="button" aria-label="Aramayı temizle" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
          {searchOpen && searchResults.length > 0 && (
            <div className="og-search-results">
              {searchResults.map(company => (
                <button key={company.id} type="button" onMouseDown={event => event.preventDefault()} onClick={() => void loadCompanyGraph(company)}>
                  <span>{company.name}</span>
                  <small className={`is-${company.status}`}>{COMPANY_STATUS[company.status] || company.status}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="og-segmented" aria-label="Graf görünümü">
          <button type="button" className={mode === 'focus' ? 'is-active' : ''} onClick={() => setMode('focus')} disabled={!selectedCompanyId}>
            <Focus size={14} /> Odak
          </button>
          <button type="button" className={mode === 'network' ? 'is-active' : ''} onClick={() => setMode('network')}>
            <NetworkIcon size={14} /> Ağ
          </button>
        </div>

        <div className="og-depth-control">
          <span>Derinlik</span>
          {[1, 2, 3].map(value => (
            <button
              key={value}
              type="button"
              className={depth === value ? 'is-active' : ''}
              onClick={() => {
                setDepth(value);
                if (selectedCompany) void loadCompanyGraph(selectedCompany, value);
              }}
            >
              {value}
            </button>
          ))}
        </div>

        <button className={`og-button is-toggle ${membersOnly ? 'is-active' : ''}`} type="button" onClick={() => setMembersOnly(value => !value)}>
          <Star size={14} /> Yalnız üyeler
        </button>
      </section>

      <section className="og-collapsible">
        <button type="button" className="og-collapsible-head" onClick={() => setCompanyListOpen(value => !value)} aria-expanded={companyListOpen}>
          <span><Building2 size={15} /> Şirket Listesi <small>{companyPool.length.toLocaleString('tr-TR')}</small></span>
          <ChevronDown size={15} className={companyListOpen ? 'is-open' : ''} />
        </button>
        {companyListOpen && (
          <div className="og-company-list-body">
            <div className="og-member-search">
              <Search size={14} />
              <input
                value={companyListQuery}
                onChange={event => setCompanyListQuery(event.target.value)}
                autoFocus
                placeholder="Şirket adı, ticker veya KAP kodu ile arayın"
              />
            </div>

            <div className="og-status-filters">
              {STATUS_FILTERS.map(filter => (
                <button
                  key={filter.value}
                  type="button"
                  className={companyListStatusFilter === filter.value ? 'is-active' : ''}
                  onClick={() => setCompanyListStatusFilter(filter.value)}
                >
                  {filter.label}
                </button>
              ))}
              <span className="og-status-filters-count">{companyListResults.length.toLocaleString('tr-TR')} şirket</span>
            </div>

            <div className="og-select-list">
              {companyListResults.length === 0 ? (
                <div className="og-empty-inline">Eşleşen şirket yok.</div>
              ) : companyListResults.slice(0, 200).map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={`og-select-row ${selectedCompanyId === item.id ? 'is-active' : ''}`}
                  onClick={() => selectFromCompanyList(item)}
                >
                  <span className="og-select-row-name">{item.name}{item.ticker ? ` (${item.ticker})` : ''}</span>
                  <span className="og-select-row-meta">
                    <span>{item.last_processed_at ? new Date(item.last_processed_at).toLocaleDateString('tr-TR') : '-'}</span>
                    <small className={`is-${item.status}`}>{COMPANY_STATUS[item.status] || item.status}</small>
                  </span>
                </button>
              ))}
              {companyListResults.length > 200 && (
                <div className="og-select-list-notice">İlk 200 sonuç gösteriliyor, daraltmak için arayın.</div>
              )}
            </div>
          </div>
        )}
      </section>

      {notice && (
        <div className={`og-notice is-${notice.tone}`}>
          <CircleDot size={14} />
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Bildirimi kapat"><X size={13} /></button>
        </div>
      )}

      {selectedCompany && summary && (
        <section className="og-company-strip">
          <div className="og-company-identity">
            <span className="og-company-icon"><Building2 size={18} /></span>
            <div>
              <strong>{selectedCompany.name}</strong>
              <span>
                {summary.root?.sector || 'Sektör bilgisi yok'}
                {summary.root?.sermaye ? ` · ${summary.root.sermaye} TL ödenmiş sermaye` : ''}
              </span>
            </div>
          </div>
          <div className="og-company-metrics">
            <CountMetric label="Doğrudan ortak" value={directCount} tone="#0033A0" />
            <CountMetric label="Dolaylı ortak" value={indirectCount} tone="#6d5bd0" />
            <CountMetric label="Bağlı ortaklık" value={subsidiaryCount} tone="#b1760f" />
            <CountMetric label="Kişi" value={summary.personCount} tone="#16835d" />
          </div>
          <div className="og-quick-links">
            <IconButton title="Şirket detayına git" onClick={() => navigate(`/company?id=${selectedCompany.id}`)}><Building2 size={15} /></IconButton>
            <IconButton title="Rating kayıtlarını aç" onClick={() => navigate(`/ratings?company=${encodeURIComponent(selectedCompany.name)}`)}><ShieldCheck size={15} /></IconButton>
            <IconButton title="Haberleri aç" onClick={() => navigate(`/news?q=${encodeURIComponent(selectedCompany.name)}`)}><Newspaper size={15} /></IconButton>
            {isAdmin && (
              <IconButton title={memberIdSet.has(selectedCompany.id) ? 'Üyelerden çıkar' : 'Üyelere ekle'} onClick={() => memberIdSet.has(selectedCompany.id) ? removeMember(selectedCompany.id) : addMember(selectedCompany.id)}>
                {memberIdSet.has(selectedCompany.id) ? <Star size={15} fill="currentColor" /> : <Plus size={15} />}
              </IconButton>
            )}
          </div>
        </section>
      )}

      <section className="og-collapsible">
        <button type="button" className="og-collapsible-head" onClick={() => setMemberPanelOpen(value => !value)} aria-expanded={memberPanelOpen}>
          <span><Star size={15} /> Üye şirketler <small>{members.length.toLocaleString('tr-TR')}</small></span>
          <ChevronDown size={15} className={memberPanelOpen ? 'is-open' : ''} />
        </button>
        {memberPanelOpen && (
          <div className="og-member-body">
            <div className="og-member-toolbar">
              {isAdmin && <div className="og-member-search">
                <Search size={14} />
                <input value={memberQuery} onChange={event => setMemberQuery(event.target.value)} placeholder="Üye eklenecek şirketi arayın" />
                {memberSearchResults.length > 0 && (
                  <div className="og-member-results">
                    {memberSearchResults.map(company => (
                      <button key={company.id} type="button" onClick={() => { addMember(company.id); setMemberQuery(''); }}>
                        <span>{company.name}</span><Plus size={13} />
                      </button>
                    ))}
                  </div>
                )}
              </div>}
              <button className="og-button is-secondary" type="button" onClick={() => void loadMemberGroup(selectedMemberIds, 'Seçili üyeler')} disabled={!selectedMemberIds.length}>
                <Layers3 size={14} /> Seçilileri göster
              </button>
              <button className="og-button is-secondary" type="button" onClick={() => void loadMemberGroup(graphReadyMembers.map(member => member.id), 'Üye portföyü')} disabled={!graphReadyMembers.length}>
                <NetworkIcon size={14} /> Tüm üyeler
              </button>
            </div>
            {memberError && <div className="og-inline-error">{memberError}</div>}
            <div className="og-member-list">
              {members.length === 0 ? (
                <div className="og-empty-inline">Henüz üye şirket eklenmedi.</div>
              ) : members.map(member => {
                const selected = selectedMemberIds.includes(member.id);
                return (
                  <div className={`og-member-item ${selected ? 'is-selected' : ''}`} key={member.id}>
                    <button
                      type="button"
                      className="og-member-check"
                      onClick={() => setSelectedMemberIds(current => selected ? current.filter(id => id !== member.id) : [...current, member.id])}
                      aria-pressed={selected}
                    >
                      <span>{selected && <Check size={11} />}</span>
                      <strong title={member.name}>{member.name}</strong>
                    </button>
                    <small className={`is-${member.status}`}>{COMPANY_STATUS[member.status] || member.status}</small>
                    <IconButton title="Bu şirketin grafiğini aç" onClick={() => void loadCompanyGraph(member)} disabled={member.status !== 'done'}><GitBranch size={13} /></IconButton>
                    {isAdmin && <IconButton title="Üyelerden çıkar" onClick={() => removeMember(member.id)}><Trash2 size={13} /></IconButton>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className={`og-workspace ${fullscreen ? 'is-fullscreen' : ''}`}>
        <div className="og-canvas-shell">
          <div className="og-canvas-toolbar">
            <div className="og-legend">
              <span><i className="is-owner" /> Ortak</span>
              <span><i className="is-company" /> KAP şirketi</span>
              <span><i className="is-subsidiary" /> Bağlı ortaklık</span>
              <span><i className="is-shareholder" /> Kuruluş</span>
              <span><i className="is-person" /> Kişi</span>
            </div>
            <div className="og-canvas-status">
              {filteredGraph ? `${filteredGraph.nodes.length} düğüm · ${filteredGraph.edges.length} bağlantı` : 'Şirket seçilmedi'}
            </div>
          </div>

          <div className="og-canvas" ref={canvasRef} />

          {loading && (
            <div className="og-canvas-overlay">
              <RefreshCw size={22} className="is-spinning" />
              <strong>Ortaklık ağı hazırlanıyor</strong>
            </div>
          )}
          {!loading && (!filteredGraph || filteredGraph.nodes.length === 0) && (
            <div className="og-canvas-overlay is-empty">
              <span><GitBranch size={25} /></span>
              <strong>Bir şirket seçin</strong>
              <p>Ortaklar ve bağlı ortaklıklar burada görüntülenir.</p>
            </div>
          )}

          <div className="og-map-controls">
            <IconButton title="Yakınlaştır" onClick={() => networkRef.current?.moveTo({ scale: networkRef.current.getScale() * 1.25 })}><ZoomIn size={15} /></IconButton>
            <IconButton title="Uzaklaştır" onClick={() => networkRef.current?.moveTo({ scale: networkRef.current.getScale() / 1.25 })}><ZoomOut size={15} /></IconButton>
            <IconButton title="Tüm grafiği sığdır" onClick={() => networkRef.current?.fit({ animation: true, maxZoomLevel: 1.05 })}><Focus size={15} /></IconButton>
            <IconButton title={fullscreen ? 'Tam ekrandan çık' : 'Tam ekran'} onClick={() => setFullscreen(value => !value)}>
              {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </IconButton>
          </div>
        </div>

        <aside className="og-inspector">
          {selectedNode ? (
            <>
              <div className="og-inspector-head">
                <span className={`og-inspector-icon is-${selectedNode.type}`}>
                  {selectedNode.type === 'company' ? <Building2 size={17} /> : selectedNode.type === 'shareholder' ? <Users size={17} /> : <User size={17} />}
                </span>
                <div>
                  <small>{nodeTypeLabel(selectedNode)}</small>
                  <h2>{selectedNode.label}</h2>
                </div>
              </div>

              <div className="og-node-facts">
                {selectedNode.sector && <div><span>Sektör</span><strong>{selectedNode.sector}</strong></div>}
                {selectedNode.sermaye && <div><span>Ödenmiş sermaye</span><strong>{selectedNode.sermaye} TL</strong></div>}
                <div><span>Bağlantı</span><strong>{selectedNodeRelations.length.toLocaleString('tr-TR')}</strong></div>
              </div>

              {selectedNodeCompany && (
                <div className="og-inspector-actions">
                  <button type="button" onClick={() => navigate(`/company?id=${selectedNodeCompany.id}`)}><Building2 size={14} /> Detay</button>
                  <button type="button" onClick={() => void loadCompanyGraph(selectedNodeCompany)}><Focus size={14} /> Odağa al</button>
                  <button type="button" onClick={() => navigate(`/ratings?company=${encodeURIComponent(selectedNodeCompany.name)}`)}><ShieldCheck size={14} /> Rating</button>
                </div>
              )}

              <div className="og-inspector-section-title">{selectedRelationTitle}</div>
              {selectedNode.id === summary?.root?.id && summary ? (
                <div className="og-summary-relations">
                  <RelationshipList title="Doğrudan ortaklar" items={summary.directOwners} empty="Doğrudan ortak kaydı yok" onSelect={focusNode} />
                  {summary.indirectOwners.length > 0 && <RelationshipList title="Dolaylı ortaklar" items={summary.indirectOwners} empty="" onSelect={focusNode} />}
                  <RelationshipList title="Bağlı ortaklıklar" items={summary.subsidiaries} empty="Bağlı ortaklık kaydı yok" onSelect={focusNode} />
                </div>
              ) : (
                <div className="og-relation-list">
                  {selectedNodeRelations.length === 0 ? <div className="og-relation-empty">Bağlantı bulunamadı</div> : selectedNodeRelations.map(({ node, edge }) => (
                    <button key={`${node.id}-${edge.type}`} type="button" className="og-relation-row" onClick={() => focusNode(node)}>
                      <span className="og-edge-swatch" style={{ background: EDGE_META[edge.type].color }} />
                      <span className="og-relation-name">
                        <strong>{node.label}</strong>
                        <small>{EDGE_META[edge.type].label}</small>
                      </span>
                      <span className="og-relation-ratio">{ratioLabel(edge.oran_pct)}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="og-inspector-empty">
              <CircleDot size={22} />
              <strong>Düğüm seçin</strong>
              <p>İlişki ayrıntıları burada açılır.</p>
            </div>
          )}
        </aside>
      </section>

      <section className="og-bottom-tools">
        <div className="og-collapsible">
          <button type="button" className="og-collapsible-head" onClick={() => setAdvancedOpen(value => !value)} aria-expanded={advancedOpen}>
            <span><Filter size={15} /> Görünüm filtreleri</span>
            <ChevronDown size={15} className={advancedOpen ? 'is-open' : ''} />
          </button>
          {advancedOpen && (
            <div className="og-filter-body">
              {[
                { label: 'Doğrudan ortak', active: showDirect, color: '#0033A0', action: () => setShowDirect(value => !value) },
                { label: 'Dolaylı ortak', active: showIndirect, color: '#6d5bd0', action: () => setShowIndirect(value => !value) },
                { label: 'Bağlı ortaklık', active: showSubsidiaries, color: '#b1760f', action: () => setShowSubsidiaries(value => !value) },
              ].map(item => (
                <button key={item.label} type="button" className={item.active ? 'is-active' : ''} onClick={item.action} style={{ '--filter-color': item.color } as React.CSSProperties}>
                  <span>{item.active ? <Check size={11} /> : <Minus size={11} />}</span>{item.label}
                </button>
              ))}
              <label>
                <span>Asgari pay oranı</span>
                <select value={minRatio} onChange={event => setMinRatio(Number(event.target.value))}>
                  {[0, 1, 5, 10, 25, 50].map(value => <option key={value} value={value}>{value === 0 ? 'Tümü' : `%${value}+`}</option>)}
                </select>
              </label>
            </div>
          )}
        </div>

        <div className="og-collapsible">
          <button type="button" className="og-collapsible-head" onClick={() => setPathOpen(value => !value)} aria-expanded={pathOpen}>
            <span><Route size={15} /> Şirketler arası bağlantı yolu</span>
            <ChevronDown size={15} className={pathOpen ? 'is-open' : ''} />
          </button>
          {pathOpen && (
            <div className="og-path-body">
              <select value={pathFrom} onChange={event => setPathFrom(event.target.value)} aria-label="Başlangıç şirketi">
                <option value="">Başlangıç şirketi</option>
                {allCompanies.filter(company => company.status === 'done').map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
              <ArrowDownToLine size={16} />
              <select value={pathTo} onChange={event => setPathTo(event.target.value)} aria-label="Hedef şirket">
                <option value="">Hedef şirket</option>
                {allCompanies.filter(company => company.status === 'done' && String(company.id) !== pathFrom).map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
              <button className="og-button is-primary" type="button" onClick={() => void findPath()} disabled={!pathFrom || !pathTo || pathFrom === pathTo}>
                <Route size={14} /> Yolu göster
              </button>
            </div>
          )}
        </div>
      </section>

      {stats && (
        <footer className="og-stats-footer">
          <span><GitBranch size={13} /> Portal ağı</span>
          <strong>{stats.totalNodes.toLocaleString('tr-TR')}</strong> düğüm
          <strong>{stats.totalEdges.toLocaleString('tr-TR')}</strong> bağlantı
          <span className="og-stat-divider" />
          <span>{stats.companyNodes.toLocaleString('tr-TR')} KAP şirketi</span>
          <span>{stats.shareholderNodes.toLocaleString('tr-TR')} kuruluş</span>
          <span>{stats.personNodes.toLocaleString('tr-TR')} kişi</span>
          <a href="https://www.kap.org.tr/tr/sirket-bilgileri/genel" target="_blank" rel="noreferrer">
            KAP kaynağı <ExternalLink size={12} />
          </a>
        </footer>
      )}
    </div>
  );
}
