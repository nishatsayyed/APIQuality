import { V3Collection, FlatEndpoint } from '../types/collection';
import { flattenEndpoints } from '../parser/parseCollection';
import {
  CategoryResult,
  Finding,
  scoreAnnotations,
  scoreAuth,
  scoreBestPractices,
  scoreDocumentation,
  scoreEndpointStructure,
  scoreTests,
} from './categories';

export interface QualityReport {
  schema: string; // v3 (or whatever we detected)
  collectionName: string;
  overallScore: number; // 0..100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  summary: {
    endpoints: number;
    folders: number;
    totalFindings: number;
    errorFindings: number;
    warnFindings: number;
  };
  categories: CategoryResult[];
  topRecommendations: string[];
}

function gradeFor(score: number): QualityReport['grade'] {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function countFolders(items: unknown, acc = 0): number {
  if (!Array.isArray(items)) return acc;
  let count = acc;
  for (const it of items as any[]) {
    if (Array.isArray(it?.item)) {
      count++;
      count = countFolders(it.item, count);
    }
  }
  return count;
}

export function computeQualityReport(collection: V3Collection): QualityReport {
  const endpoints: FlatEndpoint[] = flattenEndpoints(collection);
  const categories: CategoryResult[] = [
    scoreEndpointStructure(collection, endpoints),
    scoreAnnotations(endpoints),
    scoreAuth(collection, endpoints),
    scoreBestPractices(collection, endpoints),
    scoreTests(collection, endpoints),
    scoreDocumentation(collection, endpoints),
  ];

  // normalize weights so they always sum to 1
  const weightSum = categories.reduce((s, c) => s + c.weight, 0) || 1;
  const weighted = categories.reduce((s, c) => s + (c.score * c.weight) / weightSum, 0);
  const overall = Math.round(weighted);

  const allFindings: Finding[] = categories.flatMap((c) =>
    c.findings.map((f) => ({ ...f, path: f.path ? `[${c.label}] ${f.path}` : `[${c.label}]` }))
  );
  const errors = allFindings.filter((f) => f.level === 'error').length;
  const warns = allFindings.filter((f) => f.level === 'warn').length;

  // Top recommendations: pick lowest-scoring categories and surface their first
  // couple of actionable findings.
  const recommendations: string[] = [];
  const byScore = [...categories].sort((a, b) => a.score - b.score);
  for (const cat of byScore) {
    if (cat.score >= 85) continue;
    const f = cat.findings.find((x) => x.level !== 'info') ?? cat.findings[0];
    if (f) recommendations.push(`${cat.label} (${cat.score}/100): ${f.message}`);
    if (recommendations.length >= 5) break;
  }

  return {
    schema: typeof collection.info?.schema === 'string' ? collection.info.schema : 'v3',
    collectionName: collection.info?.name ?? '(unnamed collection)',
    overallScore: overall,
    grade: gradeFor(overall),
    summary: {
      endpoints: endpoints.length,
      folders: countFolders(collection.item),
      totalFindings: allFindings.length,
      errorFindings: errors,
      warnFindings: warns,
    },
    categories,
    topRecommendations: recommendations,
  };
}
