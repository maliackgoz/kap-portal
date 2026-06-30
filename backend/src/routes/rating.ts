import { Router, type Request, type Response } from 'express';

const router = Router();

const RATING_SERVICE_URL = process.env.RATING_SERVICE_URL || 'http://127.0.0.1:8064';
const RATING_SERVICE_API_KEY = process.env.RATING_SERVICE_API_KEY;

function queryString(req: Request) {
  const index = req.originalUrl.indexOf('?');
  return index >= 0 ? req.originalUrl.slice(index) : '';
}

async function proxyRating(req: Request, res: Response, upstreamPath: string) {
  const target = new URL(`${upstreamPath}${queryString(req)}`, RATING_SERVICE_URL);
  const headers: Record<string, string> = {
    Accept: req.get('accept') || 'application/json',
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
  }
  if (RATING_SERVICE_API_KEY) {
    headers.Authorization = `Bearer ${RATING_SERVICE_API_KEY}`;
  }

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : JSON.stringify(req.body ?? {}),
    });

    const contentType = upstream.headers.get('content-type');
    const disposition = upstream.headers.get('content-disposition');
    if (contentType) res.setHeader('Content-Type', contentType);
    if (disposition) res.setHeader('Content-Disposition', disposition);

    const body = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).send(body);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Bilinmeyen hata';
    res.status(503).json({
      error: 'Rating servisine ulasilamadi',
      detail,
      serviceUrl: RATING_SERVICE_URL,
    });
  }
}

router.get('/health', (req, res) => proxyRating(req, res, '/health'));
router.get('/sources', (req, res) => proxyRating(req, res, '/api/sources'));
router.get('/ratings', (req, res) => proxyRating(req, res, '/api/ratings'));
router.get('/news/search', (req, res) => proxyRating(req, res, '/api/news/search'));
router.get('/news', (req, res) => proxyRating(req, res, '/api/news'));
router.get('/search', (req, res) => proxyRating(req, res, '/api/search'));
router.get('/run-log', (req, res) => proxyRating(req, res, '/api/run-log'));
router.post('/refresh', (req, res) => proxyRating(req, res, '/api/refresh'));
router.post('/refresh/fitch', (req, res) => proxyRating(req, res, '/api/refresh/fitch'));
router.post('/refresh/spglobal', (req, res) => proxyRating(req, res, '/api/refresh/spglobal'));
router.post('/refresh/moodys', (req, res) => proxyRating(req, res, '/api/refresh/moodys'));
router.get('/export/latest.csv', (req, res) => proxyRating(req, res, '/api/export/latest.csv'));
router.get('/export/latest.md', (req, res) => proxyRating(req, res, '/api/export/latest.md'));
router.get('/company/:companyName', (req, res) => (
  proxyRating(req, res, `/api/ratings/company/${encodeURIComponent(req.params.companyName)}`)
));
router.get('/sector/:sectorName', (req, res) => (
  proxyRating(req, res, `/api/ratings/sector/${encodeURIComponent(req.params.sectorName)}`)
));

export default router;
