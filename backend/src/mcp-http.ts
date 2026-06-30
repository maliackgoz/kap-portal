import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { createPortalMcpServer, PortalClient } from './portal-mcp.js';

const MCP_PORT = Number(process.env.MCP_PORT || 8060);
const MCP_PATH = process.env.MCP_PATH || '/mcp';
const PORTAL_URL = process.env.KAP_PORTAL_URL || 'http://172.30.146.31:3011';
const PORTAL_USERNAME = process.env.KAP_PORTAL_USERNAME || 'admin';
const PORTAL_PASSWORD = process.env.KAP_PORTAL_PASSWORD || 'kap2024';
const DEFAULT_ALLOWED_HOSTS = ['localhost', '127.0.0.1', '::1', '0.0.0.0', '172.30.146.31'];
const MCP_ALLOWED_HOSTS = (process.env.MCP_ALLOWED_HOSTS || DEFAULT_ALLOWED_HOSTS.join(','))
  .split(',')
  .map(host => host.trim())
  .filter(Boolean);

const portal = new PortalClient({
  baseUrl: PORTAL_URL,
  username: PORTAL_USERNAME,
  password: PORTAL_PASSWORD,
});

const app = createMcpExpressApp({ allowedHosts: MCP_ALLOWED_HOSTS });

app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  next();
});

app.get('/health', async (_req, res) => {
  try {
    await portal.login();
    res.json({ ok: true, mcpPath: MCP_PATH, portal: portal.baseUrl });
  } catch (error) {
    res.status(502).json({
      ok: false,
      mcpPath: MCP_PATH,
      portal: portal.baseUrl,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post(MCP_PATH, async (req, res) => {
  const server = createPortalMcpServer(portal);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
  } catch (error) {
    console.error('MCP request failed:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal server error',
        },
        id: null,
      });
    }
  }
});

app.get(MCP_PATH, (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Use Streamable HTTP POST for this MCP endpoint.' },
    id: null,
  });
});

app.delete(MCP_PATH, (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Stateless MCP endpoint has no session to delete.' },
    id: null,
  });
});

app.listen(MCP_PORT, error => {
  if (error) {
    console.error('Failed to start KAP Portal MCP HTTP server:', error);
    process.exit(1);
  }
  console.log(`KAP Portal MCP HTTP server: http://0.0.0.0:${MCP_PORT}${MCP_PATH}`);
  console.log(`Remote KAP Portal API: ${portal.baseUrl}`);
  console.log(`Allowed MCP hosts: ${MCP_ALLOWED_HOSTS.join(', ')}`);
});
