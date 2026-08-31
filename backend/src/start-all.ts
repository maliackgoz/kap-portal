import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const portalPort = process.env.PORT || '8063';
const mcpPort = process.env.MCP_PORT || '8060';
const mcpPath = process.env.MCP_PATH || '/mcp';
const portalUrl = process.env.KAP_PORTAL_URL || `http://127.0.0.1:${portalPort}`;
const ratingPort = process.env.RATING_SERVICE_PORT || '8064';
const ratingUrl = process.env.RATING_SERVICE_URL || `http://127.0.0.1:${ratingPort}`;
const ratingDir = process.env.RATING_SERVICE_DIR || path.join(__dirname, '..', '..', 'rating-service');
const ratingDataDir = process.env.RATING_MCP_DATA_DIR || path.join(ratingDir, 'data');
const ratingPython = process.env.RATING_PYTHON || 'python';
const startRatingService = process.env.START_RATING_SERVICE !== 'false';

const children: ChildProcess[] = [];

function start(name: string, command: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env,
    cwd,
  });

  children.push(child);
  child.on('exit', code => {
    console.error(`${name} exited with code ${code}`);
    shutdown(code ?? 1);
  });
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

if (startRatingService) {
  console.log(`Starting Rating Service on http://0.0.0.0:${ratingPort}`);
  start('rating-service', ratingPython, ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', ratingPort], {
    ...process.env,
    RATING_MCP_DATA_DIR: ratingDataDir,
  }, ratingDir);
}

console.log(`Starting Finansal Portal on http://0.0.0.0:${portalPort}`);
console.log(`Starting Finansal Portal MCP on http://0.0.0.0:${mcpPort}${mcpPath}`);
console.log(`MCP will read portal API from ${portalUrl}`);

start('kap-portal', process.execPath, [path.join(__dirname, 'index.js')], {
  ...process.env,
  PORT: portalPort,
  RATING_SERVICE_URL: ratingUrl,
});

start('kap-mcp', process.execPath, [path.join(__dirname, 'mcp-http.js')], {
  ...process.env,
  MCP_PORT: mcpPort,
  MCP_PATH: mcpPath,
  KAP_PORTAL_URL: portalUrl,
  KAP_PORTAL_USERNAME: process.env.KAP_PORTAL_USERNAME || process.env.ADMIN_USER || 'admin',
  KAP_PORTAL_PASSWORD: process.env.KAP_PORTAL_PASSWORD || process.env.ADMIN_PASS || '',
});
