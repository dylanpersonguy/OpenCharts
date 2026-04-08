import { Router, Request, Response } from 'express';
import { transpile, TargetLanguage } from '@opencharts/pine-transpiler';
import { logger } from '../services/logger';

const router = Router();

/**
 * POST /api/transpile
 * Body: { source: string, target: 'typescript' | 'python' }
 * Returns: { code: string, version: number | null, target: string }
 */
router.post('/', (req: Request, res: Response) => {
  const { source, target } = req.body;

  if (!source || typeof source !== 'string') {
    return res.status(400).json({ error: 'source is required and must be a string' });
  }

  const validTargets: TargetLanguage[] = ['typescript', 'python'];
  if (!target || !validTargets.includes(target)) {
    return res.status(400).json({ error: `target must be one of: ${validTargets.join(', ')}` });
  }

  try {
    const result = transpile(source, target);
    return res.json(result);
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Transpile error');
    return res.status(422).json({ error: err.message });
  }
});

export default router;
