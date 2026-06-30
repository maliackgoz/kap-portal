const BASE = '/api';

export interface LoginResponse {
  token: string;
  username: string;
}

export interface Company {
  id: number;
  name: string;
  slug: string;
  oid: string;
  ticker?: string | null;
  status: string;
  last_processed_at: string | null;
  last_log_action?: string | null;
  last_log_message?: string | null;
  last_log_created_at?: string | null;
  created_at?: string;
}

export interface DashboardStats {
  total: number;
  processed: number;
  errors: number;
  pending: number;
  no_data: number;
}

export interface ActivityLog {
  id: number;
  action: string;
  message: string | null;
  created_at: string;
  company_name: string | null;
  company_slug: string | null;
}

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

export interface GraphPath {
  path: string[];
  edges: GraphEdge[];
  message?: string;
}

export interface GraphCluster {
  clusterId: number;
  nodeIds: string[];
}

export interface RatingRow {
  company: string;
  agency: string;
  rating_date: string | null;
  long_term_rating: string | null;
  short_term_rating: string | null;
  national_rating?: string | null;
  outlook: string | null;
  sector: string | null;
  action: string | null;
  source_url: string | null;
  report_url: string | null;
  pdf_url: string | null;
  matched_name?: string | null;
  provider_status?: 'FOUND' | 'NO_MATCH' | 'LOGIN_REQUIRED' | 'BLOCKED' | 'SUBSCRIPTION_REQUIRED' | 'PARSE_ERROR';
  confidence?: number | null;
  error_message?: string | null;
  fetched_at?: string | null;
  extracted_at: string;
  rating_age_days: number | null;
  rating_is_old: boolean;
  freshness_note: string | null;
}

export interface RatingNewsRow {
  company: string | null;
  source: string;
  title: string;
  url: string | null;
  published_at: string | null;
  summary: string | null;
  event_type: string | null;
  risk_level: string | null;
  matched_keywords: string[];
  extracted_at: string;
}

export interface RatingSource {
  key: string;
  name: string;
  type: 'rating' | 'news';
  enabled: boolean;
  last_status: string | null;
  last_refresh: string | null;
  last_errors: string[];
  record_count: number;
  report_count: number;
  status_counts?: Record<string, number>;
  searched_count?: number;
  found_count?: number;
  no_match_count?: number;
  login_required_count?: number;
  subscription_required_count?: number;
  blocked_count?: number;
  parse_error_count?: number;
  display_status: string;
  status_class: string;
}

export interface RatingRunLog {
  source: string;
  status: string;
  records_found: number;
  records_added: number;
  records_updated: number;
  started_at: string;
  finished_at: string | null;
  errors: string[];
}

export interface RatingResponse<T> {
  summary: string;
  data: T[];
  missing?: boolean;
  stale?: boolean;
  old_rating_count?: number;
  source_errors?: string[];
}

function getToken() {
  return localStorage.getItem('kap_token');
}

export function setToken(token: string) {
  localStorage.setItem('kap_token', token);
}

export function clearToken() {
  localStorage.removeItem('kap_token');
}

export function isAuthenticated() {
  return !!getToken();
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error('Oturum suresi doldu');
  }

  if (!res.ok) {
    const data = await res.json().catch((): Record<string, unknown> => ({}));
    throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  login: (username: string, password: string) =>
    request<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),

  getStats: () => request<DashboardStats>('/dashboard/stats'),
  getActivity: () => request<ActivityLog[]>('/dashboard/activity'),

  getCompanies: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<{ companies: Company[]; total: number; page: number; pages: number }>(`/companies${qs}`);
  },
  getCompany: (id: number) => request<Company>(`/companies/${id}`),
  getCompanyData: (id: number) => request<Record<string, unknown>>(`/companies/${id}/data`),
  scrapeCompany: (id: number) => request<{ status: string; message?: string; keys?: number }>(`/companies/${id}/scrape`, { method: 'POST' }),
  getAllCompanies: () => request<Company[]>('/companies/all/list'),

  getMembers: () => request<{ members: Company[] }>('/members'),
  setMembers: (companyIds: number[]) =>
    request<{ members: Company[] }>('/members', {
      method: 'PUT',
      body: JSON.stringify({ companyIds }),
    }),
  addMember: (id: number) => request<{ members: Company[] }>(`/members/${id}`, { method: 'POST' }),
  removeMember: (id: number) => request<{ members: Company[] }>(`/members/${id}`, { method: 'DELETE' }),

  startProcessing: (scope: 'pending' | 'all' | 'members' = 'pending', companyIds?: number[]) =>
    request<{ message: string; scope: 'pending' | 'all' | 'members'; companyIds?: number[] }>('/processing/start', {
      method: 'POST',
      body: JSON.stringify({ scope, companyIds }),
    }),
  stopProcessing: () => request<{ status: string }>('/processing/stop', { method: 'POST' }),
  getProcessingState: () => request<Record<string, unknown>>('/processing/state'),

  getGraphData: (companyId?: number, depth?: number) => {
    const params = new URLSearchParams();
    if (companyId) params.set('company_id', String(companyId));
    if (depth) params.set('depth', String(depth));
    const qs = params.toString();
    return request<GraphData>(`/graph/data${qs ? '?' + qs : ''}`);
  },
  getGraphStats: () => request<GraphStats>('/graph/stats'),
  rebuildGraph: () => request<{ message: string; nodes: number; edges: number }>('/graph/rebuild', { method: 'POST' }),
  getGraphPath: (fromId: string, toId: string) =>
    request<GraphPath>(`/graph/path?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`),
  getGraphClusters: () => request<GraphCluster[]>('/graph/clusters'),
  getGraphSectors: () => request<string[]>('/graph/sectors'),

  getRatingSources: () => request<RatingResponse<RatingSource>>('/rating/sources'),
  getRatings: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<RatingResponse<RatingRow>>(`/rating/ratings${qs}`);
  },
  getRatingNews: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<RatingResponse<RatingNewsRow>>(`/rating/news${qs}`);
  },
  searchRatingNews: (params: { q: string; sources?: string[]; limit?: string }) => {
    const qs = new URLSearchParams();
    qs.set('q', params.q);
    if (params.limit) qs.set('limit', params.limit);
    (params.sources || []).forEach(source => qs.append('sources', source));
    return request<RatingResponse<RatingNewsRow>>(`/rating/news/search?${qs.toString()}`);
  },
  getRatingRunLog: (limit = 20) => request<RatingResponse<RatingRunLog>>(`/rating/run-log?limit=${limit}`),
  refreshRatings: (sources?: string[]) =>
    request<RatingResponse<RatingRunLog>>('/rating/refresh', {
      method: 'POST',
      body: JSON.stringify({ sources, force: true }),
    }),
};
