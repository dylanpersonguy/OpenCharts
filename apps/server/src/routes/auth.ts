import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq, or } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/drizzle';
import { users, userPreferences } from '../db/schema';
import { logger } from '../services/logger';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

router.post('/register', async (req: Request, res: Response) => {
  const { email, username, password } = req.body;
  if (!email || !username || !password) {
    res.status(400).json({ error: 'email, username, and password are required' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  try {
    const existing = await db.select({ id: users.id })
      .from(users)
      .where(or(eq(users.email, email), eq(users.username, username)))
      .limit(1);
    if (existing.length) {
      res.status(409).json({ error: 'User already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await db.insert(users)
      .values({ email, username, passwordHash })
      .returning({ id: users.id, email: users.email, username: users.username, createdAt: users.createdAt });

    await db.insert(userPreferences).values({ userId: user.id });

    const token = jwt.sign({ userId: user.id }, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    } as jwt.SignOptions);

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    logger.error(err, 'Registration error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  try {
    const [user] = await db.select({
      id: users.id,
      email: users.email,
      username: users.username,
      passwordHash: users.passwordHash,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.email, email)).limit(1);

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign({ userId: user.id }, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    } as jwt.SignOptions);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    logger.error(err, 'Login error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const [user] = await db.select({
      id: users.id,
      email: users.email,
      username: users.username,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    }).from(users).where(eq(users.id, req.userId!)).limit(1);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch (err) {
    logger.error(err, 'Get me error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
