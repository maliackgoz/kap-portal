import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

type Company = {
  id: number;
  name: string;
  slug: string;
  oid: string;
  ticker?: string | null;
  status: string;
  last_processed_at: string | null;
  created_at?: string;
};

type GraphNode = {
  id: string;
  label: string;
  type: 'company' | 'shareholder' | 'person';
  company_id?: number;
  sermaye?: string;
  sector?: string;
  connectionCount?: number;
};

type GraphEdge = {
  source: string;
  target: string;
  type: 'OWNS_DIRECTLY' | 'OWNS_INDIRECTLY' | 'HAS_SUBSIDIARY';
  oran_pct?: string;
  pay_tl?: string;
  oy_hakki_pct?: string;
};

type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type SearchCompaniesResult = {
  companies: Company[];
  total: number;
  page: number;
  pages: number;
};

type MemberCompaniesResult = {
  members: Company[];
};

type RatingRow = {
  company: string;
  agency: string;
  rating_date: string | null;
  long_term_rating: string | null;
  short_term_rating: string | null;
  outlook: string | null;
  sector: string | null;
  action: string | null;
  source_url: string | null;
  report_url: string | null;
  pdf_url: string | null;
  extracted_at: string;
  rating_age_days: number | null;
  rating_is_old: boolean;
  freshness_note: string | null;
};

type RatingResponse = {
  summary: string;
  data: RatingRow[];
  missing?: boolean;
  stale?: boolean;
  old_rating_count?: number;
  source_errors?: string[];
};

type RatingSource = {
  key: string;
  name: string;
  type: 'rating' | 'news';
  enabled: boolean;
  last_status: string | null;
  last_refresh: string | null;
  last_errors: string[];
  record_count: number;
  report_count: number;
  display_status: string;
  status_class: string;
};

type RatingNewsRow = {
  company: string | null;
  source: string;
  title: string;
  url: string | null;
  published_at: string | null;
  summary: string | null;
  extracted_at: string;
};

type PortalDataResponse<T> = {
  summary: string;
  data: T[];
  missing?: boolean;
  stale?: boolean;
  source_errors?: string[];
};

type PortalClientOptions = {
  baseUrl: string;
  username: string;
  password: string;
};

const STATUS_VALUES = ['pending', 'processing', 'done', 'error', 'no_data'] as const;
const EDGE_TYPES = ['OWNS_DIRECTLY', 'OWNS_INDIRECTLY', 'HAS_SUBSIDIARY'] as const;
const KAP_COMPANY_BASE = 'https://www.kap.org.tr/tr/sirket-bilgileri/genel';

const IMPORTANT_KEYS: Record<string, string> = {
  kpy41_acc2_sektor: 'sector',
  kpy41_acc5_odenmis_sermaye: 'paid_capital',
  kpy41_acc5_kayitli_sermaye_tavani: 'registered_capital_ceiling',
  kpy41_acc5_sermayede_dogrudan: 'direct_shareholders',
  kpy41_acc5_son_durum_sermayeye: 'indirect_shareholders',
  kpy41_acc5_ortaklik_yapisi: 'shareholding_structure',
  kpy41_acc7_bagli_ortakliklar: 'subsidiaries',
};

export class PortalClient {
  readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private token: string | null = null;
  private loginPromise: Promise<string> | null = null;

  constructor(options: PortalClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.username = options.username;
    this.password = options.password;
  }

  async login(): Promise<string> {
    if (this.token) return this.token;
    if (this.loginPromise) return this.loginPromise;

    this.loginPromise = (async () => {
      const response = await fetch(`${this.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: this.username, password: this.password }),
      });

      if (!response.ok) {
        throw new Error(`Portal login failed: HTTP ${response.status}`);
      }

      const data = await response.json() as { token?: string };
      if (!data.token) throw new Error('Portal login response did not include a token');
      this.token = data.token;
      this.loginPromise = null;
      return data.token;
    })().catch(error => {
      this.loginPromise = null;
      throw error;
    });

    return this.loginPromise;
  }

  async request<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
    const token = await this.login();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
    };

    const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
    if (response.status === 401 && retry) {
      this.token = null;
      return this.request<T>(path, options, false);
    }

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(`Portal API ${path} failed: HTTP ${response.status}${message ? ` - ${message}` : ''}`);
    }

    return response.json() as Promise<T>;
  }

  async getFullGraph(): Promise<GraphData> {
    return this.request<GraphData>('/api/graph/data');
  }
}

function jsonResult(data: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
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

function withKapUrl<T extends Company>(company: T) {
  return {
    ...company,
    kap_url: `${KAP_COMPANY_BASE}/${company.slug}`,
  };
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

function buildNodeLookup(graph: GraphData) {
  return new Map(graph.nodes.map(node => [node.id, node]));
}

async function searchCompanies(client: PortalClient, input: {
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (input.search) params.set('search', input.search);
  if (input.status) params.set('status', input.status);
  params.set('page', String(input.page ?? 1));
  params.set('limit', String(input.limit ?? 20));
  const result = await client.request<SearchCompaniesResult>(`/api/companies?${params.toString()}`);
  return {
    ...result,
    companies: result.companies.map(withKapUrl),
  };
}

async function getMemberCompanies(client: PortalClient) {
  const result = await client.request<MemberCompaniesResult>('/api/members');
  return {
    members: result.members.map(withKapUrl),
    total: result.members.length,
  };
}

async function getCompanyRatings(client: PortalClient, input: {
  company: string;
  agency?: string;
  includeHistory?: boolean;
  limit?: number;
}) {
  const params = new URLSearchParams();
  params.set('company', input.company);
  params.set('latest_only', String(!input.includeHistory));
  if (input.agency) params.set('agency', input.agency);

  const response = await client.request<RatingResponse>(`/api/rating/ratings?${params.toString()}`);
  const limit = input.limit ?? 20;
  const records = response.data.slice(0, limit).map(row => ({
    ...row,
    uvd: row.long_term_rating,
    kvd: row.short_term_rating,
  }));

  return {
    summary: `${response.summary} KVD kısa vadeli derecelendirme notudur; MCP cevabında kvd ve short_term_rating alanları aynı değeri taşır.`,
    company: input.company,
    agency: input.agency,
    includeHistory: Boolean(input.includeHistory),
    records,
    totalReturned: records.length,
    totalMatched: response.data.length,
    missing: response.missing ?? response.data.length === 0,
    stale: response.stale,
    oldRatingCount: response.old_rating_count,
    sourceErrors: response.source_errors,
  };
}

async function getRatingSources(client: PortalClient, input: { type?: 'rating' | 'news' }) {
  const response = await client.request<PortalDataResponse<RatingSource>>('/api/rating/sources');
  const sources = input.type ? response.data.filter(source => source.type === input.type) : response.data;
  return {
    summary: response.summary,
    sources,
    totalReturned: sources.length,
    ratingSources: response.data.filter(source => source.type === 'rating').length,
    newsSources: response.data.filter(source => source.type === 'news').length,
  };
}

async function getCompanyNews(client: PortalClient, input: {
  company: string;
  source?: string;
  days?: number;
  limit?: number;
}) {
  const params = new URLSearchParams();
  params.set('company', input.company);
  if (input.source) params.set('source', input.source);
  if (input.days) params.set('days', String(input.days));

  const response = await client.request<PortalDataResponse<RatingNewsRow>>(`/api/rating/news?${params.toString()}`);
  const limit = input.limit ?? 30;
  const news = response.data.slice(0, limit);
  return {
    summary: response.summary,
    company: input.company,
    filters: { source: input.source, days: input.days },
    news,
    totalReturned: news.length,
    totalMatched: response.data.length,
    missing: response.missing ?? response.data.length === 0,
    stale: response.stale,
    sourceErrors: response.source_errors,
  };
}

async function searchRatingNews(client: PortalClient, input: {
  query: string;
  sources?: string[];
  limit?: number;
}) {
  const params = new URLSearchParams();
  params.set('q', input.query);
  params.set('limit', String(input.limit ?? 50));
  for (const source of input.sources ?? []) params.append('sources', source);

  const response = await client.request<PortalDataResponse<RatingNewsRow>>(`/api/rating/news/search?${params.toString()}`);
  return {
    summary: response.summary,
    query: input.query,
    news: response.data,
    totalReturned: response.data.length,
    missing: response.missing ?? response.data.length === 0,
    stale: response.stale,
    sourceErrors: response.source_errors,
  };
}

async function getCompanyFinancialOverview(client: PortalClient, input: {
  companyId?: number;
  query?: string;
  includeHistory?: boolean;
  includeNews?: boolean;
  includeRelationships?: boolean;
}) {
  const company = await resolveCompany(client, { companyId: input.companyId, query: input.query });
  const raw = await client.request<Record<string, unknown>>(`/api/companies/${company.id}/data`);
  const ratingCompany = input.query || company.name;

  const [ratings, news, relationships] = await Promise.all([
    getCompanyRatings(client, {
      company: ratingCompany,
      includeHistory: input.includeHistory,
      limit: input.includeHistory ? 50 : 20,
    }),
    input.includeNews === false
      ? Promise.resolve(null)
      : getCompanyNews(client, { company: ratingCompany, days: 90, limit: 20 }),
    input.includeRelationships === false
      ? Promise.resolve(null)
      : client.request<GraphData>(`/api/graph/data?company_id=${company.id}&depth=1`).then(graph => filterGraph(graph, {
        rootNodeId: `company_${company.id}`,
        maxNodes: 80,
        maxEdges: 120,
      })),
  ]);

  return {
    company: withKapUrl(company),
    kapProfile: {
      summary: compactCompanyData(raw),
      availableKeys: Object.keys(raw),
    },
    ratings,
    news,
    relationships,
  };
}

async function resolveCompany(client: PortalClient, input: { companyId?: number; query?: string }): Promise<Company> {
  if (input.companyId !== undefined) {
    return client.request<Company>(`/api/companies/${input.companyId}`);
  }

  const query = input.query?.trim();
  if (!query) throw new Error('Provide companyId or query');
  const normalizedCompanyId = query.match(/^company_(\d+)$/i)?.[1];
  if (normalizedCompanyId) {
    return client.request<Company>(`/api/companies/${normalizedCompanyId}`);
  }

  const matches = await searchCompanies(client, { search: query, limit: 5 });
  if (matches.companies.length === 0) throw new Error(`Company not found for query "${query}"`);
  return matches.companies[0];
}

async function resolveNodeRef(client: PortalClient, ref: string) {
  const graph = await client.getFullGraph();
  const nodeLookup = buildNodeLookup(graph);
  const trimmed = ref.trim();

  const exactNode = nodeLookup.get(trimmed);
  if (exactNode) return { id: trimmed, node: exactNode };

  if (/^\d+$/.test(trimmed)) {
    const companyNode = nodeLookup.get(`company_${trimmed}`);
    if (companyNode) return { id: companyNode.id, node: companyNode };
  }

  const company = (await searchCompanies(client, { search: trimmed, limit: 1 })).companies[0];
  if (company) {
    const companyNode = nodeLookup.get(`company_${company.id}`);
    if (companyNode) return { id: companyNode.id, node: companyNode };
  }

  const upper = trimmed.toLocaleUpperCase('tr-TR');
  const node = graph.nodes.find(candidate => candidate.label.toLocaleUpperCase('tr-TR').includes(upper));
  if (!node) throw new Error(`Node not found for "${ref}"`);
  return { id: node.id, node };
}

async function hydratePath(client: PortalClient, pathIds: string[], edges: GraphEdge[]) {
  const nodeLookup = buildNodeLookup(await client.getFullGraph());
  return {
    nodes: pathIds.map(id => nodeLookup.get(id) ?? { id, label: id, type: 'shareholder' }),
    edges,
  };
}

export function createPortalMcpServer(client: PortalClient) {
  const server = new McpServer({
    name: 'kap-portal-remote-mcp',
    version: '0.2.0',
  });

  server.registerResource(
    'kap_remote_system_overview',
    'kap://remote/system/overview',
    {
      title: 'Remote KAP Portal MCP Overview',
      description: 'MCP tools that read company and relationship graph data from an existing KAP Portal HTTP API.',
      mimeType: 'text/markdown',
    },
    uri => ({
      contents: [{
        uri: uri.href,
        mimeType: 'text/markdown',
        text: [
          '# Remote KAP Portal MCP',
          '',
          `Portal API: ${client.baseUrl}`,
          '',
          'This MCP server does not start another portal instance. It logs into the existing portal and reads /api/companies and /api/graph endpoints.',
          '',
          'Use kap_search_companies, kap_get_company_profile, kap_get_company_relationships, and kap_find_relationship_path to answer ownership and company relationship questions.',
        ].join('\n'),
      }],
    }),
  );

  server.registerTool(
    'kap_status',
    {
      title: 'KAP Portal Status',
      description: 'Return remote portal processing counts and relationship graph counts.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const [database, graph, sectors, processing] = await Promise.all([
        client.request<Record<string, unknown>>('/api/dashboard/stats'),
        client.request<Record<string, unknown>>('/api/graph/stats'),
        client.request<string[]>('/api/graph/sectors'),
        client.request<Record<string, unknown>>('/api/processing/state'),
      ]);
      return jsonResult({ portal: client.baseUrl, database, graph, sectors: sectors.length, processing });
    },
  );

  server.registerTool(
    'kap_search_companies',
    {
      title: 'Search KAP Companies',
      description: 'Search KAP companies on the remote portal by name, slug, ticker, OID, status, or page.',
      inputSchema: {
        search: z.string().optional(),
        status: z.enum(STATUS_VALUES).optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async args => jsonResult(await searchCompanies(client, args)),
  );

  server.registerTool(
    'kap_get_member_companies',
    {
      title: 'Get Member Companies',
      description: 'Return the portal member company list selected by the user. Use this when the user asks for only their members.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => jsonResult(await getMemberCompanies(client)),
  );

  server.registerTool(
    'kap_get_company_profile',
    {
      title: 'Get KAP Company Profile',
      description: 'Return one remote portal company plus important parsed KAP fields.',
      inputSchema: {
        companyId: z.number().int().positive().optional(),
        query: z.string().optional(),
        includeRawData: z.boolean().default(false),
        keys: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ companyId, query, includeRawData, keys }) => {
      const company = await resolveCompany(client, { companyId, query });
      const raw = await client.request<Record<string, unknown>>(`/api/companies/${company.id}/data`);
      const keySet = keys?.length ? new Set(keys) : null;
      const data = keySet
        ? Object.fromEntries(Object.entries(raw).filter(([key]) => keySet.has(key)))
        : raw;

      return jsonResult({
        company: withKapUrl(company),
        summary: compactCompanyData(data),
        rawData: includeRawData || keys?.length ? data : undefined,
        availableKeys: Object.keys(raw),
      });
    },
  );

  server.registerTool(
    'kap_get_rating_sources',
    {
      title: 'Get Rating and News Sources',
      description: 'Return KAP Portal rating/news source status, record counts, refresh status, and source errors.',
      inputSchema: {
        type: z.enum(['rating', 'news']).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async args => jsonResult(await getRatingSources(client, args)),
  );

  server.registerTool(
    'kap_get_company_ratings',
    {
      title: 'Get Company Ratings',
      description: 'Return all credit rating fields for a company, including UVD/long_term_rating, KVD/short_term_rating, outlook, action, sector, dates, age, and report links.',
      inputSchema: {
        company: z.string().min(1).describe('Company name, ticker, or common spelling, e.g. Aygaz.'),
        agency: z.string().optional().describe('Optional rating agency filter, e.g. JCR Eurasia, SAHA Rating.'),
        includeHistory: z.boolean().default(false).describe('When false, returns the latest record per agency.'),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async args => jsonResult(await getCompanyRatings(client, args)),
  );

  server.registerTool(
    'kap_get_company_news',
    {
      title: 'Get Company News',
      description: 'Return KAP Portal news records for a company, including source, title, date, and URL.',
      inputSchema: {
        company: z.string().min(1),
        source: z.string().optional(),
        days: z.number().int().min(1).max(3650).default(90),
        limit: z.number().int().min(1).max(200).default(30),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async args => jsonResult(await getCompanyNews(client, args)),
  );

  server.registerTool(
    'kap_search_rating_news',
    {
      title: 'Search Rating News',
      description: 'Search live/configured KAP Portal news sources for rating, credit, debt, risk, company, or market news.',
      inputSchema: {
        query: z.string().min(1),
        sources: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async args => jsonResult(await searchRatingNews(client, args)),
  );

  server.registerTool(
    'kap_get_company_financial_overview',
    {
      title: 'Get Company Financial Overview',
      description: 'Return one company overview combining KAP profile fields, all rating fields, recent news, and a small relationship graph summary.',
      inputSchema: {
        companyId: z.number().int().positive().optional(),
        query: z.string().optional(),
        includeHistory: z.boolean().default(false),
        includeNews: z.boolean().default(true),
        includeRelationships: z.boolean().default(true),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async args => jsonResult(await getCompanyFinancialOverview(client, args)),
  );

  server.registerTool(
    'kap_find_nodes',
    {
      title: 'Find Graph Nodes',
      description: 'Search company, shareholder, and person nodes in the remote portal relationship graph.',
      inputSchema: {
        query: z.string().min(1),
        type: z.enum(['company', 'shareholder', 'person']).optional(),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, type, limit }) => {
      const graph = await client.getFullGraph();
      const needle = query.toLocaleUpperCase('tr-TR');
      const nodes = graph.nodes
        .filter(node => (!type || node.type === type) && node.label.toLocaleUpperCase('tr-TR').includes(needle))
        .slice(0, limit);
      return jsonResult({ nodes, totalReturned: nodes.length });
    },
  );

  server.registerTool(
    'kap_get_company_relationships',
    {
      title: 'Get Company Relationships',
      description: 'Return a bounded remote portal relationship subgraph for a company.',
      inputSchema: {
        companyId: z.number().int().positive().optional(),
        query: z.string().optional(),
        depth: z.number().int().min(1).max(4).default(2),
        edgeTypes: z.array(z.enum(EDGE_TYPES)).optional(),
        minRatioPct: z.number().min(0).max(100).optional(),
        maxNodes: z.number().int().min(1).max(1000).default(200),
        maxEdges: z.number().int().min(1).max(2000).default(400),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ companyId, query, depth, edgeTypes, minRatioPct, maxNodes, maxEdges }) => {
      const company = await resolveCompany(client, { companyId, query });
      const [subgraph, relationshipSummary] = await Promise.all([
        client.request<GraphData>(`/api/graph/data?company_id=${company.id}&depth=${depth}`),
        client.request<Record<string, unknown>>(`/api/graph/company/${company.id}/summary`),
      ]);
      const filtered = filterGraph(subgraph, {
        rootNodeId: `company_${company.id}`,
        edgeTypes,
        minRatioPct,
        maxNodes,
        maxEdges,
      });
      return jsonResult({
        company: withKapUrl(company),
        depth,
        filters: { edgeTypes, minRatioPct },
        relationshipSummary,
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
        from: z.string().min(1),
        to: z.string().min(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ from, to }) => {
      const source = await resolveNodeRef(client, from);
      const target = await resolveNodeRef(client, to);
      const pathResult = await client.request<{ path: string[]; edges: GraphEdge[]; message?: string }>(
        `/api/graph/path?from=${encodeURIComponent(source.id)}&to=${encodeURIComponent(target.id)}`,
      );
      return jsonResult({
        from: source,
        to: target,
        found: pathResult.path.length > 0,
        message: pathResult.message,
        path: await hydratePath(client, pathResult.path, pathResult.edges),
      });
    },
  );

  server.registerTool(
    'kap_top_relationship_clusters',
    {
      title: 'Top Relationship Clusters',
      description: 'List the largest connected components in the remote portal relationship graph.',
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(10),
        sampleNodesPerCluster: z.number().int().min(1).max(25).default(5),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit, sampleNodesPerCluster }) => {
      const [clusters, graph] = await Promise.all([
        client.request<Array<{ clusterId: number; nodeIds: string[] }>>('/api/graph/clusters'),
        client.getFullGraph(),
      ]);
      const nodeLookup = buildNodeLookup(graph);
      return jsonResult({
        clusters: clusters
          .map(cluster => ({
            clusterId: cluster.clusterId,
            size: cluster.nodeIds.length,
            sampleNodes: cluster.nodeIds.slice(0, sampleNodesPerCluster).map(id => nodeLookup.get(id) ?? { id, label: id }),
          }))
          .sort((a, b) => b.size - a.size)
          .slice(0, limit),
      });
    },
  );

  server.registerTool(
    'kap_rebuild_relationship_graph',
    {
      title: 'Rebuild Relationship Graph',
      description: 'Ask the remote portal to rebuild its in-memory relationship graph cache.',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const result = await client.request<Record<string, unknown>>('/api/graph/rebuild', { method: 'POST' });
      return jsonResult(result);
    },
  );

  server.registerTool(
    'kap_start_kap_processing',
    {
      title: 'Start KAP Processing Batch',
      description: 'Start portal KAP processing for pending/error companies, all companies, or the user member list. Requires confirm=true.',
      inputSchema: {
        scope: z.enum(['pending', 'all', 'members']).default('pending'),
        companyIds: z.array(z.number().int().positive()).optional().describe('Optional explicit company IDs. Used mainly with scope=members.'),
        confirm: z.boolean().default(false),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ scope, companyIds, confirm }) => {
      if (!confirm) {
        return jsonResult({
          status: 'confirmation_required',
          message: 'KAP işlemini başlatmak için aracı confirm=true ile tekrar çağırın.',
          scope,
        });
      }

      const memberIds = scope === 'members' && (!companyIds || companyIds.length === 0)
        ? (await getMemberCompanies(client)).members.map(company => company.id)
        : companyIds;

      const result = await client.request<Record<string, unknown>>('/api/processing/start', {
        method: 'POST',
        body: JSON.stringify({ scope, companyIds: memberIds }),
      });

      return jsonResult({
        ...result,
        note: 'İşlem arka planda çalışır. İlerlemeyi kap_status ile izleyin; başarılı KAP yazımlarından sonra ortaklık ağı otomatik güncellenir.',
      });
    },
  );

  server.registerTool(
    'kap_refresh_company_from_kap',
    {
      title: 'Refresh Company From KAP',
      description: 'Ask the remote portal to fetch one company from kap.org.tr. Requires confirm=true.',
      inputSchema: {
        companyId: z.number().int().positive().optional(),
        query: z.string().optional(),
        confirm: z.boolean().default(false),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ companyId, query, confirm }) => {
      if (!confirm) {
        return jsonResult({
          status: 'confirmation_required',
          message: 'Şirketin KAP verisini yenilemek için aracı confirm=true ile tekrar çağırın.',
        });
      }
      const company = await resolveCompany(client, { companyId, query });
      const result = await client.request<Record<string, unknown>>(`/api/companies/${company.id}/scrape`, { method: 'POST' });
      return jsonResult({ company: withKapUrl(company), ...result });
    },
  );

  return server;
}
