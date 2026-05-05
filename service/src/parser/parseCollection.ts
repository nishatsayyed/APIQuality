import YAML from 'yaml';
import { V3Collection, V3Item, V3Request, FlatEndpoint } from '../types/collection';
import { descriptionToString, joinScript } from '../utils/text';

export type InputFormat = 'json' | 'yaml' | 'auto';

export interface ParseResult {
  collection: V3Collection;
  format: 'json' | 'yaml';
}

/**
 * Parse a raw string body (JSON or YAML) into a v3 Collection structure.
 * If `format` is 'auto', we try JSON first and fall back to YAML.
 */
export function parseCollection(raw: string, format: InputFormat = 'auto'): ParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Empty collection payload');
  }

  const tryJson = (): V3Collection => {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('JSON payload is not an object');
    }
    return parsed as V3Collection;
  };

  const tryYaml = (): V3Collection => {
    const parsed = YAML.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('YAML payload is not an object');
    }
    return parsed as V3Collection;
  };

  if (format === 'json') return { collection: tryJson(), format: 'json' };
  if (format === 'yaml') return { collection: tryYaml(), format: 'yaml' };

  // auto
  try {
    return { collection: tryJson(), format: 'json' };
  } catch {
    return { collection: tryYaml(), format: 'yaml' };
  }
}

/**
 * Walk the collection tree and produce a flat list of request endpoints.
 * Folders are not endpoints; only leaves that carry a `request` are.
 */
export function flattenEndpoints(collection: V3Collection): FlatEndpoint[] {
  const endpoints: FlatEndpoint[] = [];

  const walk = (
    items: V3Item[] | undefined,
    breadcrumb: string[],
    inheritedAuth: V3Collection['auth']
  ): void => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const name = (item.name ?? '').toString();
      const currentPath = [...breadcrumb, name];
      const effectiveAuth = item.auth ?? inheritedAuth;

      if (Array.isArray(item.item)) {
        // folder
        walk(item.item, currentPath, effectiveAuth);
        continue;
      }

      if (item.request) {
        const req: V3Request =
          typeof item.request === 'string'
            ? { method: 'GET', url: item.request }
            : item.request;

        const tests: string[] = [];
        const pres: string[] = [];
        for (const ev of item.event ?? []) {
          if (ev.disabled) continue;
          const body = joinScript(ev.script?.exec);
          if (!body) continue;
          if (ev.listen === 'test') tests.push(body);
          else if (ev.listen === 'prerequest') pres.push(body);
        }

        endpoints.push({
          path: currentPath,
          name: name || (typeof req.url === 'string' ? req.url : req.url?.raw ?? 'unnamed'),
          method: (req.method ?? 'GET').toUpperCase(),
          url: req.url,
          request: req,
          item,
          effectiveAuth: (req.auth ?? effectiveAuth) as V3Collection['auth'],
          tests,
          preRequests: pres,
          examples: Array.isArray(item.response) ? item.response : [],
          description: descriptionToString(
            (req.description ?? item.description) as string | { content?: string } | undefined
          ),
        });
      }
    }
  };

  walk(collection.item, [], collection.auth);
  return endpoints;
}
