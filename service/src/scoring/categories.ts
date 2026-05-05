import { V3Collection, V3Url, V3Header } from '../types/collection';
import { FlatEndpoint } from '../types/collection';
import { descriptionToString, isNonEmpty, pct, clamp } from '../utils/text';

export interface CategoryResult {
  id: string;
  label: string;
  weight: number; // 0..1
  score: number; // 0..100
  maxScore: 100;
  findings: Finding[];
  metrics: Record<string, number | string | boolean>;
}

export interface Finding {
  level: 'info' | 'warn' | 'error';
  message: string;
  path?: string;
}

function rawUrl(url: V3Url | string | undefined): string {
  if (!url) return '';
  if (typeof url === 'string') return url;
  if (url.raw) return url.raw;
  const host = Array.isArray(url.host) ? url.host.join('.') : url.host ?? '';
  const path = Array.isArray(url.path) ? url.path.join('/') : url.path ?? '';
  return `${url.protocol ? url.protocol + '://' : ''}${host}${path ? '/' + path : ''}`;
}

function getPathSegments(url: V3Url | string | undefined): string[] {
  if (!url) return [];
  if (typeof url === 'string') {
    try {
      const u = new URL(url.includes('://') ? url : 'http://x/' + url.replace(/^\/+/, ''));
      return u.pathname.split('/').filter(Boolean);
    } catch {
      return url.split('?')[0].split('/').filter(Boolean);
    }
  }
  if (Array.isArray(url.path)) return url.path.filter(Boolean);
  if (typeof url.path === 'string') return url.path.split('/').filter(Boolean);
  return [];
}

function getQueryParams(url: V3Url | string | undefined) {
  if (!url || typeof url === 'string') return [];
  return url.query ?? [];
}

function getPathVariables(url: V3Url | string | undefined) {
  if (!url || typeof url === 'string') return [];
  return url.variable ?? [];
}

// ---------- Category scorers ----------

/** 1. Endpoint structure & naming. */
export function scoreEndpointStructure(
  collection: V3Collection,
  endpoints: FlatEndpoint[]
): CategoryResult {
  const findings: Finding[] = [];
  if (endpoints.length === 0) {
    return {
      id: 'endpoint_structure',
      label: 'Endpoint Structure & Naming',
      weight: 0.15,
      score: 0,
      maxScore: 100,
      findings: [{ level: 'error', message: 'Collection has no endpoints.' }],
      metrics: { endpoints: 0 },
    };
  }

  let namedWell = 0;
  let hasMethod = 0;
  let hasUrl = 0;
  let restfulPath = 0;
  let nonTrivialDepth = 0;
  const methodCounts: Record<string, number> = {};

  for (const ep of endpoints) {
    const p = ep.path.join(' / ');
    if (isNonEmpty(ep.name) && !/^(new request|untitled|copy of)/i.test(ep.name)) namedWell++;
    else findings.push({ level: 'warn', message: `Endpoint has weak/default name`, path: p });

    if (isNonEmpty(ep.method)) hasMethod++;
    const url = rawUrl(ep.url);
    if (isNonEmpty(url)) hasUrl++;
    else findings.push({ level: 'error', message: 'Endpoint is missing a URL', path: p });

    methodCounts[ep.method] = (methodCounts[ep.method] ?? 0) + 1;

    const segs = getPathSegments(ep.url);
    if (segs.length >= 1) nonTrivialDepth++;
    // RESTful: no verbs in path, uses nouns, uses :param or {var} for ids
    const verbyPath = segs.some((s) => /^(get|create|update|delete|fetch|list|do)[_-]?/i.test(s));
    if (!verbyPath && segs.length > 0) restfulPath++;
    else if (verbyPath) {
      findings.push({
        level: 'warn',
        message: `Path contains a verb segment; prefer nouns + HTTP methods`,
        path: p,
      });
    }
  }

  const namedScore = pct(namedWell, endpoints.length);
  const methodScore = pct(hasMethod, endpoints.length);
  const urlScore = pct(hasUrl, endpoints.length);
  const restScore = pct(restfulPath, endpoints.length);
  const depthScore = pct(nonTrivialDepth, endpoints.length);

  const score =
    100 *
    (0.25 * namedScore + 0.2 * methodScore + 0.25 * urlScore + 0.2 * restScore + 0.1 * depthScore);

  return {
    id: 'endpoint_structure',
    label: 'Endpoint Structure & Naming',
    weight: 0.15,
    score: Math.round(score),
    maxScore: 100,
    findings,
    metrics: {
      endpoints: endpoints.length,
      wellNamed: namedWell,
      withMethod: hasMethod,
      withUrl: hasUrl,
      restfulPaths: restfulPath,
    },
  };
}

/** 2. Parameter & header annotations (descriptions, examples). */
export function scoreAnnotations(endpoints: FlatEndpoint[]): CategoryResult {
  const findings: Finding[] = [];
  let totalParams = 0;
  let describedParams = 0;

  for (const ep of endpoints) {
    const p = ep.path.join(' / ');
    const headers: V3Header[] = ep.request?.header ?? [];
    const query = getQueryParams(ep.url);
    const pathVars = getPathVariables(ep.url);
    const formItems =
      ep.request?.body?.mode === 'urlencoded'
        ? ep.request?.body?.urlencoded ?? []
        : ep.request?.body?.mode === 'formdata'
        ? ep.request?.body?.formdata ?? []
        : [];

    const checkList = [
      ...headers.map((h) => ({ label: `header ${h.key}`, desc: h.description, disabled: h.disabled })),
      ...query.map((q) => ({ label: `query ${q.key}`, desc: q.description, disabled: q.disabled })),
      ...pathVars.map((v) => ({ label: `pathVar ${v.key}`, desc: v.description, disabled: false })),
      ...formItems.map((f) => ({ label: `body ${f.key}`, desc: f.description, disabled: (f as any).disabled })),
    ];

    for (const it of checkList) {
      if (it.disabled) continue;
      totalParams++;
      const d = descriptionToString(it.desc as any);
      if (isNonEmpty(d)) describedParams++;
      else findings.push({ level: 'info', message: `Missing description for ${it.label}`, path: p });
    }

    if (!isNonEmpty(ep.description)) {
      findings.push({ level: 'warn', message: 'Endpoint has no description', path: p });
    }
  }

  const describedEndpoints = endpoints.filter((e) => isNonEmpty(e.description)).length;
  const endpointDescScore = pct(describedEndpoints, endpoints.length);
  const paramScore = totalParams === 0 ? 1 : pct(describedParams, totalParams);

  const score = 100 * (0.5 * endpointDescScore + 0.5 * paramScore);

  return {
    id: 'annotations',
    label: 'Parameter & Description Annotations',
    weight: 0.15,
    score: Math.round(score),
    maxScore: 100,
    findings,
    metrics: {
      totalParams,
      describedParams,
      endpointsWithDescription: describedEndpoints,
    },
  };
}

/** 3. Authentication & security hygiene. */
export function scoreAuth(collection: V3Collection, endpoints: FlatEndpoint[]): CategoryResult {
  const findings: Finding[] = [];
  const collectionAuth = collection.auth?.type;
  let withAuth = 0;
  let hardcodedCreds = 0;
  let insecureScheme = 0;

  for (const ep of endpoints) {
    const p = ep.path.join(' / ');
    const authType = ep.effectiveAuth?.type ?? collectionAuth;
    if (authType && authType !== 'noauth') withAuth++;

    // Look for hardcoded secrets in headers or URL
    const headers = ep.request?.header ?? [];
    for (const h of headers) {
      if (h.disabled) continue;
      if (/authorization|api[-_]?key|token|secret/i.test(h.key ?? '')) {
        const v = h.value ?? '';
        const looksTemplated = /\{\{.+?\}\}/.test(v);
        if (v && !looksTemplated) {
          hardcodedCreds++;
          findings.push({
            level: 'error',
            message: `Header "${h.key}" appears to contain a hardcoded secret; use {{variables}}`,
            path: p,
          });
        }
      }
    }

    const url = rawUrl(ep.url);
    if (/^http:\/\//i.test(url) && !/localhost|127\.0\.0\.1/.test(url)) {
      insecureScheme++;
      findings.push({ level: 'warn', message: 'Endpoint uses http:// instead of https://', path: p });
    }
  }

  const authCoverage = pct(withAuth, endpoints.length);
  const credSafety = 1 - pct(hardcodedCreds, endpoints.length);
  const transport = 1 - pct(insecureScheme, endpoints.length);
  const collectionLevel = collectionAuth && collectionAuth !== 'noauth' ? 1 : 0.6;

  if (!collectionAuth || collectionAuth === 'noauth') {
    findings.push({
      level: 'info',
      message:
        'No collection-level auth configured. Consider defining auth at the collection level for consistency.',
    });
  }

  const score = 100 * (0.4 * authCoverage + 0.3 * credSafety + 0.2 * transport + 0.1 * collectionLevel);
  return {
    id: 'auth',
    label: 'Authentication & Security',
    weight: 0.2,
    score: Math.round(score),
    maxScore: 100,
    findings,
    metrics: {
      collectionAuth: collectionAuth ?? 'none',
      endpointsWithAuth: withAuth,
      hardcodedCredentials: hardcodedCreds,
      insecureSchemeEndpoints: insecureScheme,
    },
  };
}

/** 4. Best practices (variables, consistency, examples). */
export function scoreBestPractices(
  collection: V3Collection,
  endpoints: FlatEndpoint[]
): CategoryResult {
  const findings: Finding[] = [];

  const vars = collection.variable ?? [];
  const hasCollectionVars = vars.length > 0;
  if (!hasCollectionVars) {
    findings.push({
      level: 'info',
      message: 'No collection variables defined. Use {{baseUrl}} and other vars to reduce duplication.',
    });
  }

  // baseUrl usage
  const hostCounts: Record<string, number> = {};
  let endpointsUsingVars = 0;
  for (const ep of endpoints) {
    const url = rawUrl(ep.url);
    if (/\{\{.+?\}\}/.test(url)) endpointsUsingVars++;
    try {
      const parsed = new URL(url.includes('://') ? url : 'http://placeholder/' + url);
      const host = parsed.host;
      if (host && host !== 'placeholder') {
        hostCounts[host] = (hostCounts[host] ?? 0) + 1;
      }
    } catch {
      // ignore
    }
  }
  const distinctHardcodedHosts = Object.keys(hostCounts).length;
  if (distinctHardcodedHosts > 1) {
    findings.push({
      level: 'warn',
      message: `Collection uses ${distinctHardcodedHosts} distinct hardcoded hosts. Consider a {{baseUrl}} variable.`,
    });
  }

  // Examples/responses saved
  const withExamples = endpoints.filter((e) => (e.examples ?? []).length > 0).length;
  const examplesCoverage = pct(withExamples, endpoints.length);

  // Consistent Content-Type on bodies
  let bodiesChecked = 0;
  let bodiesWithContentType = 0;
  for (const ep of endpoints) {
    const body = ep.request?.body;
    if (body?.mode === 'raw' && body.raw) {
      bodiesChecked++;
      const headers = ep.request?.header ?? [];
      if (headers.some((h) => /^content-type$/i.test(h.key ?? '') && !h.disabled)) {
        bodiesWithContentType++;
      } else {
        findings.push({
          level: 'warn',
          message: 'Raw body present but no Content-Type header',
          path: ep.path.join(' / '),
        });
      }
    }
  }
  const contentTypeScore = bodiesChecked === 0 ? 1 : pct(bodiesWithContentType, bodiesChecked);

  // Collection description / info
  const info = collection.info ?? {};
  const infoName = isNonEmpty(info.name);
  const infoDesc = isNonEmpty(descriptionToString(info.description));
  const infoScore = (infoName ? 0.5 : 0) + (infoDesc ? 0.5 : 0);
  if (!infoName) findings.push({ level: 'warn', message: 'Collection has no name' });
  if (!infoDesc) findings.push({ level: 'info', message: 'Collection has no top-level description' });

  const varUsage = pct(endpointsUsingVars, endpoints.length);
  const hardcodedHostsScore = distinctHardcodedHosts <= 1 ? 1 : clamp(1 - (distinctHardcodedHosts - 1) * 0.25, 0, 1);

  const score =
    100 *
    (0.2 * (hasCollectionVars ? 1 : 0) +
      0.2 * varUsage +
      0.15 * hardcodedHostsScore +
      0.2 * examplesCoverage +
      0.15 * contentTypeScore +
      0.1 * infoScore);

  return {
    id: 'best_practices',
    label: 'Best Practices (variables, examples, consistency)',
    weight: 0.2,
    score: Math.round(score),
    maxScore: 100,
    findings,
    metrics: {
      collectionVariables: vars.length,
      endpointsUsingVariables: endpointsUsingVars,
      distinctHardcodedHosts,
      endpointsWithExamples: withExamples,
      bodiesChecked,
      bodiesWithContentType,
    },
  };
}

/** 5. Tests & script coverage. */
export function scoreTests(collection: V3Collection, endpoints: FlatEndpoint[]): CategoryResult {
  const findings: Finding[] = [];
  let endpointsWithTests = 0;
  let endpointsWithStatusAssertion = 0;
  let endpointsWithMultipleAssertions = 0;
  let totalAssertions = 0;

  const assertRegex = /pm\.test\s*\(|pm\.expect\s*\(|tests\[/g;
  const statusRegex = /response\.to\.have\.status\s*\(|responseCode\.code|\.status\s*\(\s*\d+/;

  for (const ep of endpoints) {
    const joined = ep.tests.join('\n');
    if (!joined.trim()) {
      findings.push({ level: 'warn', message: 'No tests defined', path: ep.path.join(' / ') });
      continue;
    }
    endpointsWithTests++;
    const matches = joined.match(assertRegex) ?? [];
    totalAssertions += matches.length;
    if (matches.length >= 2) endpointsWithMultipleAssertions++;
    if (statusRegex.test(joined)) endpointsWithStatusAssertion++;
    else
      findings.push({
        level: 'info',
        message: 'Tests exist but no HTTP status assertion detected',
        path: ep.path.join(' / '),
      });
  }

  // Collection-level pre-request/test events
  const collectionEvents = collection.event ?? [];
  const hasCollectionTest = collectionEvents.some((e) => e.listen === 'test');

  const coverage = pct(endpointsWithTests, endpoints.length);
  const statusCoverage = pct(endpointsWithStatusAssertion, endpoints.length);
  const multiAssertion = pct(endpointsWithMultipleAssertions, endpoints.length);
  const collectionEventScore = hasCollectionTest ? 1 : 0;

  const score =
    100 * (0.4 * coverage + 0.3 * statusCoverage + 0.2 * multiAssertion + 0.1 * collectionEventScore);

  return {
    id: 'tests',
    label: 'Tests & Coverage',
    weight: 0.2,
    score: Math.round(score),
    maxScore: 100,
    findings,
    metrics: {
      endpointsWithTests,
      endpointsWithStatusAssertion,
      endpointsWithMultipleAssertions,
      totalAssertions,
      hasCollectionLevelTest: hasCollectionTest,
    },
  };
}

/** 6. Documentation depth. */
export function scoreDocumentation(
  collection: V3Collection,
  endpoints: FlatEndpoint[]
): CategoryResult {
  const findings: Finding[] = [];
  const info = collection.info ?? {};
  const topDesc = descriptionToString(info.description);

  let endpointDescChars = 0;
  let endpointsDescribed = 0;
  for (const ep of endpoints) {
    if (isNonEmpty(ep.description)) {
      endpointsDescribed++;
      endpointDescChars += ep.description.length;
    }
  }
  const avgDescLen = endpointsDescribed === 0 ? 0 : endpointDescChars / endpointsDescribed;

  const topDescScore = topDesc.length >= 80 ? 1 : topDesc.length > 0 ? 0.5 : 0;
  if (topDesc.length === 0) findings.push({ level: 'warn', message: 'Missing collection-level description' });

  const epDescScore = pct(endpointsDescribed, endpoints.length);
  const depthScore = clamp(avgDescLen / 120, 0, 1); // 120 chars = decent detail

  const score = 100 * (0.3 * topDescScore + 0.45 * epDescScore + 0.25 * depthScore);

  return {
    id: 'documentation',
    label: 'Documentation Depth',
    weight: 0.1,
    score: Math.round(score),
    maxScore: 100,
    findings,
    metrics: {
      collectionDescriptionLength: topDesc.length,
      endpointsDescribed,
      averageEndpointDescriptionLength: Math.round(avgDescLen),
    },
  };
}
