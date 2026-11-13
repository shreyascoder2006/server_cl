import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { loadUser } from './auth.ts';
import { HttpError } from './errors.ts';
import { log } from './log.ts';
import { adminRouter } from './routes/admin.ts';
import { storeRouter } from './routes/store.ts';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  // Webhooks need the raw body for signature checks; everything else is JSON.
  app.use('/api/payments/webhook', express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(loadUser);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/admin', adminRouter);
  app.use('/api', storeRouter);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));

  // Serve the built frontend when present (npm start).
  const dist = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid input.', details: err.issues });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON.' });
    log.error('unhandled_error', { path: req.path, error: String(err?.message ?? err), stack: err?.stack });
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  });
  return app;
}
