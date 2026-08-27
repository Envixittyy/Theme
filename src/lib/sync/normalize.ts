/**
 * Title normalization used for the *fallback* dedup path.
 *
 * The primary key for deduplication is always (account, external UID). This
 * exists only for the case the spec calls out: a feed that omits UIDs or
 * regenerates them. It is deliberately lossy — casing, punctuation, a leading
 * course code and bracketed suffixes all disappear — so that
 * "CHM031 — Quiz 4 (Section B)" and "Quiz 4" collapse to the same key.
 */
export function normalizeTitle(title: string, courseCode?: string | null): string {
  let out = title.toLowerCase().normalize('NFKD');
  if (courseCode) {
    const code = courseCode.toLowerCase().replace(/[^a-z0-9]/g, '');
    out = out.replace(new RegExp(`^\\s*${escapeRegExp(code)}\\b[\\s:–—-]*`), '');
  }
  out = out
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(due|deadline|submission|submit)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return out;
}

/**
 * Course codes in feeds look like "CHM031-B01", "[MATH30] ...", "MATH30 :".
 * Returns the code and the title with the code stripped.
 */
export function extractCourseCode(title: string, categories: string[] = []): { code: string | null; title: string } {
  const bracket = /^\s*[\[(]([A-Z]{2,6}\s?\d{2,4}[A-Z]?\d?)[^\])]*[\])]\s*[:–—-]?\s*/i.exec(title);
  if (bracket?.[1]) {
    return { code: canonicalCode(bracket[1]), title: title.slice(bracket[0].length).trim() };
  }
  const prefix = /^\s*([A-Z]{2,6}\s?\d{2,4}[A-Z]?\d?)(?:[-–—]\w+)?\s*[:–—-]\s*/i.exec(title);
  if (prefix?.[1]) {
    return { code: canonicalCode(prefix[1]), title: title.slice(prefix[0].length).trim() };
  }
  for (const category of categories) {
    const m = /^([A-Z]{2,6}\s?\d{2,4}[A-Z]?\d?)/i.exec(category.trim());
    if (m?.[1]) return { code: canonicalCode(m[1]), title: title.trim() };
  }
  return { code: null, title: title.trim() };
}

export function canonicalCode(code: string): string {
  return code.toUpperCase().replace(/[\s_-]+/g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
