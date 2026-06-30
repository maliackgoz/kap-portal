import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { pathToFileURL } from 'url';
import db from './db.js';
import {
  buildGraph,
  findPath,
  getClusters,
  getGraph,
  getSectors,
  getStats,
  getSubgraph,
  invalidateCache,
  type GraphData,
  type GraphEdge,
  type GraphNode,
} from './services/graph-builder.js';
import { scrapeCompany } from './services/scraper.js';

type Company = {
  id: number;
  name: string;
  slug: string;
  oid: string;
  ticker: string | null;
  status: 'pending' | 'processing' | 'done' | 'error' | 'no_data';
  last_processed_at: string | null;
  created_at?: string;
};

const STATUS_VALUES = ['pending', 'processing', 'done', 'error', 'no_data'] as const;
const EDGE_TYPES = ['OWNS_DIRECTLY', 'OWNS_INDIRECTLY', 'HAS_SUBSIDIARY'] as const;

const IMPORTANT_KEYS: Record<string, string> = {
  kpy41_acc2_sektor: 'sector',
  kpy41_acc5_odenmis_sermaye: 'paid_capital',
  kpy41_acc5_kayitli_sermaye_tavani: 'registered_capital_ceiling',
  kpy41_acc5_sermayede_dogrudan: 'direct_shareholders',
  kpy41_acc5_son_durum_sermayeye: 'indirect_shareholders',
  kpy41_acc5_ortaklik_yapisi: 'shareholding_structure',
  kpy41_acc7_bagli_ortakliklar: 'subsidiaries',
};

function jsonResult(data: Record<string, unknown>) {
  const text = JSON.stringify(data, null, 2);
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: data,
  };
}

function parseStoredValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseRatio(value: string | undefined): number | null {
  if (!value) return null;
  const stripped = value.replace(/%/g, '').replace(/\s/g, '');
  const normalized = stripped.includes(',')
    ? stripped.replace(/\./g, '').replace(',', '.')
    : stripped;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function compactCompanyData(data: Record<string, unknown>) {
  const summary: Record<string, unknown> = {};
  for (const [rawKey, friendlyKey] of Object.entries(IMPORTANT_KEYS)) {
    if (rawKey in data) summary[friendlyKey] = data[rawKey];
  }
  return summary;
}

function readCompanyData(companyId: number, keys?: string[]) {
  const rows = db
    .prepare('SELECT item_key, value, fetched_at FROM shareholders WHERE company_id = ? ORDER BY item_key')
    .all(companyId) as Array<{ item_key: string; value: string; fetched_at: string }>;

  const keySet = keys?.length ? new Set(keys) : null;
  const data: Record<string, unknown> = {};
  const fetchedAt: Record<string, string> = {};

  for (const row of rows) {
    if (keySet && !keySet.has(row.item_key)) continue;
    data[row.item_key] = parseStoredValue(row.value);
    fetchedAt[row.item_key] = row.fetched_at;
  }

  return { data, fetchedAt, availableKeys: rows.map(row => row.item_key) };
}

function getCompanyById(companyId: number): Company | null {
  return db
    .prepare(
      `SELECT id, name, slug, oid, ticker, status, last_processed_at, created_at
       FROM companies
       WHERE id = ?`,
    )
    .get(companyId) as Company | undefined ?? null;
}

function searchCompanyRows(query: string, limit = 10): Company[] {
  const trimmed = query.trim();
  const like = `%${trimmed}%`;
  return db
    .prepare(
      `SELECT id, name, slug, oid, ticker, status, last_processed_at, created_at
       FROM companies
       WHERE CAST(id AS TEXT) = ?
          OR ticker = ?
          OR slug = ?
          OR name LIKE ?
          OR ticker LIKE ?
          OR slug LIKE ?
          OR oid LIKE ?
       ORDER BY
         CASE
           WHEN CAST(id AS TEXT) = ? THEN 0
           WHEN ticker = ? THEN 1
           WHEN slug = ? THEN 2
           WHEN name = ? THEN 3
           ELSE 4
         END,
         name
       LIMIT ?`,
    )
    .all(trimmed, trimmed.toUpperCase(), trimmed, like, like, like, like, trimmed, trimmed.toUpperCase(), trimmed, trimmed, limit) as Company[];
}

function resolveCompany(input: { companyId?: number; query?: string }): Company {
  if (input.companyId !== undefined) {
    const company = getCompanyById(input.companyId);
    if (!company) throw new Error(`Company not found for id ${input.companyId}`);
    return company;
  }

  if (!input.query?.trim()) {
    throw new Error('Provide companyId or query');
  }

  const matches = searchCompanyRows(input.query, 5);
  if (matches.length === 0) throw new Error(`Company not found for query "${input.query}"`);
  return matches[0];
}

function buildNodeLookup(graph = getGraph()) {
  return new Map(graph.nodes.map(node => [node.id, node]));
}

function resolveNodeRef(ref: string): { id: string; node: GraphNode } {
  const graph = getGraph();
  const nodeLookup = buildNodeLookup(graph);
  const trimmed = ref.trim();

  const exactNode = nodeLookup.get(trimmed);
  if (exactNode) return { id: trimmed, node: exactNode };

  const company = searchCompanyRows(trimmed, 1)[0];
  if (company) {
    const companyNodeId = `company_${company.id}`;
    const node = nodeLookup.get(companyNodeId);
    if (node) return { id: companyNodeId, node };
  }

  const upper = trimmed.toLocaleUpperCase('tr-TR');
  const node = graph.nodes.find(candidate => candidate.label.toLocaleUpperCase('tr-TR').includes(upper));
  if (!node) throw new Error(`Node not found for "${ref}"`);
  return { id: node.id, node };
}

function filterGraph(
  graph: GraphData,
  options: {
    rootNodeId?: string;
    edgeTypes?: Array<(typeof EDGE_TYPES)[number]>;
    minRatioPct?: number;
    maxNodes: number;
    maxEdges: number;
  },
) {
  const edgeTypeSet = options.edgeTypes?.length ? new Set(options.edgeTypes) : null;
  let edges = graph.edges.filter(edge => {
    if (edgeTypeSet && !edgeTypeSet.has(edge.type)) return false;
    if (options.minRatioPct !== undefined) {
      const ratio = parseRatio(edge.oran_pct);
      if (ratio === null || ratio < options.minRatioPct) return false;
    }
    return true;
  });

  if (edges.length > options.maxEdges) edges = edges.slice(0, options.maxEdges);

  const connectedIds = new Set<string>();
  for (const edge of edges) {
    connectedIds.add(edge.source);
    connectedIds.add(edge.target);
  }

  let nodes = graph.nodes.filter(node => connectedIds.has(node.id));
  const rootNode = options.rootNodeId ? graph.nodes.find(node => node.id === options.rootNodeId) : null;
  if (rootNode && !nodes.some(node => node.id === rootNode.id)) nodes.unshift(rootNode);

  if (nodes.length > options.maxNodes) {
    const allowed = new Set(nodes.slice(0, options.maxNodes).map(node => node.id));
    nodes = nodes.filter(node => allowed.has(node.id));
    edges = edges.filter(edge => allowed.has(edge.source) && allowed.has(edge.target));
  }

  return {
    nodes,
    edges,
    truncated: graph.nodes.length > nodes.length || graph.edges.length > edges.length,
    originalNodeCount: graph.nodes.length,
    originalEdgeCount: graph.edges.length,
  };
}

function hydratePath(pathIds: string[], edges: GraphEdge[]) {
  const nodeLookup = buildNodeLookup();
  return {
    nodes: pathIds.map(id => nodeLookup.get(id) ?? { id, label: id, type: 'shareholder' }),
    edges,
  };
}

export function createKapMcpServer() {
  const server = new McpServer({
    name: 'kap-portal-mcp',
    version: '0.1.0',
  });

  server.registerResource(
    'kap_system_overview',
    'kap://system/overview',
    {
      title: 'KAP Portal System Overview',
      description: 'Backend schema, graph semantics, and MCP tool map for the KAP Portal project.',
      mimeType: 'text/markdown',
    },
    uri => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: [
            '# KAP Portal MCP Overview',
            '',
            'KAP Portal reads company profile/shareholding data from kap.org.tr into SQLite.',
            '',
            'Tables:',
            '- companies: KAP company registry, ticker, scrape status, timestamps.',
            '- shareholders: raw KAP item_key/value rows per company.',
            '- processing_log: scrape and batch activity log.',
            '',
            'Graph edges:',
            '- OWNS_DIRECTLY from direct shareholder rows to the company.',
            '- OWNS_INDIRECTLY from indirect shareholder rows to the company.',
            '- HAS_SUBSIDIARY from company to subsidiary rows.',
            '',
            'Useful tools: kap_search_companies, kap_get_company_profile, kap_get_company_relationships, kap_find_relationship_path.',
          ].join('\n'),
        },
      ],
    }),
  );

  server.registerTool(
  'kap_status',
  {
    title: 'KAP Portal Status',
    description: 'Return database processing counts and relationship graph counts.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  () => {
    const database = db
      .prepare(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as processed,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
           SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
           SUM(CASE WHEN status = 'no_data' THEN 1 ELSE 0 END) as no_data
         FROM companies`,
      )
      .get();

    return jsonResult({
      database,
      graph: getStats(),
      sectors: getSectors().length,
    });
  },
  );

  server.registerTool(
  'kap_search_companies',
  {
    title: 'Search KAP Companies',
    description: 'Search KAP companies by name, slug, ticker, OID, status, or page through the registry.',
    inputSchema: {
      search: z.string().optional().describe('Company name, ticker, slug, OID, or id fragment.'),
      status: z.enum(STATUS_VALUES).optional().describe('Optional scrape status filter.'),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  ({ search, status, page, limit }) => {
    let where = '1=1';
    const params: unknown[] = [];

    if (status) {
      where += ' AND status = ?';
      params.push(status);
    }

    if (search?.trim()) {
      const like = `%${search.trim()}%`;
      where += ' AND (name LIKE ? OR slug LIKE ? OR oid LIKE ? OR ticker LIKE ? OR CAST(id AS TEXT) = ?)';
      params.push(like, like, like, like, search.trim());
    }

    const offset = (page - 1) * limit;
    const total = (db.prepare(`SELECT COUNT(*) as count FROM companies WHERE ${where}`).get(...params) as { count: number }).count;
    const companies = db
      .prepare(
        `SELECT id, name, slug, oid, ticker, status, last_processed_at
         FROM companies
         WHERE ${where}
         ORDER BY name
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);

    return jsonResult({
      companies,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  },
  );

  server.registerTool(
  'kap_get_company_profile',
  {
    title: 'Get KAP Company Profile',
    description: 'Return one company plus important parsed KAP fields. Use includeRawData or keys for raw item_key values.',
    inputSchema: {
      companyId: z.number().int().positive().optional(),
      query: z.string().optional().describe('Company name, ticker, slug, OID, or id if companyId is unknown.'),
      includeRawData: z.boolean().default(false),
      keys: z.array(z.string()).optional().describe('Specific shareholders.item_key values to include.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  ({ companyId, query, includeRawData, keys }) => {
    const company = resolveCompany({ companyId, query });
    const { data, fetchedAt, availableKeys } = readCompanyData(company.id, keys);

    return jsonResult({
      company,
      summary: compactCompanyData(data),
      rawData: includeRawData || keys?.length ? data : undefined,
      fetchedAt,
      availableKeys,
    });
  },
  );

  server.registerTool(
  'kap_find_nodes',
  {
    title: 'Find Graph Nodes',
    description: 'Search company, shareholder, and person nodes in the relationship graph.',
    inputSchema: {
      query: z.string().min(1),
      type: z.enum(['company', 'shareholder', 'person']).optional(),
      limit: z.number().int().min(1).max(100).default(25),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  ({ query, type, limit }) => {
    const needle = query.toLocaleUpperCase('tr-TR');
    const matches = getGraph()
      .nodes
      .filter(node => (!type || node.type === type) && node.label.toLocaleUpperCase('tr-TR').includes(needle))
      .slice(0, limit);

    return jsonResult({
      nodes: matches,
      totalReturned: matches.length,
    });
  },
  );

  server.registerTool(
  'kap_get_company_relationships',
  {
    title: 'Get Company Relationships',
    description: 'Return a bounded relationship subgraph for a company, including owners, indirect owners, and subsidiaries.',
    inputSchema: {
      companyId: z.number().int().positive().optional(),
      query: z.string().optional().describe('Company name, ticker, slug, OID, or id if companyId is unknown.'),
      depth: z.number().int().min(1).max(4).default(2),
      edgeTypes: z.array(z.enum(EDGE_TYPES)).optional(),
      minRatioPct: z.number().min(0).max(100).optional(),
      maxNodes: z.number().int().min(1).max(1000).default(200),
      maxEdges: z.number().int().min(1).max(2000).default(400),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  ({ companyId, query, depth, edgeTypes, minRatioPct, maxNodes, maxEdges }) => {
    const company = resolveCompany({ companyId, query });
    const subgraph = getSubgraph(company.id, depth);
    const filtered = filterGraph(subgraph, {
      rootNodeId: `company_${company.id}`,
      edgeTypes,
      minRatioPct,
      maxNodes,
      maxEdges,
    });

    return jsonResult({
      company,
      depth,
      filters: { edgeTypes, minRatioPct },
      ...filtered,
    });
  },
  );

  server.registerTool(
  'kap_find_relationship_path',
  {
    title: 'Find Relationship Path',
    description: 'Find the shortest ownership/subsidiary graph path between two company/node references.',
    inputSchema: {
      from: z.string().min(1).describe('Node id, company id, ticker, slug, or company/shareholder/person label.'),
      to: z.string().min(1).describe('Node id, company id, ticker, slug, or company/shareholder/person label.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  ({ from, to }) => {
    const source = resolveNodeRef(from);
    const target = resolveNodeRef(to);
    const result = findPath(source.id, target.id);

    return jsonResult({
      from: source,
      to: target,
      found: Boolean(result),
      path: result ? hydratePath(result.path, result.edges) : { nodes: [], edges: [] },
    });
  },
  );

  server.registerTool(
  'kap_top_relationship_clusters',
  {
    title: 'Top Relationship Clusters',
    description: 'List the largest connected components in the relationship graph.',
    inputSchema: {
      limit: z.number().int().min(1).max(50).default(10),
      sampleNodesPerCluster: z.number().int().min(1).max(25).default(5),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  ({ limit, sampleNodesPerCluster }) => {
    const nodeLookup = buildNodeLookup();
    const clusters = getClusters()
      .map(cluster => ({
        clusterId: cluster.clusterId,
        size: cluster.nodeIds.length,
        sampleNodes: cluster.nodeIds
          .slice(0, sampleNodesPerCluster)
          .map(id => nodeLookup.get(id) ?? { id, label: id }),
      }))
      .sort((a, b) => b.size - a.size)
      .slice(0, limit);

    return jsonResult({ clusters });
  },
  );

  server.registerTool(
  'kap_rebuild_relationship_graph',
  {
    title: 'Rebuild Relationship Graph',
    description: 'Clear and rebuild the in-memory relationship graph cache from SQLite.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  () => {
    invalidateCache();
    const graph = buildGraph();
    return jsonResult({
      message: 'Graph cache rebuilt',
      nodes: graph.nodes.length,
      edges: graph.edges.length,
    });
  },
  );

  server.registerTool(
  'kap_refresh_company_from_kap',
  {
    title: 'Refresh Company From KAP',
    description: 'Fetch one company from kap.org.tr and update the local SQLite rows. Requires confirm=true.',
    inputSchema: {
      companyId: z.number().int().positive().optional(),
      query: z.string().optional().describe('Company name, ticker, slug, OID, or id if companyId is unknown.'),
      confirm: z.boolean().default(false).describe('Must be true to write refreshed KAP data into SQLite.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ companyId, query, confirm }) => {
    if (!confirm) {
      return jsonResult({
        status: 'confirmation_required',
        message: 'Call again with confirm=true to fetch from KAP and update the local SQLite database.',
      });
    }

    const company = resolveCompany({ companyId, query });
    db.prepare("UPDATE companies SET status = 'processing' WHERE id = ?").run(company.id);

    const result = await scrapeCompany(company.slug);
    if (result.status === 'no_data') {
      db.prepare("UPDATE companies SET status = 'no_data', last_processed_at = datetime('now') WHERE id = ?").run(company.id);
      db.prepare("INSERT INTO processing_log (company_id, action, message) VALUES (?, 'no_data', 'Genel bilgiler yok')").run(company.id);
      invalidateCache();
      return jsonResult({ company, status: 'no_data', message: 'Genel bilgiler yok' });
    }

    const upsertStmt = db.prepare(
      `INSERT INTO shareholders (company_id, item_key, value, fetched_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(company_id, item_key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at`,
    );

    const insertMany = db.transaction((items: Array<[number, string, string]>) => {
      for (const [cid, key, value] of items) upsertStmt.run(cid, key, value);
    });

    const items = Object.entries(result.data).map(
      ([key, value]): [number, string, string] => [company.id, key, JSON.stringify(value)],
    );
    insertMany(items);

    db.prepare("UPDATE companies SET status = 'done', last_processed_at = datetime('now') WHERE id = ?").run(company.id);
    db.prepare("INSERT INTO processing_log (company_id, action, message) VALUES (?, 'process_company', ?)").run(
      company.id,
      `${items.length} veri noktasi`,
    );
    invalidateCache();

    return jsonResult({
      company,
      status: 'ok',
      keysWritten: items.length,
      keys: items.map(([, key]) => key),
    });
  },
  );

  return server;
}

async function main() {
  const server = createKapMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('KAP Portal MCP server running on stdio');
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  main().catch(error => {
    console.error('KAP Portal MCP server failed:', error);
    process.exit(1);
  });
}
