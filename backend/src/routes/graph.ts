import { Router } from 'express';
import { getGraph, getSubgraph, getStats, buildGraph, invalidateCache, findPath, getClusters, getSectors } from '../services/graph-builder.js';

const router = Router();

// GET /api/graph/data — full graph or subgraph for a specific company
router.get('/data', (req, res) => {
  try {
    const companyId = req.query.company_id ? parseInt(req.query.company_id as string) : null;

    if (companyId) {
      let depth = parseInt(req.query.depth as string) || 2;
      if (depth < 1) depth = 1;
      if (depth > 4) depth = 4;
      const subgraph = getSubgraph(companyId, depth);
      res.json(subgraph);
    } else {
      const graph = getGraph();
      res.json(graph);
    }
  } catch (err: any) {
    console.error('Graph data error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/graph/path — shortest path between two nodes
router.get('/path', (req, res) => {
  try {
    const from = req.query.from as string;
    const to = req.query.to as string;
    if (!from || !to) {
      res.status(400).json({ error: 'from and to parameters required' });
      return;
    }
    const result = findPath(from, to);
    if (result) {
      res.json(result);
    } else {
      res.json({ path: [], edges: [], message: 'Baglanti bulunamadi' });
    }
  } catch (err: any) {
    console.error('Graph path error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/graph/clusters — connected components
router.get('/clusters', (_req, res) => {
  try {
    const clusters = getClusters();
    res.json(clusters);
  } catch (err: any) {
    console.error('Graph clusters error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/graph/sectors — unique sector list
router.get('/sectors', (_req, res) => {
  try {
    const sectors = getSectors();
    res.json(sectors);
  } catch (err: any) {
    console.error('Graph sectors error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/graph/stats
router.get('/stats', (_req, res) => {
  try {
    const stats = getStats();
    res.json(stats);
  } catch (err: any) {
    console.error('Graph stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/graph/rebuild — force rebuild
router.post('/rebuild', (_req, res) => {
  try {
    invalidateCache();
    const graph = buildGraph();
    res.json({
      message: 'Graph yeniden olusturuldu',
      nodes: graph.nodes.length,
      edges: graph.edges.length,
    });
  } catch (err: any) {
    console.error('Graph rebuild error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
