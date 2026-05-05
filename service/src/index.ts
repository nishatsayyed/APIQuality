import express, { Request, Response, NextFunction } from 'express';
import scoreRouter from './routes/score';

const app = express();

// Parsers: accept JSON, YAML, and plain text bodies up to 10 MB.
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: ['text/*', 'application/x-yaml', 'application/yaml'], limit: '10mb' }));

app.get('/', (_req, res) => {
  res.json({
    name: 'api-quality-score-service',
    description:
      'Compute API quality scores for Postman v3 collections. POST a v3 collection (JSON or YAML) to /score.',
    endpoints: [
      { method: 'GET', path: '/health', description: 'Health probe' },
      { method: 'GET', path: '/score/categories', description: 'List scoring categories & weights' },
      { method: 'POST', path: '/score', description: 'Full quality report for a v3 collection' },
      { method: 'POST', path: '/score/summary', description: 'Compact summary of the quality score' },
    ],
  });
});

app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use(scoreRouter);

// Centralized error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

const port = Number(process.env.PORT ?? 3000);
if (require.main === module) {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`api-quality-score-service listening on http://localhost:${port}`);
  });
}

export default app;
