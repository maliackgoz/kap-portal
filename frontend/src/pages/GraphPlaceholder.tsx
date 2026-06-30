import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Company, type GraphData, type GraphEdge, type GraphNode, type GraphStats } from '../api';
import { Network } from 'vis-network';
import type { Color, IdType } from 'vis-network';
import { DataSet } from 'vis-data';
import { RefreshCw, Search, Building2, Users, User, GitBranch, ZoomIn, ZoomOut, Maximize, Minimize, SlidersHorizontal, ShieldCheck, Newspaper, Check, Route, X, ArrowRightLeft, CornerDownRight, Star, Plus } from 'lucide-react';
import { useMemberCompanies } from '../hooks/useMemberCompanies';

type CompanyOption = Pick<Company, 'id' | 'name' | 'status'>;

interface NetworkNodeEvent {
  nodes: IdType[];
}

type PathResultView = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  message: string;
};

type PathCompanyOption = CompanyOption & {
  inGraph: boolean;
};

const NODE_COLORS = {
  company: { background: '#0033A0', border: '#00277a', highlight: { background: '#1d5fd0', border: '#001f61' } },
  shareholder: { background: '#f59e0b', border: '#d97706', highlight: { background: '#fbbf24', border: '#b45309' } },
  person: { background: '#22c55e', border: '#16a34a', highlight: { background: '#4ade80', border: '#15803d' } },
};

const EDGE_COLORS: Record<string, string> = {
  OWNS_DIRECTLY: '#0033A0',
  OWNS_INDIRECTLY: '#6d5bd0',
  HAS_SUBSIDIARY: '#f59e0b',
};

const CLUSTER_COLORS = [
  '#0033A0', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899',
  '#06b6d4', '#f97316', '#14b8a6', '#a855f7', '#6366f1', '#eab308',
  '#84cc16', '#e11d48', '#0ea5e9', '#d946ef', '#10b981', '#f43f5e',
];

function parseSermaye(s?: string): number {
  if (!s) return 0;
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function normalizeCompanyLabel(value: string) {
  const text = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\b(A S|AS|ANONIM|SIRKETI|SIRKET|SANAYI|TICARET|VE|LTD|STI|HOLDING|GRUP)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

function edgeTypeLabel(type: GraphEdge['type']) {
  const labels: Record<GraphEdge['type'], string> = {
    OWNS_DIRECTLY: 'Dogrudan ortak',
    OWNS_INDIRECTLY: 'Dolayli ortak',
    HAS_SUBSIDIARY: 'Bagli ortaklik',
  };
  return labels[type] || type;
}

function edgeDetail(edge: GraphEdge) {
  const parts = [
    edge.oran_pct ? `%${edge.oran_pct.replace('%', '')}` : null,
    edge.oy_hakki_pct ? `Oy: %${edge.oy_hakki_pct.replace('%', '')}` : null,
    edge.pay_tl ? `${edge.pay_tl} TL` : null,
  ].filter(Boolean);
  return parts.join(' | ');
}

function nodeTypeLabel(type: GraphNode['type']) {
  if (type === 'company') return 'Sirket';
  if (type === 'shareholder') return 'Ortak';
  return 'Kisi';
}

function CheckChip({ label, checked, color, onClick }: {
  label: string;
  checked: boolean;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 10px',
        borderRadius: 7, border: `1px solid ${checked ? color + '55' : 'var(--border)'}`,
        background: checked ? `${color}14` : 'var(--bg-surface-2)',
        color: checked ? color : 'var(--text-muted)', cursor: 'pointer',
        fontSize: 12, fontWeight: 800, fontFamily: 'inherit', whiteSpace: 'nowrap',
      }}
    >
      <span style={{
        width: 14, height: 14, borderRadius: 4, border: `1px solid ${checked ? color : 'var(--border)'}`,
        background: checked ? color : 'var(--bg-surface)', color: '#fff',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {checked && <Check size={10} strokeWidth={3} />}
      </span>
      {label}
    </button>
  );
}

function SegmentChip({ label, active, onClick }: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        height: 28, padding: '0 10px', borderRadius: 7,
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'var(--accent-bg)' : 'var(--bg-surface-2)',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        cursor: 'pointer', fontSize: 12, fontWeight: 800, fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 7, alignContent: 'start' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 850, textTransform: 'uppercase', letterSpacing: 0 }}>
        {title}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        {children}
      </div>
    </div>
  );
}

function PathCompanyInput({ label, query, options, selected, placeholder, onQueryChange, onSelect, onClear }: {
  label: string;
  query: string;
  options: PathCompanyOption[];
  selected: boolean;
  placeholder: string;
  onQueryChange: (value: string) => void;
  onSelect: (company: CompanyOption) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative', flex: '1 1 270px', minWidth: 240 }}>
      <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 10, fontWeight: 850, textTransform: 'uppercase', letterSpacing: 0, marginBottom: 6 }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: 11, top: 12, color: 'var(--text-muted)' }} />
        <input
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 130)}
          onChange={event => {
            onQueryChange(event.target.value);
            setOpen(true);
          }}
          onKeyDown={event => {
            if (event.key === 'Enter' && options[0]) {
              event.preventDefault();
              onSelect(options[0]);
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          style={{
            width: '100%', height: 38, padding: selected ? '0 34px 0 34px' : '0 12px 0 34px',
            borderRadius: 8, border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
            background: 'var(--bg-surface-2)', color: 'var(--text)', outline: 'none',
            fontFamily: 'inherit', fontSize: 13,
          }}
        />
        {selected && (
          <button
            type="button"
            onClick={onClear}
            title="Secimi temizle"
            style={{
              position: 'absolute', right: 8, top: 7, width: 24, height: 24,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)',
              color: 'var(--text-muted)', cursor: 'pointer',
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>
      {open && options.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 60,
          marginTop: 4, maxHeight: 260, overflowY: 'auto', background: 'var(--bg-surface)',
          border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-md)',
        }}>
          {options.map(option => (
            <button
              key={option.id}
              type="button"
              onMouseDown={event => event.preventDefault()}
              onClick={() => {
                onSelect(option);
                setOpen(false);
              }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 10, padding: '9px 11px', border: 'none', borderBottom: '1px solid var(--border)',
                background: 'transparent', color: 'var(--text)', cursor: 'pointer',
                fontSize: 12, fontFamily: 'inherit', textAlign: 'left',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option.name}</span>
              {option.inGraph && (
                <span style={{ color: 'var(--green)', background: 'var(--green-bg)', padding: '2px 6px', borderRadius: 6, fontSize: 10, fontWeight: 850, flexShrink: 0 }}>
                  Grafte
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GraphPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const graphShellRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);

  const [stats, setStats] = useState<GraphStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [search, setSearch] = useState('');
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [filteredCompanies, setFilteredCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [kapRefreshing, setKapRefreshing] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [graphInfo, setGraphInfo] = useState<string>('');
  const [graphFullscreen, setGraphFullscreen] = useState(false);
  const [memberMode, setMemberMode] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [memberAddQuery, setMemberAddQuery] = useState('');
  const [memberAddOpen, setMemberAddOpen] = useState(false);
  const { memberIds, members, addMember, removeMember } = useMemberCompanies(allCompanies);

  // Raw data (unfiltered)
  const rawDataRef = useRef<GraphData | null>(null);

  // Filters
  const [showCompanies, setShowCompanies] = useState(true);
  const [showShareholders, setShowShareholders] = useState(true);
  const [showPersons, setShowPersons] = useState(true);
  const [showDirect, setShowDirect] = useState(true);
  const [showIndirect, setShowIndirect] = useState(true);
  const [showSubsidiary, setShowSubsidiary] = useState(true);
  const [minPct, setMinPct] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  // New advanced filters
  const [depth, setDepth] = useState(2);
  const [nodeSizeMode, setNodeSizeMode] = useState<'fixed' | 'sermaye' | 'connection'>('fixed');
  const [edgeThicknessMode, setEdgeThicknessMode] = useState<'fixed' | 'proportional'>('fixed');
  const [sectors, setSectors] = useState<string[]>([]);
  const [selectedSector, setSelectedSector] = useState('');
  const [hideOrphans, setHideOrphans] = useState(true);
  const [clusterColors, setClusterColors] = useState(false);
  const [clusterMap, setClusterMap] = useState<Map<string, number>>(new Map());
  const [showPathFinder, setShowPathFinder] = useState(false);
  const [pathFrom, setPathFrom] = useState('');
  const [pathTo, setPathTo] = useState('');
  const [pathFromQuery, setPathFromQuery] = useState('');
  const [pathToQuery, setPathToQuery] = useState('');
  const [pathOnlyCurrentGraph, setPathOnlyCurrentGraph] = useState(true);
  const [pathMessage, setPathMessage] = useState('');
  const [pathResult, setPathResult] = useState<PathResultView | null>(null);

  // Load companies list for search
  useEffect(() => {
    api.getAllCompanies().then(list => {
      setAllCompanies(list);
      setCompanies(list.filter(c => c.status === 'done'));
    }).catch(err => {
      console.error('Company list load error:', err);
    });
    // Load sectors
    api.getGraphSectors().then(setSectors).catch(err => {
      console.error('Sector list load error:', err);
    });
  }, []);

  const graphMemberCompanies = useMemo(() => members.filter(company => company.status === 'done'), [members]);
  const searchableCompanies = useMemo(
    () => memberMode ? graphMemberCompanies : companies,
    [companies, graphMemberCompanies, memberMode]
  );

  useEffect(() => {
    setSelectedMemberIds(current => current.filter(id => memberIds.includes(id)));
  }, [memberIds]);

  const resizeGraphViewport = useCallback((fit = false) => {
    window.setTimeout(() => {
      const network = networkRef.current;
      if (!network) return;
      network.setSize('100%', '100%');
      network.redraw();
      if (fit) {
        network.fit({ animation: true });
      }
    }, 80);
  }, []);

  useEffect(() => {
    if (!graphFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setGraphFullscreen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    resizeGraphViewport(true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      resizeGraphViewport(true);
    };
  }, [graphFullscreen, resizeGraphViewport]);

  // Filter companies by search
  useEffect(() => {
    if (search.trim().length < 2) {
      setFilteredCompanies([]);
      setShowDropdown(false);
      return;
    }
    const key = normalizeCompanyLabel(search);
    const filtered = searchableCompanies.filter(c => normalizeCompanyLabel(c.name).includes(key)).slice(0, 15);
    setFilteredCompanies(filtered);
    setShowDropdown(filtered.length > 0);
  }, [search, searchableCompanies]);

  const memberAddOptions = useMemo(() => {
    const key = normalizeCompanyLabel(memberAddQuery);
    if (key.length < 2) return [];
    return allCompanies
      .filter(company => !memberIds.includes(company.id))
      .filter(company => normalizeCompanyLabel(company.name).includes(key))
      .slice(0, 16);
  }, [allCompanies, memberAddQuery, memberIds]);

  function resolveNodeCompany(node: GraphNode | null): CompanyOption | null {
    if (!node) return null;
    if (node.company_id) {
      return allCompanies.find(company => company.id === node.company_id) || {
        id: node.company_id,
        name: node.label,
        status: 'done',
      };
    }
    if (node.type !== 'shareholder') return null;
    const nodeKey = normalizeCompanyLabel(node.label);
    if (nodeKey.length < 4) return null;
    return allCompanies.find(company => normalizeCompanyLabel(company.name) === nodeKey) || null;
  }

  const selectedNodeCompany = resolveNodeCompany(selectedNode);

  function companyNodeId(company: CompanyOption) {
    return `company_${company.id}`;
  }

  function currentGraphCompanyIds() {
    const ids = new Set<number>();
    for (const node of rawDataRef.current?.nodes || []) {
      if (node.type !== 'company') continue;
      if (node.company_id) {
        ids.add(node.company_id);
        continue;
      }
      const match = /^company_(\d+)$/.exec(node.id);
      if (match) ids.add(Number(match[1]));
    }
    return ids;
  }

  function getPathCompanyOptions(query: string, excludeNodeId: string): PathCompanyOption[] {
    const graphIds = currentGraphCompanyIds();
    const queryKey = normalizeCompanyLabel(query);
    const base = pathOnlyCurrentGraph && graphIds.size > 0
      ? allCompanies.filter(company => graphIds.has(company.id))
      : allCompanies;

    const matches = base
      .filter(company => companyNodeId(company) !== excludeNodeId)
      .filter(company => {
        if (!queryKey) return true;
        const companyKey = normalizeCompanyLabel(company.name);
        return companyKey.startsWith(queryKey) || companyKey.includes(queryKey);
      })
      .sort((a, b) => {
        const aGraph = graphIds.has(a.id) ? 0 : 1;
        const bGraph = graphIds.has(b.id) ? 0 : 1;
        if (aGraph !== bGraph) return aGraph - bGraph;
        const aStarts = queryKey && normalizeCompanyLabel(a.name).startsWith(queryKey) ? 0 : 1;
        const bStarts = queryKey && normalizeCompanyLabel(b.name).startsWith(queryKey) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.name.localeCompare(b.name, 'tr');
      })
      .slice(0, 18);

    return matches.map(company => ({ ...company, inGraph: graphIds.has(company.id) }));
  }

  function selectPathCompany(side: 'from' | 'to', company: CompanyOption) {
    if (side === 'from') {
      setPathFrom(companyNodeId(company));
      setPathFromQuery(company.name);
    } else {
      setPathTo(companyNodeId(company));
      setPathToQuery(company.name);
    }
    setPathMessage('');
    setPathResult(null);
  }

  function clearPathSelection(side: 'from' | 'to') {
    if (side === 'from') {
      setPathFrom('');
      setPathFromQuery('');
    } else {
      setPathTo('');
      setPathToQuery('');
    }
    setPathMessage('');
    setPathResult(null);
  }

  function resetGraphFilters() {
    setShowCompanies(true);
    setShowShareholders(true);
    setShowPersons(true);
    setShowDirect(true);
    setShowIndirect(true);
    setShowSubsidiary(true);
    setMinPct(0);
    setDepth(2);
    setNodeSizeMode('fixed');
    setEdgeThicknessMode('fixed');
    setSelectedSector('');
    setHideOrphans(true);
    if (clusterColors) {
      setClusterColors(false);
      setClusterMap(new Map());
    }
  }

  function handleSwapPath() {
    const nextFrom = pathTo;
    const nextFromQuery = pathToQuery;
    setPathTo(pathFrom);
    setPathToQuery(pathFromQuery);
    setPathFrom(nextFrom);
    setPathFromQuery(nextFromQuery);
    setPathMessage('');
    setPathResult(null);
  }

  // Apply filters on raw data and re-render
  function applyFilters(raw?: GraphData) {
    const data = raw || rawDataRef.current;
    if (!data) return;

    // Filter edges by type and min percentage
    let edges = data.edges.filter(e => {
      if (e.type === 'OWNS_DIRECTLY' && !showDirect) return false;
      if (e.type === 'OWNS_INDIRECTLY' && !showIndirect) return false;
      if (e.type === 'HAS_SUBSIDIARY' && !showSubsidiary) return false;
      if (minPct > 0 && e.oran_pct) {
        const pct = parseFloat(e.oran_pct.replace(',', '.'));
        if (!isNaN(pct) && pct < minPct) return false;
      }
      return true;
    });

    // Filter nodes by type
    let nodes = data.nodes.filter(n => {
      if (n.type === 'company' && !showCompanies) return false;
      if (n.type === 'shareholder' && !showShareholders) return false;
      if (n.type === 'person' && !showPersons) return false;
      return true;
    });

    // Sector filter: keep companies in sector + all their connected nodes
    if (selectedSector) {
      const sectorNodeIds = new Set<string>();
      nodes.forEach(n => {
        if (n.sector === selectedSector) sectorNodeIds.add(n.id);
      });
      // Also include nodes connected to sector nodes
      const connectedIds = new Set<string>(sectorNodeIds);
      edges.forEach(e => {
        if (sectorNodeIds.has(e.source)) connectedIds.add(e.target);
        if (sectorNodeIds.has(e.target)) connectedIds.add(e.source);
      });
      nodes = nodes.filter(n => connectedIds.has(n.id));
    }

    // Remove edges that reference filtered-out nodes
    const nodeIds = new Set(nodes.map(n => n.id));
    edges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

    // Remove orphan nodes (no edges) if toggle is on
    if (hideOrphans) {
      const finalUsed = new Set<string>();
      edges.forEach(e => { finalUsed.add(e.source); finalUsed.add(e.target); });
      nodes = nodes.filter(n => finalUsed.has(n.id));
    }

    renderGraph(nodes, edges);
    setGraphInfo(`${nodes.length} dugum, ${edges.length} kenar (filtrelenmis)`);
  }

  // Load and render graph
  const loadGraph = useCallback(async (companyId?: number | null, overrideDepth?: number) => {
    setLoading(true);
    setSelectedNode(null);
    setPathResult(null);
    try {
      const d = overrideDepth ?? depth;
      const [graphData, statsData] = await Promise.all([
        api.getGraphData(companyId || undefined, companyId ? d : undefined),
        api.getGraphStats(),
      ]);
      setStats(statsData);
      rawDataRef.current = graphData;
      applyFilters(graphData);
      if (companyId) {
        const focusNode = graphData.nodes.find(node => node.company_id === companyId || node.id === `company_${companyId}`);
        if (focusNode) {
          setSelectedNode(focusNode);
          window.setTimeout(() => {
            networkRef.current?.selectNodes([focusNode.id], true);
            networkRef.current?.focus(focusNode.id, {
              scale: 1.05,
              animation: { duration: 450, easingFunction: 'easeInOutQuad' },
            });
          }, 0);
        }
      }
    } catch (err) {
      console.error('Graph load error:', err);
      setGraphInfo('Graf yuklenirken hata olustu: ' + errorMessage(err, 'Bilinmeyen hata'));
    } finally {
      setLoading(false);
    }
  // applyFilters uses the same explicit filter state listed here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCompanies, showShareholders, showPersons, showDirect, showIndirect, showSubsidiary, minPct, depth, selectedSector, hideOrphans]);

  useEffect(() => {
    const rawId = searchParams.get('company_id') || searchParams.get('id');
    const routeId = rawId ? Number(rawId) : null;
    if (!routeId || !Number.isFinite(routeId) || selectedCompanyId === routeId || companies.length === 0) return;
    const company = companies.find(item => item.id === routeId);
    setSelectedCompanyId(routeId);
    if (company) setSearch(company.name);
    void loadGraph(routeId);
  }, [companies, loadGraph, searchParams, selectedCompanyId]);

  // Initial load — stats only
  useEffect(() => {
    api.getGraphStats().then(setStats).catch(err => {
      console.error('Graph stats load error:', err);
    });
  }, []);

  // Re-apply filters when filter state changes
  useEffect(() => {
    if (rawDataRef.current) applyFilters();
  // applyFilters uses the same explicit filter state listed here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCompanies, showShareholders, showPersons, showDirect, showIndirect, showSubsidiary, minPct, selectedSector, hideOrphans, nodeSizeMode, edgeThicknessMode, clusterColors, clusterMap]);

  function renderGraph(graphNodes: GraphNode[], graphEdges: GraphEdge[]) {
    if (!containerRef.current) return;

    // Destroy previous network
    if (networkRef.current) {
      networkRef.current.destroy();
      networkRef.current = null;
    }

    // Keep raw data mapping for click events
    const nodeRawMap = new Map<string, GraphNode>();
    graphNodes.forEach(n => nodeRawMap.set(n.id, n));

    // Compute node sizes based on mode
    function getNodeSize(n: GraphNode): number {
      if (nodeSizeMode === 'sermaye') {
        const val = parseSermaye(n.sermaye);
        if (val <= 0) return 8;
        // Log scale: map to 8-40 range
        const logVal = Math.log10(val + 1);
        return Math.min(40, Math.max(8, logVal * 3));
      }
      if (nodeSizeMode === 'connection') {
        const c = n.connectionCount || 0;
        return Math.min(40, Math.max(8, 8 + c * 2));
      }
      // fixed
      return n.type === 'company' ? 18 : n.type === 'shareholder' ? 14 : 10;
    }

    function getNodeColor(n: GraphNode): Color {
      if (clusterColors && clusterMap.size > 0) {
        const clusterId = clusterMap.get(n.id);
        if (clusterId !== undefined) {
          const c = CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length];
          return { background: c, border: c, highlight: { background: c, border: c } };
        }
      }
      return NODE_COLORS[n.type];
    }

    const visNodes = new DataSet(
      graphNodes.map(n => ({
        id: n.id,
        label: n.label.length > 30 ? n.label.substring(0, 28) + '...' : n.label,
        title: `${n.label}${n.sector ? '\nSektor: ' + n.sector : ''}${n.sermaye ? '\nSermaye: ' + n.sermaye : ''}`,
        color: getNodeColor(n),
        shape: n.type === 'company' ? 'dot' : n.type === 'shareholder' ? 'diamond' : 'triangle',
        size: getNodeSize(n),
        font: { color: '#17202a', size: 10, face: 'Instrument Sans, system-ui, sans-serif' },
      }))
    );

    const visEdges = new DataSet(
      graphEdges.map((e, i) => {
        let width = 1;
        if (edgeThicknessMode === 'proportional' && e.oran_pct) {
          const pct = parseFloat(e.oran_pct.replace(',', '.'));
          if (!isNaN(pct)) {
            width = Math.max(1, Math.min(5, pct / 20));
          }
        }
        return {
          id: `edge_${i}`,
          from: e.source,
          to: e.target,
          label: e.oran_pct ? `%${e.oran_pct}` : undefined,
          arrows: 'to' as const,
          color: {
            color: EDGE_COLORS[e.type] || '#64748b',
            opacity: 0.6,
            highlight: EDGE_COLORS[e.type] || '#64748b',
          },
          font: { color: '#5d6978', size: 9, strokeWidth: 0, align: 'middle' as const },
          smooth: { enabled: true, type: 'curvedCW', roundness: 0.15 },
          width,
        };
      })
    );

    const network = new Network(containerRef.current, { nodes: visNodes, edges: visEdges }, {
      physics: {
        enabled: true,
        solver: 'forceAtlas2Based',
        forceAtlas2Based: {
          gravitationalConstant: -80,
          centralGravity: 0.01,
          springLength: 150,
          springConstant: 0.02,
          damping: 0.4,
        },
        stabilization: {
          enabled: true,
          iterations: 200,
          fit: true,
        },
      },
      interaction: {
        hover: true,
        tooltipDelay: 200,
        zoomView: true,
        dragView: true,
        dragNodes: true,
        navigationButtons: false,
      },
      nodes: {
        borderWidth: 2,
        borderWidthSelected: 3,
      },
      edges: {
        selectionWidth: 2,
      },
      layout: {
        improvedLayout: graphNodes.length < 500,
      },
    });

    network.on('click', (params?: unknown) => {
      const event = params as NetworkNodeEvent | undefined;
      if (event && event.nodes.length > 0) {
        const nodeId = String(event.nodes[0]);
        const rawNode = nodeRawMap.get(nodeId);
        if (rawNode) {
          setSelectedNode(rawNode);
        }
      } else {
        setSelectedNode(null);
      }
    });

    network.on('doubleClick', (params?: unknown) => {
      const event = params as NetworkNodeEvent | undefined;
      if (event && event.nodes.length > 0) {
        const nodeId = String(event.nodes[0]);
        const rawNode = nodeRawMap.get(nodeId);
        const company = resolveNodeCompany(rawNode || null);
        if (company) {
          navigate(`/company?id=${company.id}`);
        }
      }
    });

    networkRef.current = network;
  }

  async function handleRebuild() {
    setRebuilding(true);
    try {
      await api.rebuildGraph();
      const statsData = await api.getGraphStats();
      setStats(statsData);
      if (selectedCompanyId) {
        await loadGraph(selectedCompanyId);
      }
    } catch (err) {
      console.error('Rebuild error:', err);
    } finally {
      setRebuilding(false);
    }
  }

  async function handleRefreshSelectedFromKap() {
    if (!selectedCompanyId) {
      setGraphInfo('Once grafi yenilenecek sirketi sec.');
      return;
    }
    setKapRefreshing(true);
    setGraphInfo('KAP verisi cekiliyor ve graf yeniden isleniyor...');
    try {
      await api.scrapeCompany(selectedCompanyId);
      await api.rebuildGraph();
      const [latestCompanies, statsData] = await Promise.all([
        api.getAllCompanies(),
        api.getGraphStats(),
      ]);
      setAllCompanies(latestCompanies);
      setCompanies(latestCompanies.filter(c => c.status === 'done'));
      setStats(statsData);
      await loadGraph(selectedCompanyId);
      setGraphInfo('KAP verisi guncellendi, grafik yeniden olusturuldu.');
    } catch (err) {
      setGraphInfo('KAP yenileme hatasi: ' + errorMessage(err, 'Veri guncellenemedi'));
    } finally {
      setKapRefreshing(false);
    }
  }

  function handleCompanySelect(company: CompanyOption) {
    setSearch(company.name);
    setSelectedCompanyId(company.id);
    setSearchParams({ company_id: String(company.id) });
    setShowDropdown(false);
    setPathMessage('');
    loadGraph(company.id);
  }

  function handleLoadFull() {
    setSelectedCompanyId(null);
    setSearch('');
    setSearchParams({});
    setPathMessage('');
    loadGraph();
  }

  function toggleSelectedMember(id: number) {
    setSelectedMemberIds(current => current.includes(id)
      ? current.filter(memberId => memberId !== id)
      : [...current, id]
    );
  }

  function addActiveCompanyToMembers() {
    if (!selectedCompanyId) return;
    addMember(selectedCompanyId);
  }

  function addManualMember(company: CompanyOption) {
    addMember(company.id);
    setSelectedMemberIds(current => Array.from(new Set([...current, company.id])));
    setMemberAddQuery('');
    setMemberAddOpen(false);
  }

  async function loadCompanyGroup(companyIds: number[], label: string, emptyMessage: string) {
    const uniqueIds = Array.from(new Set(companyIds.filter(id => Number.isFinite(id) && id > 0)));
    setLoading(true);
    setSelectedNode(null);
    setPathResult(null);
    setPathMessage('');
    try {
      if (uniqueIds.length === 0) {
        setGraphInfo(emptyMessage);
        return;
      }

      const results = await Promise.all(uniqueIds.map(id => api.getGraphData(id, depth)));
      const mergedNodes = new Map<string, GraphNode>();
      const edgeSet = new Set<string>();
      const mergedEdges: GraphEdge[] = [];

      for (const result of results) {
        for (const n of result.nodes) mergedNodes.set(n.id, n);
        for (const e of result.edges) {
          const key = `${e.source}-${e.target}-${e.type}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            mergedEdges.push(e);
          }
        }
      }

      const graphData = { nodes: Array.from(mergedNodes.values()), edges: mergedEdges };
      rawDataRef.current = graphData;
      applyFilters(graphData);
      setSelectedCompanyId(null);
      setSearch('');
      setShowDropdown(false);
      setSearchParams({});
      setGraphInfo(`${label}: ${uniqueIds.length} sirket, ${graphData.nodes.length} dugum, ${graphData.edges.length} kenar`);
    } catch (err) {
      setGraphInfo('Hata: ' + errorMessage(err, `${label} yuklenemedi`));
    } finally {
      setLoading(false);
    }
  }

  async function handleLoadSelectedMembers() {
    const doneIds = new Set(graphMemberCompanies.map(company => company.id));
    await loadCompanyGroup(
      selectedMemberIds.filter(id => doneIds.has(id)),
      'Secili uyeler',
      'Graf icin secili uye yok'
    );
  }

  async function handleLoadAllMembers() {
    await loadCompanyGroup(
      graphMemberCompanies.map(company => company.id),
      'Uye portfoyu',
      'Islenmis uye sirket yok'
    );
  }

  async function handleFindPath() {
    if (!pathFrom || !pathTo) return;
    if (pathFrom === pathTo) {
      setPathMessage('Baslangic ve hedef ayni olamaz');
      setPathResult(null);
      return;
    }
    setPathMessage('');
    setPathResult(null);
    setLoading(true);
    try {
      const result = await api.getGraphPath(pathFrom, pathTo);
      if (result.path && result.path.length > 0) {
        const message = `${result.path.length - 1} adimda baglanti bulundu`;
        setPathMessage(message);
        // Load full graph to get node data for the path
        const fullGraph = await api.getGraphData();
        const pathEdgeKeys = new Set<string>();
        for (const e of result.edges) {
          pathEdgeKeys.add(`${e.source}-${e.target}-${e.type}`);
        }
        const nodeMap = new Map(fullGraph.nodes.map(node => [node.id, node]));
        const nodes = result.path.map(nodeId => nodeMap.get(nodeId)).filter((node): node is GraphNode => Boolean(node));
        const edges = fullGraph.edges.filter(e => pathEdgeKeys.has(`${e.source}-${e.target}-${e.type}`));
        rawDataRef.current = { nodes, edges };
        renderGraph(nodes, edges);
        setPathResult({ nodes, edges: result.edges, message });
        setGraphInfo(`Yol: ${nodes.length} dugum, ${edges.length} kenar`);
        window.setTimeout(() => {
          networkRef.current?.selectNodes(result.path, true);
          networkRef.current?.fit({ animation: true });
        }, 0);
      } else {
        setPathMessage('Baglanti bulunamadi');
      }
    } catch (err) {
      setPathMessage('Hata: ' + errorMessage(err, 'Yol bulunamadi'));
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleClusters() {
    if (clusterColors) {
      setClusterColors(false);
      setClusterMap(new Map());
      return;
    }
    try {
      const clusters = await api.getGraphClusters();
      const map = new Map<string, number>();
      for (const c of clusters) {
        for (const nodeId of c.nodeIds) {
          map.set(nodeId, c.clusterId);
        }
      }
      setClusterMap(map);
      setClusterColors(true);
    } catch (err) {
      console.error('Cluster error:', err);
    }
  }

  function handleDepthChange(newDepth: number) {
    setDepth(newDepth);
    if (selectedCompanyId) {
      loadGraph(selectedCompanyId, newDepth);
    }
  }

  function handleZoomIn() {
    if (networkRef.current) {
      const scale = networkRef.current.getScale();
      networkRef.current.moveTo({ scale: scale * 1.3 });
    }
  }

  function handleZoomOut() {
    if (networkRef.current) {
      const scale = networkRef.current.getScale();
      networkRef.current.moveTo({ scale: scale / 1.3 });
    }
  }

  function handleToggleGraphFullscreen() {
    setGraphFullscreen(current => !current);
    resizeGraphViewport(true);
  }

  const pathFromOptions = getPathCompanyOptions(pathFromQuery, pathTo);
  const pathToOptions = getPathCompanyOptions(pathToQuery, pathFrom);
  const activeGraphCompanyCount = currentGraphCompanyIds().size;
  const selectedRootCompany = selectedCompanyId ? allCompanies.find(company => company.id === selectedCompanyId) || null : null;
  const selectedRootIsMember = selectedRootCompany ? memberIds.includes(selectedRootCompany.id) : false;
  const selectedMemberSet = new Set(selectedMemberIds);
  const processedMemberIds = new Set(graphMemberCompanies.map(company => company.id));
  const selectedProcessedMemberCount = selectedMemberIds.filter(id => processedMemberIds.has(id)).length;
  const canUseSelectedForPath = selectedNodeCompany && allCompanies.some(company => company.id === selectedNodeCompany.id);
  const pathStatusColor = pathMessage.includes('bulunamadi') || pathMessage.includes('Hata') || pathMessage.includes('ayni')
    ? 'var(--red)'
    : 'var(--green)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap',
      }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: 0, margin: 0, marginRight: 16 }}>
          Ortaklik Grafi
        </h1>

        {/* Dropdown */}
        <select
          value={selectedCompanyId || ''}
          onChange={e => {
            const id = Number(e.target.value);
            if (id) {
              const c = searchableCompanies.find(c => c.id === id);
              if (c) handleCompanySelect(c);
            }
          }}
          style={{
            padding: '8px 30px 8px 12px', background: 'var(--bg-surface)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            color: 'var(--text)', fontSize: 13, outline: 'none',
            appearance: 'none', cursor: 'pointer', maxWidth: 260,
            backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1L5 5L9 1\' stroke=\'%238c8c9e\' stroke-width=\'1.5\' stroke-linecap=\'round\'/%3E%3C/svg%3E")',
            backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
          }}
        >
          <option value="">-- Sirket sec --</option>
          {searchableCompanies.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {/* Search */}
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '8px 12px',
          }}>
            <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              type="text"
              placeholder={memberMode ? 'Uyeler icinde sirket adi aratiniz' : 'Sirket adi aratiniz'}
              value={search}
              onFocus={() => {
                if (filteredCompanies.length > 0) setShowDropdown(true);
              }}
              onBlur={() => window.setTimeout(() => setShowDropdown(false), 120)}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && filteredCompanies[0]) {
                  event.preventDefault();
                  handleCompanySelect(filteredCompanies[0]);
                }
              }}
              style={{
                border: 'none', outline: 'none', background: 'transparent',
                color: 'var(--text)', fontSize: 13, width: '100%',
                fontFamily: 'inherit',
              }}
            />
          </div>
          {showDropdown && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', marginTop: 4, maxHeight: 260, overflowY: 'auto',
              boxShadow: 'var(--shadow-md)',
            }}>
              {filteredCompanies.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => handleCompanySelect(c)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '8px 14px', border: 'none', background: 'transparent',
                    color: 'var(--text)', fontSize: 13, cursor: 'pointer',
                    borderBottom: '1px solid var(--border)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Load full graph button */}
        <button
          onClick={handleLoadFull}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 'var(--radius)',
            border: '1px solid var(--border)', background: 'var(--bg-surface)',
            color: 'var(--text-dim)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
          }}
        >
          <GitBranch size={14} />
          Tam Graf
        </button>

        {/* Live KAP refresh for selected root */}
        <button
          onClick={() => void handleRefreshSelectedFromKap()}
          disabled={!selectedCompanyId || kapRefreshing}
          title="Secili sirketi KAP'tan tekrar cek ve ortaklik grafini yeniden isle"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 'var(--radius)',
            border: '1px solid var(--border)', background: selectedCompanyId ? 'var(--blue-bg)' : 'var(--bg-surface-2)',
            color: selectedCompanyId ? 'var(--blue)' : 'var(--text-muted)', fontSize: 12, fontWeight: 700,
            cursor: !selectedCompanyId || kapRefreshing ? 'not-allowed' : 'pointer',
            opacity: !selectedCompanyId ? 0.55 : 1,
          }}
        >
          <RefreshCw size={14} style={{ animation: kapRefreshing ? 'spin 1s linear infinite' : 'none' }} />
          {kapRefreshing ? 'KAP isleniyor...' : 'KAPtan Yeniden Isle'}
        </button>

        {/* Rebuild button */}
        <button
          onClick={handleRebuild}
          disabled={rebuilding}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 'var(--radius)',
            border: '1px solid var(--border)', background: 'var(--bg-surface)',
            color: 'var(--text-dim)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            opacity: rebuilding ? 0.6 : 1,
          }}
        >
          <RefreshCw size={14} style={{ animation: rebuilding ? 'spin 1s linear infinite' : 'none' }} />
          {rebuilding ? 'Yeniden olusturuluyor...' : 'Yeniden Olustur'}
        </button>
      </div>

      {/* Stats bar */}
      {stats && (
        <div style={{
          display: 'flex', gap: 16, marginBottom: 12, padding: '10px 16px',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', fontSize: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
            <GitBranch size={13} />
            <span>Toplam: <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{stats.totalNodes.toLocaleString('tr-TR')}</strong> dugum, <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{stats.totalEdges.toLocaleString('tr-TR')}</strong> kenar</span>
          </div>
          <div style={{ width: 1, background: 'var(--border)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#0033A0' }} />
            <span style={{ color: 'var(--text-muted)' }}>Sirket: <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{stats.companyNodes.toLocaleString('tr-TR')}</strong></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: '#f59e0b', transform: 'rotate(45deg)' }} />
            <span style={{ color: 'var(--text-muted)' }}>Ortak/Holding: <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{stats.shareholderNodes.toLocaleString('tr-TR')}</strong></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: '8px solid #22c55e' }} />
            <span style={{ color: 'var(--text-muted)' }}>Kisi: <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{stats.personNodes.toLocaleString('tr-TR')}</strong></span>
          </div>
          {graphInfo && (
            <>
              <div style={{ width: 1, background: 'var(--border)' }} />
              <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>{graphInfo}</span>
            </>
          )}
        </div>
      )}

      {/* Member companies */}
      <section data-testid="member-company-panel" style={{
        marginBottom: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', fontSize: 12, overflow: 'hidden', boxShadow: 'var(--shadow)',
      }}>
        <div style={{
          padding: '12px 14px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--accent)', fontSize: 13, fontWeight: 850 }}>
            <Star size={15} /> Uye Ortaklik Baglantilari
            <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              {members.length.toLocaleString('tr-TR')} uye
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setMemberMode(value => !value)}
              style={{
                height: 32, padding: '0 10px', borderRadius: 8,
                border: memberMode ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: memberMode ? 'var(--accent-bg)' : 'var(--bg-surface-2)',
                color: memberMode ? 'var(--accent)' : 'var(--text-dim)',
                cursor: 'pointer', fontSize: 12, fontWeight: 850,
              }}
            >
              Sadece uyeler
            </button>
            {selectedRootCompany && (
              <button
                type="button"
                onClick={selectedRootIsMember ? () => removeMember(selectedRootCompany.id) : addActiveCompanyToMembers}
                style={{
                  height: 32, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 10px',
                  borderRadius: 8, border: '1px solid var(--border)',
                  background: selectedRootIsMember ? 'var(--red-bg)' : 'var(--blue-bg)',
                  color: selectedRootIsMember ? 'var(--red)' : 'var(--blue)',
                  cursor: 'pointer', fontSize: 12, fontWeight: 850,
                }}
              >
                {selectedRootIsMember ? <X size={13} /> : <Plus size={13} />}
                {selectedRootIsMember ? 'Aktifi Cikar' : 'Aktifi Uyeye Ekle'}
              </button>
            )}
          </div>
        </div>

        <div style={{ padding: 14, display: 'grid', gap: 12 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) auto', gap: 8, alignItems: 'end',
            padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface-2)',
          }}>
            <div style={{ position: 'relative' }}>
              <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 10, fontWeight: 850, textTransform: 'uppercase', letterSpacing: 0, marginBottom: 6 }}>
                Uyeye sirket ekle
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
                  placeholder="Sirket adi ara..."
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
                      <span style={{ color: option.status === 'done' ? 'var(--green)' : 'var(--amber)', fontSize: 10, fontWeight: 850 }}>
                        {option.status === 'done' ? 'Graf hazir' : 'Islenecek'}
                      </span>
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
              <Plus size={13} /> Uyeye Ekle
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
            {members.length === 0 ? (
              <div style={{
                padding: '12px 13px', borderRadius: 8, border: '1px dashed var(--border)',
                background: 'var(--bg-surface-2)', color: 'var(--text-muted)', fontSize: 12,
              }}>
                Uye listesi bos. Sirket secip "Aktifi Uyeye Ekle" ile kaydedebilirsin.
              </div>
            ) : members.map(member => {
              const selected = selectedMemberSet.has(member.id);
              const processed = processedMemberIds.has(member.id);
              return (
                <div
                  key={member.id}
                  style={{
                    minWidth: 0, border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 8, background: selected ? 'var(--accent-bg)' : 'var(--bg-surface-2)',
                    display: 'grid', gap: 8, padding: 10,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleSelectedMember(member.id)}
                    title={member.name}
                    style={{
                      display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', alignItems: 'center',
                      gap: 8, border: 'none', background: 'transparent', color: selected ? 'var(--accent)' : 'var(--text)',
                      cursor: 'pointer', textAlign: 'left', padding: 0,
                    }}
                  >
                    <span style={{
                      width: 18, height: 18, borderRadius: 5, border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                      background: selected ? 'var(--accent)' : 'var(--bg-surface)',
                      color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {selected && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 850, fontSize: 12 }}>
                      {member.name}
                    </span>
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{
                      color: processed ? 'var(--green)' : 'var(--amber)',
                      background: processed ? 'var(--green-bg)' : 'var(--amber-bg)',
                      borderRadius: 6, padding: '3px 7px', fontSize: 10, fontWeight: 850,
                    }}>
                      {processed ? 'Graf hazir' : 'Veri bekliyor'}
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => handleCompanySelect(member)}
                        disabled={!processed}
                        title="Bu uyenin grafini ac"
                        style={{
                          height: 26, padding: '0 8px', borderRadius: 6, border: '1px solid var(--border)',
                          background: 'var(--bg-surface)', color: 'var(--text-dim)', cursor: processed ? 'pointer' : 'not-allowed',
                          opacity: processed ? 1 : 0.5, fontSize: 11, fontWeight: 850,
                        }}
                      >
                        Graf
                      </button>
                      <button
                        type="button"
                        onClick={() => removeMember(member.id)}
                        title="Uyeden cikar"
                        style={{
                          width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border)',
                          background: 'var(--bg-surface)', color: 'var(--text-muted)', cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {members.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                Secili: <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{selectedMemberIds.length}</strong>
                {' '} / graf hazir: <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{selectedProcessedMemberCount}</strong>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleLoadSelectedMembers}
                  disabled={selectedProcessedMemberCount === 0 || loading}
                  style={{
                    height: 32, padding: '0 12px', borderRadius: 8, border: 'none',
                    background: 'var(--accent)', color: '#fff', cursor: selectedProcessedMemberCount === 0 || loading ? 'not-allowed' : 'pointer',
                    opacity: selectedProcessedMemberCount === 0 ? 0.45 : 1, fontSize: 12, fontWeight: 850,
                  }}
                >
                  Secilenleri Goster
                </button>
                <button
                  type="button"
                  onClick={handleLoadAllMembers}
                  disabled={graphMemberCompanies.length === 0 || loading}
                  style={{
                    height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)',
                    background: 'var(--bg-surface-2)', color: 'var(--text-dim)', cursor: graphMemberCompanies.length === 0 || loading ? 'not-allowed' : 'pointer',
                    opacity: graphMemberCompanies.length === 0 ? 0.45 : 1, fontSize: 12, fontWeight: 850,
                  }}
                >
                  Tum Uyeleri Goster
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedMemberIds([])}
                  disabled={selectedMemberIds.length === 0}
                  style={{
                    height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)',
                    background: 'var(--bg-surface-2)', color: 'var(--text-dim)', cursor: selectedMemberIds.length === 0 ? 'not-allowed' : 'pointer',
                    opacity: selectedMemberIds.length === 0 ? 0.45 : 1, fontSize: 12, fontWeight: 850,
                  }}
                >
                  Secimi Temizle
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Filters */}
      <section data-testid="graph-filter-panel" style={{
        marginBottom: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', fontSize: 12, overflow: 'hidden', boxShadow: 'var(--shadow)',
      }}>
        <div style={{
          padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, borderBottom: showFilters ? '1px solid var(--border)' : 'none', flexWrap: 'wrap',
        }}>
          <button
            onClick={() => setShowFilters(!showFilters)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 10px',
              background: showFilters ? 'var(--accent-bg)' : 'var(--bg-surface-2)',
              border: '1px solid var(--border)', borderRadius: 8,
              color: showFilters ? 'var(--accent)' : 'var(--text-dim)',
              cursor: 'pointer', fontSize: 12, fontWeight: 850, fontFamily: 'inherit',
            }}
          >
            <SlidersHorizontal size={14} /> Filtreler
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', color: 'var(--text-muted)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>Min pay %{minPct}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>Derinlik {depth}</span>
            <button
              type="button"
              onClick={resetGraphFilters}
              style={{
                height: 30, padding: '0 10px', borderRadius: 7, border: '1px solid var(--border)',
                background: 'var(--bg-surface-2)', color: 'var(--text-dim)', cursor: 'pointer',
                fontSize: 12, fontWeight: 800, fontFamily: 'inherit',
              }}
            >
              Sifirla
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="graph-filter-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(220px, 1fr) minmax(260px, 1.2fr) minmax(280px, 1.3fr)',
            gap: 16,
            padding: 14,
          }}>
            <FilterGroup title="Dugum Tipi">
              <CheckChip label="Sirket" checked={showCompanies} color="#0033A0" onClick={() => setShowCompanies(!showCompanies)} />
              <CheckChip label="Ortak" checked={showShareholders} color="#f59e0b" onClick={() => setShowShareholders(!showShareholders)} />
              <CheckChip label="Kisi" checked={showPersons} color="#22c55e" onClick={() => setShowPersons(!showPersons)} />
            </FilterGroup>

            <FilterGroup title="Baglanti Tipi">
              <CheckChip label="Dogrudan" checked={showDirect} color="#0033A0" onClick={() => setShowDirect(!showDirect)} />
              <CheckChip label="Dolayli" checked={showIndirect} color="#8b5cf6" onClick={() => setShowIndirect(!showIndirect)} />
              <CheckChip label="Bagli Ort." checked={showSubsidiary} color="#f59e0b" onClick={() => setShowSubsidiary(!showSubsidiary)} />
            </FilterGroup>

            <FilterGroup title="Pay ve Derinlik">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontWeight: 800 }}>
                Min Pay
                <input
                  type="range" min={0} max={50} step={1} value={minPct}
                  onChange={event => setMinPct(Number(event.target.value))}
                  style={{ width: 100, accentColor: 'var(--accent)' }}
                />
                <input
                  type="number" min={0} max={50} value={minPct}
                  onChange={event => setMinPct(Math.max(0, Math.min(50, Number(event.target.value) || 0)))}
                  style={{
                    width: 54, height: 30, borderRadius: 7, border: '1px solid var(--border)',
                    background: 'var(--bg-surface-2)', color: 'var(--text)', padding: '0 6px',
                    fontFamily: 'var(--font-mono)', fontWeight: 800,
                  }}
                />
              </span>
              {[1, 2, 3, 4].map(value => (
                <SegmentChip key={value} label={`D${value}`} active={depth === value} onClick={() => handleDepthChange(value)} />
              ))}
            </FilterGroup>

            <FilterGroup title="Gorunum">
              {([['fixed', 'Sabit'], ['sermaye', 'Sermaye'], ['connection', 'Baglanti']] as const).map(([mode, label]) => (
                <SegmentChip key={mode} label={label} active={nodeSizeMode === mode} onClick={() => setNodeSizeMode(mode)} />
              ))}
              {([['fixed', 'Kalinlik sabit'], ['proportional', 'Orana gore']] as const).map(([mode, label]) => (
                <SegmentChip key={mode} label={label} active={edgeThicknessMode === mode} onClick={() => setEdgeThicknessMode(mode)} />
              ))}
            </FilterGroup>

            <FilterGroup title="Kapsam">
              <select
                value={selectedSector}
                onChange={event => setSelectedSector(event.target.value)}
                style={{
                  height: 30, minWidth: 190, padding: '0 9px', fontSize: 12, background: 'var(--bg-surface-2)',
                  border: '1px solid var(--border)', borderRadius: 7,
                  color: 'var(--text)', outline: 'none', fontFamily: 'inherit',
                }}
              >
                <option value="">Tum sektorler</option>
                {sectors.map(sector => <option key={sector} value={sector}>{sector}</option>)}
              </select>
              <CheckChip label="Yalnizlari gizle" checked={hideOrphans} color="#64748b" onClick={() => setHideOrphans(!hideOrphans)} />
              <CheckChip label="Cluster renkleri" checked={clusterColors} color="#0f766e" onClick={handleToggleClusters} />
            </FilterGroup>
          </div>
        )}
      </section>

      {/* Path finder */}
      <section data-testid="graph-path-finder" style={{
        marginBottom: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', fontSize: 12, overflow: 'visible', boxShadow: 'var(--shadow)',
      }}>
        <div style={{
          padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, borderBottom: showPathFinder ? '1px solid var(--border)' : 'none', flexWrap: 'wrap',
        }}>
          <button
            onClick={() => setShowPathFinder(!showPathFinder)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 10px',
              background: showPathFinder ? 'var(--blue-bg)' : 'var(--bg-surface-2)',
              border: '1px solid var(--border)', borderRadius: 8,
              color: showPathFinder ? 'var(--blue)' : 'var(--text-dim)',
              cursor: 'pointer', fontSize: 12, fontWeight: 850, fontFamily: 'inherit',
            }}
          >
            <Route size={14} /> Yol Bul
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <CheckChip
              label={activeGraphCompanyCount > 0 ? `Aktif grafte ara (${activeGraphCompanyCount})` : 'Aktif grafte ara'}
              checked={pathOnlyCurrentGraph}
              color="#0033A0"
              onClick={() => setPathOnlyCurrentGraph(!pathOnlyCurrentGraph)}
            />
            {pathMessage && (
              <span style={{ color: pathStatusColor, fontSize: 12, fontWeight: 850 }}>
                {pathMessage}
              </span>
            )}
          </div>
        </div>

        {showPathFinder && (
          <div style={{ padding: 14, display: 'grid', gap: 12 }}>
            <div className="graph-path-grid" style={{ display: 'flex', alignItems: 'end', gap: 10, flexWrap: 'wrap' }}>
              <PathCompanyInput
                label="Baslangic"
                query={pathFromQuery}
                selected={Boolean(pathFrom)}
                options={pathFromOptions}
                placeholder="Sirket adi yaz"
                onQueryChange={value => {
                  setPathFromQuery(value);
                  setPathFrom('');
                  setPathResult(null);
                  setPathMessage('');
                }}
                onSelect={company => selectPathCompany('from', company)}
                onClear={() => clearPathSelection('from')}
              />
              <button
                type="button"
                onClick={handleSwapPath}
                disabled={!pathFrom && !pathTo}
                title="Baslangic ve hedefi degistir"
                style={{
                  width: 38, height: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface-2)',
                  color: 'var(--text-dim)', cursor: (!pathFrom && !pathTo) ? 'not-allowed' : 'pointer',
                  opacity: (!pathFrom && !pathTo) ? 0.5 : 1,
                }}
              >
                <ArrowRightLeft size={15} />
              </button>
              <PathCompanyInput
                label="Hedef"
                query={pathToQuery}
                selected={Boolean(pathTo)}
                options={pathToOptions}
                placeholder="Hedef sirket adi yaz"
                onQueryChange={value => {
                  setPathToQuery(value);
                  setPathTo('');
                  setPathResult(null);
                  setPathMessage('');
                }}
                onSelect={company => selectPathCompany('to', company)}
                onClear={() => clearPathSelection('to')}
              />
              <button
                onClick={handleFindPath}
                disabled={!pathFrom || !pathTo || loading}
                style={{
                  height: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  gap: 7, padding: '0 16px', borderRadius: 8, border: 'none',
                  background: 'var(--accent)', color: '#fff', cursor: (!pathFrom || !pathTo || loading) ? 'not-allowed' : 'pointer',
                  opacity: (!pathFrom || !pathTo) ? 0.5 : 1, fontSize: 12, fontWeight: 850, fontFamily: 'inherit',
                }}
              >
                <Search size={14} /> Bul
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {selectedRootCompany && (
                <>
                  <button type="button" onClick={() => selectPathCompany('from', selectedRootCompany)} style={{ height: 30, padding: '0 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12, fontWeight: 800, fontFamily: 'inherit' }}>
                    Aktif sirket baslangic
                  </button>
                  <button type="button" onClick={() => selectPathCompany('to', selectedRootCompany)} style={{ height: 30, padding: '0 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12, fontWeight: 800, fontFamily: 'inherit' }}>
                    Aktif sirket hedef
                  </button>
                </>
              )}
              {canUseSelectedForPath && selectedNodeCompany && (
                <>
                  <button type="button" onClick={() => selectPathCompany('from', selectedNodeCompany)} style={{ height: 30, padding: '0 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--green-bg)', color: 'var(--green)', cursor: 'pointer', fontSize: 12, fontWeight: 850, fontFamily: 'inherit' }}>
                    Secili dugum baslangic
                  </button>
                  <button type="button" onClick={() => selectPathCompany('to', selectedNodeCompany)} style={{ height: 30, padding: '0 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--green-bg)', color: 'var(--green)', cursor: 'pointer', fontSize: 12, fontWeight: 850, fontFamily: 'inherit' }}>
                    Secili dugum hedef
                  </button>
                </>
              )}
            </div>

            {pathResult && (
              <div data-testid="graph-path-result" style={{
                border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface-2)',
                padding: 12, display: 'grid', gap: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--green)', fontWeight: 850 }}>
                    <Route size={14} /> {pathResult.message}
                  </div>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                    {pathResult.nodes.length} dugum / {pathResult.edges.length} baglanti
                  </span>
                </div>
                <div style={{ display: 'grid', gap: 7 }}>
                  {pathResult.nodes.map((node, index) => {
                    const edge = pathResult.edges[index];
                    return (
                      <div key={`${node.id}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{
                          width: 22, height: 22, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          background: node.type === 'company' ? 'var(--blue-bg)' : node.type === 'shareholder' ? 'var(--amber-bg)' : 'var(--green-bg)',
                          color: node.type === 'company' ? 'var(--blue)' : node.type === 'shareholder' ? 'var(--amber)' : 'var(--green)',
                          fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 850,
                        }}>
                          {index + 1}
                        </span>
                        <span style={{ color: 'var(--text)', fontSize: 12, fontWeight: 850 }}>
                          {node.label}
                        </span>
                        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                          {nodeTypeLabel(node.type)}
                        </span>
                        {edge && (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5, color: EDGE_COLORS[edge.type] || 'var(--text-dim)',
                            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 7,
                            padding: '4px 8px', fontSize: 11, fontWeight: 850,
                          }}>
                            <CornerDownRight size={13} />
                            {edgeTypeLabel(edge.type)}
                            {edgeDetail(edge) && <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{edgeDetail(edge)}</span>}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Main content area */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', gap: 12, minHeight: 0 }}>
        {/* Graph canvas */}
        <div ref={graphShellRef} style={{
          flex: 1,
          position: graphFullscreen ? 'fixed' : 'relative',
          inset: graphFullscreen ? 12 : undefined,
          zIndex: graphFullscreen ? 1000 : undefined,
          width: graphFullscreen ? 'calc(100vw - 24px)' : undefined,
          height: graphFullscreen ? 'calc(100vh - 24px)' : undefined,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: graphFullscreen ? 10 : 'var(--radius)', overflow: 'hidden',
          boxShadow: graphFullscreen ? '0 24px 80px rgba(16, 24, 40, 0.22)' : undefined,
        }}>
          {loading && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(247,248,251,0.82)', zIndex: 10,
            }}>
              <div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 500 }}>Graf yukleniyor...</div>
            </div>
          )}

          {!loading && !networkRef.current && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)',
            }}>
              <div style={{
                width: 64, height: 64, background: 'var(--bg-surface-2)', borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20,
              }}>
                <GitBranch size={28} />
              </div>
              <p style={{ fontSize: 14, maxWidth: 400, textAlign: 'center', lineHeight: 1.6, margin: 0 }}>
                Yukaridaki arama cubuguna sirket adi yazin veya "Tam Graf" butonuna tiklayin.
              </p>
            </div>
          )}

          <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

          {/* Zoom controls */}
          {networkRef.current && (
            <div style={{
              position: 'absolute', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              {[
                { icon: ZoomIn, onClick: handleZoomIn, title: 'Yakinlastir' },
                { icon: ZoomOut, onClick: handleZoomOut, title: 'Uzaklastir' },
                {
                  icon: graphFullscreen ? Minimize : Maximize,
                  onClick: handleToggleGraphFullscreen,
                  title: graphFullscreen ? 'Tam ekrandan cik' : 'Tam ekran',
                },
              ].map(({ icon: Icon, onClick, title }) => (
                <button
                  key={title}
                  onClick={onClick}
                  title={title}
                  style={{
                    width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--bg-surface)', border: '1px solid var(--border)',
                    borderRadius: 6, cursor: 'pointer', color: 'var(--text-dim)',
                  }}
                >
                  <Icon size={14} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected node panel */}
        {selectedNode && (
          <div style={{
            width: 280, background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: 16, overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: selectedNode.type === 'company' ? 'var(--blue-bg)' : selectedNode.type === 'shareholder' ? '#f59e0b20' : '#22c55e20',
              }}>
                {selectedNode.type === 'company' ? <Building2 size={16} color="var(--blue)" /> :
                  selectedNode.type === 'shareholder' ? <Users size={16} color="#f59e0b" /> :
                    <User size={16} color="#22c55e" />}
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0 }}>
                  {selectedNode.type === 'company' ? 'Sirket' : selectedNode.type === 'shareholder' ? 'Ortak/Holding' : 'Kisi'}
                </div>
              </div>
            </div>

            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, lineHeight: 1.4, color: 'var(--text)' }}>
              {selectedNode.label}
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              ID: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{selectedNode.id}</span>
            </div>

            <div style={{ display: 'grid', gap: 8, margin: '12px 0 14px' }}>
              {selectedNode.sector && (
                <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--bg-surface-2)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase' }}>Sektor</div>
                  <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 3 }}>{selectedNode.sector}</div>
                </div>
              )}
              {selectedNode.sermaye && (
                <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--blue-bg)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 800, textTransform: 'uppercase' }}>Odenmis Sermaye</div>
                  <div style={{ fontSize: 12, color: 'var(--blue)', marginTop: 3, fontFamily: 'var(--font-mono)', fontWeight: 800 }}>{selectedNode.sermaye}</div>
                </div>
              )}
              {selectedNode.connectionCount !== undefined && (
                <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--bg-surface-2)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase' }}>Baglanti</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 3, fontFamily: 'var(--font-mono)', fontWeight: 800 }}>{selectedNode.connectionCount.toLocaleString('tr-TR')} kenar</div>
                </div>
              )}
              {selectedNodeCompany && selectedNode.type !== 'company' && (
                <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--green-bg)', color: 'var(--green)', fontSize: 12, fontWeight: 800 }}>
                  KAP sirket kaydiyla eslesti
                </div>
              )}
            </div>

            {selectedNodeCompany && (
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  onClick={() => navigate(`/company?id=${selectedNodeCompany.id}`)}
                  style={{
                    padding: '8px 14px', borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)', background: 'var(--accent)',
                    color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center',
                  }}
                >
                  <Building2 size={13} />
                  Sirket Detayina Git
                </button>
                <button
                  onClick={() => navigate(`/ratings?company=${encodeURIComponent(selectedNodeCompany.name)}`)}
                  style={{
                    padding: '8px 14px', borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)', background: 'var(--blue-bg)',
                    color: 'var(--blue)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center',
                  }}
                >
                  <ShieldCheck size={13} />
                  Rating Kayitlari
                </button>
                <button
                  onClick={() => navigate(`/news?q=${encodeURIComponent(selectedNodeCompany.name)}`)}
                  style={{
                    padding: '8px 14px', borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)', background: 'var(--accent-bg)',
                    color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center',
                  }}
                >
                  <Newspaper size={13} />
                  Haberleri Ara
                </button>
                {selectedCompanyId !== selectedNodeCompany.id && (
                  <button
                    onClick={() => {
                      setSelectedCompanyId(selectedNodeCompany.id);
                      setSearch(selectedNodeCompany.name);
                      setSearchParams({ company_id: String(selectedNodeCompany.id) });
                      loadGraph(selectedNodeCompany.id);
                    }}
                    style={{
                      padding: '8px 14px', borderRadius: 'var(--radius)',
                      border: '1px solid var(--border)', background: 'var(--bg-surface-2)',
                      color: 'var(--text-dim)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center',
                    }}
                  >
                    <GitBranch size={13} />
                    Bu Sirketin Grafini Goster
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Spin animation keyframes */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
