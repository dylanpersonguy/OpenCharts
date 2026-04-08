import { Router, Request, Response } from 'express';
import { economicCalendar } from '../services/economic-calendar';

const router = Router();

/** GET /api/calendar — economic calendar events with optional filters */
router.get('/', async (req: Request, res: Response) => {
  const { from, to, country, impact } = req.query as Record<string, string | undefined>;

  const events = await economicCalendar.getEvents({ from, to, country, impact });
  res.json({ events });
});

export default router;
