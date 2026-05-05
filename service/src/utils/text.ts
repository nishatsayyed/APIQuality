// Small helpers for reading loose v3 fields.

export function descriptionToString(
  desc: string | { content?: string } | undefined | null
): string {
  if (!desc) return '';
  if (typeof desc === 'string') return desc;
  if (typeof desc === 'object' && typeof desc.content === 'string') {
    return desc.content;
  }
  return '';
}

export function joinScript(exec: string | string[] | undefined): string {
  if (!exec) return '';
  if (Array.isArray(exec)) return exec.join('\n');
  return String(exec);
}

export function isNonEmpty(s: string | undefined | null): boolean {
  return !!s && s.trim().length > 0;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return clamp(numerator / denominator, 0, 1);
}
