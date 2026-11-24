export interface WikiArticle {
  title: string;
  url: string;
  summary: string;
  sections: Record<string, string>;
}

const WIKI_HEADERS = {
  'User-Agent': 'JagyeokBaekseo/1.0 (https://vercel.app; korean-certification-guide)',
  Accept: 'application/json',
};

const fullWikiCache = new Map<string, { ts: number; article: WikiArticle | null }>();
const inFlightWiki = new Map<string, Promise<WikiArticle | null>>();
const WIKI_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeWikiKey(text: string): string {
  return text.replace(/[\s·\-_/()[\]]+/g, '').toLowerCase();
}

function buildAllowedWikiTargets(certName: string): {
  exactKeys: string[];
  baseKeys: string[];
  searchQueries: string[];
} {
  const trimmed = certName.trim();
  const cleanNoParens = trimmed.replace(/\s*\(.*?\)/g, '').trim();
  const parenMatches = Array.from(trimmed.matchAll(/\(([^)]+)\)/g))
    .map((m) => m[1].trim())
    .filter(Boolean);

  // Strip trailing grade tokens only (e.g. "사회복지사 1급" -> "사회복지사", "컴퓨터활용능력 2급" -> "컴퓨터활용능력")
  // Never strip "기사", "산업기사", "기능사" because "건축기사" !== "건축"
  const gradeStripped = cleanNoParens
    .replace(/\s*(?:제?\d+종|\d+급|N\d(?:\/N\d)?|심화|기본|기초|일반)$/i, '')
    .trim();

  const exactCandidates = [trimmed, cleanNoParens, ...parenMatches].filter(Boolean);
  const exactKeys = Array.from(new Set(exactCandidates.map(normalizeWikiKey))).filter(
    (k) => k.length >= 2
  );

  const baseCandidates = [gradeStripped, ...exactCandidates].filter(
    (t) => t && normalizeWikiKey(t).length >= 2
  );
  const baseKeys = Array.from(new Set(baseCandidates.map(normalizeWikiKey)));

  // Suffixes that are legitimate qualification disambiguators on Wikipedia
  const suffixedKeys = baseCandidates.flatMap((t) => [
    normalizeWikiKey(`${t}자격`),
    normalizeWikiKey(`${t}시험`),
    normalizeWikiKey(`${t}자격증`),
  ]);

  const searchQueries = Array.from(
    new Set(
      [cleanNoParens, gradeStripped !== cleanNoParens ? gradeStripped : ''].filter(Boolean)
    )
  );

  return {
    exactKeys: Array.from(new Set([...exactKeys, ...baseKeys, ...suffixedKeys])),
    baseKeys,
    searchQueries,
  };
}

function isValidQualificationWikiArticle(
  articleTitle: string,
  summary: string,
  baseKeys: string[]
): boolean {
  const cleanSummary = summary.trim();
  if (cleanSummary.length < 25) return false;

  // Reject biographical / school / entertainment / medical / disambiguation articles
  const invalidContextPattern =
    /(?:직업전문학교|출신의?\s*(?:선교사|정치인|가수|배우|운동선수)|대한민국의\s*(?:정치인|기업인|가수|배우|코미디언|유튜버)|웹\s*예능|태어났다|사망했다|동명이인|의학에서|질병|사건이다)/;
  if (invalidContextPattern.test(cleanSummary.slice(0, 350))) {
    return false;
  }

  // Must mention qualification / exam / license context
  const qualContextPattern =
    /(?:자격|시험|검정|과목|출제|응시|합격|국가기술|국가전문|민간자격|시행|위원회|공단|면허|평가|능력시험|인증)/;
  if (!qualContextPattern.test(cleanSummary)) {
    return false;
  }

  // The normalized title or base key must appear in the article's title or opening extract
  const headNorm = normalizeWikiKey(`${articleTitle} ${cleanSummary.slice(0, 280)}`);
  return baseKeys.some((key) => key.length >= 2 && headNorm.includes(key));
}

function parseWikiSections(rawExtract: string): {
  summary: string;
  sections: Record<string, string>;
} {
  const parts = rawExtract.split(/\n==+\s*([^=\n]+?)\s*==+\n/);
  const summary = (parts[0] || '').trim();
  const sections: Record<string, string> = {};
  for (let i = 1; i < parts.length; i += 2) {
    const heading = (parts[i] || '').trim();
    const body = (parts[i + 1] || '').trim();
    if (heading && body) {
      sections[heading] = body.slice(0, 1200);
    }
  }
  return { summary: summary.slice(0, 1200), sections };
}

export function pickWikiSection(sections: Record<string, string>, keywords: string[]): string {
  for (const [heading, body] of Object.entries(sections)) {
    const cleanHeading = heading.replace(/\s+/g, '').toLowerCase();
    if (keywords.some((kw) => cleanHeading.includes(kw))) {
      return body;
    }
  }
  return '';
}

async function safeFetchJson<T>(url: string, timeoutMs: number): Promise<T | null> {
  try {
    const resp = await fetch(url, {
      headers: WIKI_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('json')) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchStrictKoreanWikiArticle(certName: string): Promise<WikiArticle | null> {
  const trimmed = certName.trim();
  if (!trimmed) return null;

  const cacheKey = normalizeWikiKey(trimmed);
  const cached = fullWikiCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < WIKI_TTL_MS) {
    return cached.article;
  }

  const existingFlight = inFlightWiki.get(cacheKey);
  if (existingFlight) {
    return existingFlight;
  }

  const task = (async (): Promise<WikiArticle | null> => {
    const { exactKeys, baseKeys, searchQueries } = buildAllowedWikiTargets(trimmed);
    let matchedTitle: string | null = null;

    for (const q of searchQueries) {
      if (matchedTitle) break;
      const searchUrl = `https://ko.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        q
      )}&srlimit=5&format=json`;
      const searchJson = await safeFetchJson<{
        query?: { search?: Array<{ title: string }> };
      }>(searchUrl, 1200);

      const candidates = searchJson?.query?.search ?? [];
      const strictHit = candidates.find((c) => exactKeys.includes(normalizeWikiKey(c.title)));
      if (strictHit) {
        matchedTitle = strictHit.title;
      }
    }

    if (!matchedTitle) {
      return null;
    }

    const detailUrl = `https://ko.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(
      matchedTitle
    )}&format=json`;
    const detailJson = await safeFetchJson<{
      query?: { pages?: Record<string, { title?: string; extract?: string }> };
    }>(detailUrl, 1400);

    const page = Object.values(detailJson?.query?.pages ?? {})[0];
    if (!page?.extract) {
      return null;
    }

    const parsed = parseWikiSections(page.extract);
    const finalTitle = page.title || matchedTitle;

    if (!isValidQualificationWikiArticle(finalTitle, parsed.summary, baseKeys)) {
      return null;
    }

    return {
      title: finalTitle,
      url: `https://ko.wikipedia.org/wiki/${encodeURIComponent(finalTitle)}`,
      summary: parsed.summary,
      sections: parsed.sections,
    };
  })()
    .then((article) => {
      if (fullWikiCache.size >= 250) {
        const firstKey = fullWikiCache.keys().next().value;
        if (firstKey) fullWikiCache.delete(firstKey);
      }
      fullWikiCache.set(cacheKey, { ts: Date.now(), article });
      return article;
    })
    .finally(() => {
      inFlightWiki.delete(cacheKey);
    });

  inFlightWiki.set(cacheKey, task);
  return task;
}
