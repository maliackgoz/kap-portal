import db from '../db.js';

// --- Types ---

export interface GraphNode {
  id: string;
  label: string;
  type: 'company' | 'shareholder' | 'person';
  company_id?: number;
  sermaye?: string;
  sector?: string;
  connectionCount?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'OWNS_DIRECTLY' | 'OWNS_INDIRECTLY' | 'HAS_SUBSIDIARY';
  oran_pct?: string;
  pay_tl?: string;
  oy_hakki_pct?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  companyNodes: number;
  shareholderNodes: number;
  personNodes: number;
}

// --- In-memory cache ---

let cachedGraph: GraphData | null = null;

// --- Turkish normalization ---

const TURKISH_MAP: Record<string, string> = {
  '\u0130': 'I', '\u015E': 'S', '\u00C7': 'C', '\u011E': 'G', '\u00DC': 'U', '\u00D6': 'O',
  '\u0131': 'I', '\u015F': 'S', '\u00E7': 'C', '\u011F': 'G', '\u00FC': 'U', '\u00F6': 'O',
  '\u00E2': 'A', '\u00EE': 'I', '\u00FB': 'U',
};

const REMOVE_WORDS = [
  'A\\.S\\.', 'A\\.\\u015E\\.', 'ANONIM SIRKETI', 'TICARET', 'SANAYI', ' VE ', 'LTD\\.', 'STI\\.', 'LIMITED',
];

function normalizeName(name: string): string {
  let n = name.toUpperCase();
  // Replace Turkish characters
  for (const [from, to] of Object.entries(TURKISH_MAP)) {
    n = n.replace(new RegExp(from, 'g'), to);
  }
  // Remove common suffixes/words
  for (const word of REMOVE_WORDS) {
    n = n.replace(new RegExp(word, 'g'), ' ');
  }
  // Collapse spaces and trim
  return n.replace(/\s+/g, ' ').trim();
}

// --- Shareholder type detection ---

const COMPANY_INDICATORS = ['A.S.', 'A.\u015E.', 'HOLDING', 'SIRKET', '\u015E\u0130RKET', 'B.V.', 'INC', 'CORP', 'GMBH', 'LTD', 'AKTIENGESELLSCHAFT', 'HOLDİNG', 'ŞİRKET'];

function isCompanyName(name: string): boolean {
  const upper = name.toUpperCase();
  return COMPANY_INDICATORS.some(ind => upper.includes(ind.toUpperCase()));
}

function shouldSkip(name: string | null | undefined): boolean {
  if (!name || name.trim() === '') return true;
  const normalized = normalizeName(name);
  const skipPatterns = ['DIGER', 'TOPLAM', 'HALKA ACIK', 'DIGER ORTAKLAR', 'SERBEST', 'BILGI MEVCUT DEGIL'];
  return skipPatterns.some(p => normalized === p || normalized.startsWith(p));
}

function parseStoredString(value: string): string {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : value;
  } catch {
    return value;
  }
}

// --- Graph builder ---

export function buildGraph(): GraphData {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  // 1. Load all companies
  const companies = db.prepare('SELECT id, name, slug FROM companies').all() as Array<{id: number; name: string; slug: string}>;

  // Build normalized name -> company map
  const normalizedCompanyMap = new Map<string, {id: number; name: string}>();
  for (const c of companies) {
    const nodeId = `company_${c.id}`;
    nodes.set(nodeId, {
      id: nodeId,
      label: c.name,
      type: 'company',
      company_id: c.id,
    });
    normalizedCompanyMap.set(normalizeName(c.name), { id: c.id, name: c.name });
  }

  // 2. Load all shareholder data
  const shareholderRows = db.prepare(
    `SELECT company_id, item_key, value FROM shareholders
     WHERE item_key IN (
       'kpy41_acc5_sermayede_dogrudan',
       'kpy41_acc5_son_durum_sermayeye',
       'kpy41_acc5_ortaklik_yapisi',
       'kpy41_acc7_bagli_ortakliklar'
     )`
  ).all() as Array<{company_id: number; item_key: string; value: string}>;

  // Track shareholder node IDs by normalized name to avoid duplicates
  const shareholderNodeMap = new Map<string, string>();

  function getOrCreateShareholderNode(rawName: string): string | null {
    const name = rawName.trim();
    if (shouldSkip(name)) return null;

    const normalized = normalizeName(name);

    // Check if this matches a known company
    const matchedCompany = normalizedCompanyMap.get(normalized);
    if (matchedCompany) {
      return `company_${matchedCompany.id}`;
    }

    // Check if we already have a shareholder node for this normalized name
    if (shareholderNodeMap.has(normalized)) {
      return shareholderNodeMap.get(normalized)!;
    }

    // Create new node
    const isCompany = isCompanyName(name);
    const type = isCompany ? 'shareholder' : 'person';
    const nodeId = `${type}_${shareholderNodeMap.size + 1}`;

    nodes.set(nodeId, {
      id: nodeId,
      label: name,
      type,
    });

    shareholderNodeMap.set(normalized, nodeId);
    return nodeId;
  }

  for (const row of shareholderRows) {
    let data: any[];
    try {
      data = JSON.parse(row.value);
    } catch {
      continue;
    }
    if (!Array.isArray(data) || data.length === 0) continue;

    const targetNodeId = `company_${row.company_id}`;

    switch (row.item_key) {
      case 'kpy41_acc5_sermayede_dogrudan': {
        // Direct ownership: shareholder → company
        for (const entry of data) {
          const name = entry.shareholder || entry.shareholderName;
          if (!name || shouldSkip(name)) continue;
          const sourceId = getOrCreateShareholderNode(name);
          if (!sourceId) continue;
          edges.push({
            source: sourceId,
            target: targetNodeId,
            type: 'OWNS_DIRECTLY',
            oran_pct: entry.ratioInCapital,
            pay_tl: entry.shareInCapital,
            oy_hakki_pct: entry.votingRightRatio,
          });
        }
        break;
      }

      case 'kpy41_acc5_son_durum_sermayeye': {
        // Indirect ownership
        for (const entry of data) {
          const name = entry.shareholder || entry.shareholderName;
          if (!name || shouldSkip(name)) continue;
          const sourceId = getOrCreateShareholderNode(name);
          if (!sourceId) continue;
          edges.push({
            source: sourceId,
            target: targetNodeId,
            type: 'OWNS_INDIRECTLY',
            oran_pct: entry.ratioInCapital,
            pay_tl: entry.shareInCapital,
          });
        }
        break;
      }

      case 'kpy41_acc5_ortaklik_yapisi': {
        // Alternative direct ownership
        for (const entry of data) {
          const name = entry.shareholder || entry.shareholderName;
          if (!name || shouldSkip(name)) continue;
          const sourceId = getOrCreateShareholderNode(name);
          if (!sourceId) continue;
          edges.push({
            source: sourceId,
            target: targetNodeId,
            type: 'OWNS_DIRECTLY',
            oran_pct: entry.ratioInCapital,
            pay_tl: entry.shareInCapital,
          });
        }
        break;
      }

      case 'kpy41_acc7_bagli_ortakliklar': {
        // Subsidiaries: company → subsidiary
        for (const entry of data) {
          const name = entry.companyTitle || entry.companyName;
          if (!name || shouldSkip(name)) continue;
          const subsidiaryId = getOrCreateShareholderNode(name);
          if (!subsidiaryId) continue;
          edges.push({
            source: targetNodeId,
            target: subsidiaryId,
            type: 'HAS_SUBSIDIARY',
            oran_pct: entry.ratioOfCapitalShareOfCompany,
            pay_tl: entry.capitalShareOfCompany,
          });
        }
        break;
      }
    }
  }

  // 3. Populate sermaye and sector for company nodes
  const metaRows = db.prepare(
    `SELECT company_id, item_key, value FROM shareholders
     WHERE item_key IN ('kpy41_acc5_odenmis_sermaye', 'kpy41_acc2_sektor')`
  ).all() as Array<{company_id: number; item_key: string; value: string}>;

  for (const row of metaRows) {
    const nodeId = `company_${row.company_id}`;
    const node = nodes.get(nodeId);
    if (!node) continue;
    if (row.item_key === 'kpy41_acc5_odenmis_sermaye') {
      node.sermaye = parseStoredString(row.value);
    } else if (row.item_key === 'kpy41_acc2_sektor') {
      node.sector = parseStoredString(row.value);
    }
  }

  // 4. Compute connectionCount per node
  const connCount = new Map<string, number>();
  for (const edge of edges) {
    connCount.set(edge.source, (connCount.get(edge.source) || 0) + 1);
    connCount.set(edge.target, (connCount.get(edge.target) || 0) + 1);
  }
  for (const [nodeId, count] of connCount) {
    const node = nodes.get(nodeId);
    if (node) node.connectionCount = count;
  }

  const graphData: GraphData = {
    nodes: Array.from(nodes.values()),
    edges,
  };

  cachedGraph = graphData;
  return graphData;
}

export function getGraph(): GraphData {
  if (cachedGraph) return cachedGraph;
  return buildGraph();
}

export function getSubgraph(companyId: number, depth: number = 2): GraphData {
  const fullGraph = getGraph();

  const rootId = `company_${companyId}`;
  if (!fullGraph.nodes.find(n => n.id === rootId)) {
    return { nodes: [], edges: [] };
  }

  // Pre-compute edge count per node to detect hubs
  const edgeCount = new Map<string, number>();
  for (const edge of fullGraph.edges) {
    edgeCount.set(edge.source, (edgeCount.get(edge.source) || 0) + 1);
    edgeCount.set(edge.target, (edgeCount.get(edge.target) || 0) + 1);
  }

  // Hub threshold — nodes with more than this many connections get limited traversal
  const HUB_THRESHOLD = 15;

  // BFS with hub protection
  const relevantNodeIds = new Set<string>([rootId]);
  let frontier = new Set<string>([rootId]);

  for (let d = 0; d < depth; d++) {
    const nextFrontier = new Set<string>();
    for (const nodeId of frontier) {
      for (const edge of fullGraph.edges) {
        let neighbor: string | null = null;
        if (edge.source === nodeId) neighbor = edge.target;
        if (edge.target === nodeId) neighbor = edge.source;

        if (!neighbor || relevantNodeIds.has(neighbor)) continue;

        // Skip hub nodes at depth > 0 to prevent graph explosion
        const neighborEdges = edgeCount.get(neighbor) || 0;
        if (d > 0 && neighborEdges > HUB_THRESHOLD) continue;

        relevantNodeIds.add(neighbor);
        nextFrontier.add(neighbor);
      }
    }
    frontier = nextFrontier;
  }

  const subEdges = fullGraph.edges.filter(
    e => relevantNodeIds.has(e.source) && relevantNodeIds.has(e.target)
  );
  const subNodes = fullGraph.nodes.filter(n => relevantNodeIds.has(n.id));

  return { nodes: subNodes, edges: subEdges };
}

export function getStats(): GraphStats {
  const graph = getGraph();
  return {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    companyNodes: graph.nodes.filter(n => n.type === 'company').length,
    shareholderNodes: graph.nodes.filter(n => n.type === 'shareholder').length,
    personNodes: graph.nodes.filter(n => n.type === 'person').length,
  };
}

export function findPath(fromId: string, toId: string): { path: string[], edges: GraphEdge[] } | null {
  const graph = getGraph();

  // Build adjacency list
  const adj = new Map<string, { neighbor: string; edge: GraphEdge }[]>();
  for (const edge of graph.edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    if (!adj.has(edge.target)) adj.set(edge.target, []);
    adj.get(edge.source)!.push({ neighbor: edge.target, edge });
    adj.get(edge.target)!.push({ neighbor: edge.source, edge });
  }

  if (!adj.has(fromId) || !adj.has(toId)) return null;

  // BFS
  const visited = new Set<string>([fromId]);
  const parent = new Map<string, { node: string; edge: GraphEdge }>();
  const queue: string[] = [fromId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === toId) {
      // Reconstruct path
      const path: string[] = [];
      const pathEdges: GraphEdge[] = [];
      let node = toId;
      while (node !== fromId) {
        path.unshift(node);
        const p = parent.get(node)!;
        pathEdges.unshift(p.edge);
        node = p.node;
      }
      path.unshift(fromId);
      return { path, edges: pathEdges };
    }
    for (const { neighbor, edge } of adj.get(current) || []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, { node: current, edge });
        queue.push(neighbor);
      }
    }
  }

  return null;
}

export function getClusters(): { clusterId: number; nodeIds: string[] }[] {
  const graph = getGraph();

  // Build adjacency list
  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adj.set(node.id, []);
  }
  for (const edge of graph.edges) {
    adj.get(edge.source)?.push(edge.target);
    adj.get(edge.target)?.push(edge.source);
  }

  const visited = new Set<string>();
  const clusters: { clusterId: number; nodeIds: string[] }[] = [];
  let clusterId = 0;

  for (const node of graph.nodes) {
    if (visited.has(node.id)) continue;
    // BFS for connected component
    const component: string[] = [];
    const queue: string[] = [node.id];
    visited.add(node.id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of adj.get(current) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    clusters.push({ clusterId, nodeIds: component });
    clusterId++;
  }

  return clusters;
}

export function getSectors(): string[] {
  const rows = db.prepare(
    `SELECT DISTINCT value FROM shareholders WHERE item_key = 'kpy41_acc2_sektor'`
  ).all() as Array<{ value: string }>;
  return rows.map(r => r.value).filter(v => v && v.trim() !== '').sort();
}

export function invalidateCache(): void {
  cachedGraph = null;
}
