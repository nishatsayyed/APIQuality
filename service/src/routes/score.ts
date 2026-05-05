import { Router, Request, Response } from 'express';
import { parseCollection, InputFormat } from '../parser/parseCollection';
import { computeQualityReport } from '../scoring/engine';

const router = Router();

/**
 * POST /score
 * Accepts a Postman v3 collection and returns a full quality report.
 *
 * Content-Type can be:
 *   - application/json                      -> raw JSON collection body
 *   - application/x-yaml / text/yaml / text/plain -> raw YAML body
 *   - application/json with { "collection": <string or object>, "format": "json"|"yaml"|"auto" }
 */
router.post('/score', (req: Request, res: Response) => {
  try {
    const { rawBody, format } = extractPayload(req);
    const { collection, format: detected } = parseCollection(rawBody, format);
    const report = computeQualityReport(collection);
    res.json({ inputFormat: detected, report });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: 'Failed to compute score', details: message });
  }
});

/**
 * POST /score/summary
 * Same input as /score, but returns only overall score + grade + per-category scores.
 */
router.post('/score/summary', (req: Request, res: Response) => {
  try {
    const { rawBody, format } = extractPayload(req);
    const { collection } = parseCollection(rawBody, format);
    const report = computeQualityReport(collection);
    res.json({
      collectionName: report.collectionName,
      overallScore: report.overallScore,
      grade: report.grade,
      summary: report.summary,
      categories: report.categories.map((c) => ({
        id: c.id,
        label: c.label,
        weight: c.weight,
        score: c.score,
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: 'Failed to compute score', details: message });
  }
});

/**
 * GET /score/categories
 * Returns metadata about the scoring categories (for UI / docs).
 */
router.get('/score/categories', (_req, res) => {
  res.json({
    categories: [
      { id: 'endpoint_structure', label: 'Endpoint Structure & Naming', weight: 0.15 },
      { id: 'annotations', label: 'Parameter & Description Annotations', weight: 0.15 },
      { id: 'auth', label: 'Authentication & Security', weight: 0.2 },
      { id: 'best_practices', label: 'Best Practices (variables, examples, consistency)', weight: 0.2 },
      { id: 'tests', label: 'Tests & Coverage', weight: 0.2 },
      { id: 'documentation', label: 'Documentation Depth', weight: 0.1 },
    ],
    gradeBands: [
      { grade: 'A', min: 90 },
      { grade: 'B', min: 75 },
      { grade: 'C', min: 60 },
      { grade: 'D', min: 40 },
      { grade: 'F', min: 0 },
    ],
  });
});

function extractPayload(req: Request): { rawBody: string; format: InputFormat } {
  const ct = (req.headers['content-type'] ?? '').toString().toLowerCase();

  // If an Express JSON parser already turned this into an object...
  if (ct.includes('application/json') && typeof req.body === 'object' && req.body !== null) {
    const body = req.body as Record<string, unknown>;
    if (typeof body.collection === 'string') {
      const fmt = (body.format as InputFormat) ?? 'auto';
      return { rawBody: body.collection, format: fmt };
    }
    if (body.collection && typeof body.collection === 'object') {
      return { rawBody: JSON.stringify(body.collection), format: 'json' };
    }
    // Treat the whole body as the collection object.
    return { rawBody: JSON.stringify(body), format: 'json' };
  }

  // Raw text bodies (YAML, etc.) - req.body will be a string thanks to text parsers.
  if (typeof req.body === 'string') {
    if (ct.includes('yaml')) return { rawBody: req.body, format: 'yaml' };
    if (ct.includes('json')) return { rawBody: req.body, format: 'json' };
    return { rawBody: req.body, format: 'auto' };
  }

  throw new Error('Unsupported or empty request body. Send JSON or YAML collection.');
}

export default router;
