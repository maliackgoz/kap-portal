import { Router } from 'express';
import { startProcessing, stopProcessing, getState, addSSEClient, type ProcessingScope } from '../services/processor.js';

const router = Router();

router.post('/start', async (req, res) => {
  const state = getState();
  if (state.running) {
    res.status(409).json({ error: 'Zaten calisiyor' });
    return;
  }

  const requestedScope = req.body?.scope;
  const scope: ProcessingScope = requestedScope === 'all' || requestedScope === 'members' ? requestedScope : 'pending';
  const companyIds: number[] = Array.isArray(req.body?.companyIds)
    ? Array.from(new Set((req.body.companyIds as unknown[]).map(Number).filter(id => Number.isFinite(id) && id > 0)))
    : [];

  if (scope === 'members' && companyIds.length === 0) {
    res.status(400).json({ error: 'Uye sirket secimi bos' });
    return;
  }

  // Start async, don't await
  startProcessing(scope, companyIds).catch(err => console.error('Batch error:', err));
  res.json({ message: 'Baslatildi', scope, companyIds });
});

router.post('/stop', (_req, res) => {
  stopProcessing();
  res.json({ message: 'Durduruluyor...' });
});

router.get('/state', (_req, res) => {
  res.json(getState());
});

router.get('/events', (req, res) => {
  addSSEClient(res);
});

export default router;
