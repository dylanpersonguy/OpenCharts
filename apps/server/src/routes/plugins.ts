import { Router, Request, Response } from 'express';
import { pluginRegistry } from '../services/plugin-registry';
import type { PluginRegistration } from '@opencharts/common';

const router = Router();

/** GET /api/plugins — list all plugins */
router.get('/', (_req: Request, res: Response) => {
  res.json({ plugins: pluginRegistry.list() });
});

/** POST /api/plugins — register a plugin */
router.post('/', (req: Request, res: Response) => {
  const reg = req.body as PluginRegistration;
  if (!reg.manifest?.id || !reg.manifest?.name) {
    res.status(400).json({ error: 'manifest.id and manifest.name are required' });
    return;
  }
  pluginRegistry.register(reg);
  res.status(201).json({ status: 'registered', pluginId: reg.manifest.id });
});

/** POST /api/plugins/:id/disable — disable a plugin */
router.post('/:id/disable', (req: Request, res: Response) => {
  pluginRegistry.disable(req.params.id);
  res.json({ status: 'disabled', pluginId: req.params.id });
});

/** POST /api/plugins/:id/enable — enable a plugin */
router.post('/:id/enable', (req: Request, res: Response) => {
  pluginRegistry.enable(req.params.id);
  res.json({ status: 'enabled', pluginId: req.params.id });
});

/** DELETE /api/plugins/:id — unregister a plugin */
router.delete('/:id', (req: Request, res: Response) => {
  pluginRegistry.unregister(req.params.id);
  res.json({ status: 'unregistered', pluginId: req.params.id });
});

/** GET /api/plugins/indicators — get all indicators from active plugins */
router.get('/indicators', (_req: Request, res: Response) => {
  res.json({ indicators: pluginRegistry.getIndicators() });
});

export default router;
