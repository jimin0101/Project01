import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  ExternalLink,
  GitCompare,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CERT_CATALOG } from '../data/certCatalog';
import type { CertCatalogItem, CertResearchResult, LearnerLevel } from '../types/cert';
import { extractChoseong, isChoseongQuery, normalizeForSearch } from '../utils/koreanSearch';
import { parsePercentNumber } from './CertDataCharts';

interface CertComparisonViewProps {
  initialCertA?: string;
  initialCertB?: string;
  learnerLevel: LearnerLevel;
  preferKeyless: boolean;
  onOpenSingleReport: (certName: string) => void;
}

const POPULAR_COMPARE_PAIRS: Array<{ label: string; a: string; b: string }> = [
  { label: 'SQLD vs ADsP', a: 'SQLD (SQL 개발자)', b: 'ADsP (데이터분석 준전문가)' },
  { label: '정보처리기사 vs 빅데이터분석기사', a: '정보처리기사', b: '빅데이터분석기사' },
  { label: '전기기사 vs 산업안전기사', a: '전기기사', b: '산업안전기사' },
  { label: '컴활 1급 vs 전산세무 2급', a: '컴퓨터활용능력 1급', b: '전산세무 2급' },
  { label: '정보처리기사 vs 정보보안기사', a: '정보처리기사', b: '정보보안기사' },
];

function normalizeFullKey(name: string): string {
  return name.replace(/[\s·\-_/()[\]]+/g, '').toLowerCase();
}

function normalizeBaseKey(name: string): string {
  return name.replace(/\s*\(.*?\)/g, '').replace(/[\s·\-_/]+/g, '').toLowerCase();
}

function findCatalogByName(name: string): CertCatalogItem | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;

  const exact = CERT_CATALOG.find((c) => c.name === trimmed);
  if (exact) return exact;

  const fullTarget = normalizeFullKey(trimmed);
  const byFull = CERT_CATALOG.find((c) => {
    if (normalizeFullKey(c.name) === fullTarget) return true;
    const parenAlias = c.name.match(/\(([^)]+)\)/)?.[1];
    if (parenAlias && normalizeFullKey(parenAlias) === fullTarget) return true;
    return c.aliases.some((a) => normalizeFullKey(a) === fullTarget);
  });
  if (byFull) return byFull;

  if (!/\([^)]+\)/.test(trimmed)) {
    const baseTarget = normalizeBaseKey(trimmed);
    return CERT_CATALOG.find(
      (c) =>
        normalizeBaseKey(c.name) === baseTarget ||
        c.aliases.some((a) => normalizeBaseKey(a) === baseTarget)
    );
  }
  return undefined;
}

const INDEXED_COMPARE_CATALOG = CERT_CATALOG.map((item) => ({
  item,
  normName: normalizeForSearch(item.name),
  normCombined: normalizeForSearch([item.name, item.category, ...item.aliases].join(' ')),
  choseong: extractChoseong(`${item.name} ${item.aliases.join(' ')}`),
}));

function searchCatalogOptions(query: string): CertCatalogItem[] {
  const raw = query.trim();
  if (!raw) return CERT_CATALOG;

  const normQ = normalizeForSearch(raw);
  const useChoseong = normQ ? isChoseongQuery(raw) : false;

  const exactOrPrefix: CertCatalogItem[] = [];
  const otherMatches: CertCatalogItem[] = [];

  for (const entry of INDEXED_COMPARE_CATALOG) {
    const matchesText = entry.normCombined.includes(normQ);
    const matchesChoseong = useChoseong && entry.choseong.includes(normQ);
    if (!matchesText && !matchesChoseong) continue;

    if (
      entry.normName === normQ ||
      entry.normName.startsWith(normQ) ||
      entry.item.aliases.some((a) => normalizeForSearch(a) === normQ)
    ) {
      exactOrPrefix.push(entry.item);
    } else {
      otherMatches.push(entry.item);
    }
  }

  return [...exactOrPrefix, ...otherMatches];
}

export const CertComparisonView: React.FC<CertComparisonViewProps> = ({
  initialCertA = 'SQLD (SQL 개발자)',
  initialCertB = 'ADsP (데이터분석 준전문가)',
  learnerLevel,
  preferKeyless,
  onOpenSingleReport,
}) => {
  const [certAName, setCertAName] = useState(initialCertA);
  const [certBName, setCertBName] = useState(initialCertB);
  const [filterA, setFilterA] = useState('');
  const [filterB, setFilterB] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [comparedData, setComparedData] = useState<{
    a: CertResearchResult;
    b: CertResearchResult;
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const optionsA = useMemo(() => searchCatalogOptions(filterA), [filterA]);
  const optionsB = useMemo(() => searchCatalogOptions(filterB), [filterB]);

  const handleFilterAChange = (nextFilter: string) => {
    setFilterA(nextFilter);
    setErrorMsg(null);
    const trimmed = nextFilter.trim();
    if (!trimmed) return;

    const matched = searchCatalogOptions(trimmed);
    if (matched.length > 0) {
      // Automatically align selected Cert A with the search filter so dropdown & state never diverge
      if (!matched.some((c) => c.name === certAName) || matched[0].name !== certAName) {
        setCertAName(matched[0].name);
      }
    } else {
      // Allow comparing any custom/searched certification not listed in catalog
      setCertAName(trimmed);
    }
  };

  const handleFilterBChange = (nextFilter: string) => {
    setFilterB(nextFilter);
    setErrorMsg(null);
    const trimmed = nextFilter.trim();
    if (!trimmed) return;

    const matched = searchCatalogOptions(trimmed);
    if (matched.length > 0) {
      if (!matched.some((c) => c.name === certBName) || matched[0].name !== certBName) {
        setCertBName(matched[0].name);
      }
    } else {
      setCertBName(trimmed);
    }
  };

  const runComparison = async (
    nameA = certAName,
    nameB = certBName,
    keylessOverride?: boolean
  ) => {
    const cleanA = nameA.trim();
    const cleanB = nameB.trim();
    if (!cleanA || !cleanB) {
      setErrorMsg('비교할 두 자격증을 모두 선택해 주세요.');
      return;
    }

    const catA = findCatalogByName(cleanA);
    const catB = findCatalogByName(cleanB);
    const resolvedA = catA?.name || cleanA;
    const resolvedB = catB?.name || cleanB;

    if (normalizeFullKey(resolvedA) === normalizeFullKey(resolvedB)) {
      setErrorMsg('서로 다른 두 자격증을 선택해야 비교할 수 있습니다.');
      return;
    }

    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setErrorMsg(null);

    const effectiveKeyless = keylessOverride ?? preferKeyless;

    const fetchOne = async (
      certName: string,
      cat?: CertCatalogItem
    ): Promise<CertResearchResult> => {
      const resp = await fetch('/api/cert-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          certName,
          organizer: cat?.organizer || '',
          officialUrl: cat?.officialUrl || '',
          selectedAreas: ['concepts', 'lectures', 'workbooks', 'stats'],
          learnerLevel,
          includeOverview: true,
          useKeyless: effectiveKeyless,
        }),
      });
      const raw = await resp.text();
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      if (!resp.ok || !('certName' in parsed)) {
        throw new Error(
          typeof parsed.error === 'string' && parsed.error
            ? parsed.error
            : `'${certName}' 자료를 불러오지 못했습니다.`
        );
      }
      return parsed as unknown as CertResearchResult;
    };

    try {
      const [resA, resB] = await Promise.all([
        fetchOne(resolvedA, catA),
        fetchOne(resolvedB, catB),
      ]);
      if (controller.signal.aborted) return;
      setComparedData({ a: resA, b: resB });
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      setErrorMsg(err instanceof Error ? err.message : '자격증 비교 중 오류가 발생했습니다.');
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  const handleSelectPreset = (a: string, b: string) => {
    setFilterA('');
    setFilterB('');
    setCertAName(a);
    setCertBName(b);
    runComparison(a, b);
  };

  const handleSwap = () => {
    const prevA = certAName;
    const prevB = certBName;
    const prevFilterA = filterA;
    const prevFilterB = filterB;
    setCertAName(prevB);
    setCertBName(prevA);
    setFilterA(prevFilterB);
    setFilterB(prevFilterA);
    if (comparedData) {
      setComparedData({ a: comparedData.b, b: comparedData.a });
    }
  };

  const comparisonChartData = useMemo(() => {
    if (!comparedData) return [];
    const latestA = comparedData.a.stats?.passRates?.[comparedData.a.stats.passRates.length - 1];
    const latestB = comparedData.b.stats?.passRates?.[comparedData.b.stats.passRates.length - 1];

    const aWritten = latestA ? parsePercentNumber(latestA.writtenRate) : null;
    const aPractical = latestA ? parsePercentNumber(latestA.practicalRate) : null;
    const bWritten = latestB ? parsePercentNumber(latestB.writtenRate) : null;
    const bPractical = latestB ? parsePercentNumber(latestB.practicalRate) : null;

    if (aWritten === null && aPractical === null && bWritten === null && bPractical === null) {
      return [];
    }

    return [
      {
        stage: '필기 · 1차 (최근)',
        valA: aWritten,
        valB: bWritten,
      },
      ...(aPractical !== null || bPractical !== null
        ? [
            {
              stage: '실기 · 2차 (최근)',
              valA: aPractical,
              valB: bPractical,
            },
          ]
        : []),
    ];
  }, [comparedData]);

  const certAInOptions = optionsA.some((c) => c.name === certAName);
  const certBInOptions = optionsB.some((c) => c.name === certBName);

  const sameSelection =
    Boolean(certAName.trim()) &&
    Boolean(certBName.trim()) &&
    normalizeFullKey(findCatalogByName(certAName)?.name || certAName) ===
      normalizeFullKey(findCatalogByName(certBName)?.name || certBName);

  return (
    <section
      id="compare-section"
      className="bg-white border border-slate-200 rounded-xl p-6 md:p-8 space-y-6 no-print"
    >
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-slate-100 pb-5">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700">
            <GitCompare className="w-3.5 h-3.5" />
            <span>1:1 COMPARE WORKBENCH</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900">자격증 2개 나란히 심층 비교</h2>
          <p className="text-sm text-slate-600">
            비교할 자격증 이름·약칭·초성을 검색해 고른 뒤 비교를 실행하면 선택한 두 자격증의 공식 데이터만 나란히 표시합니다.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {POPULAR_COMPARE_PAIRS.map((pair) => (
            <button
              key={pair.label}
              type="button"
              onClick={() => handleSelectPreset(pair.a, pair.b)}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {pair.label}
            </button>
          ))}
        </div>
      </div>

      {/* Dual Picker Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-11 gap-4 items-start">
        {/* Target A */}
        <div className="lg:col-span-5 space-y-2.5 border border-slate-200 rounded-xl p-4 bg-slate-50/50">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-blue-700">비교 대상 A</span>
            <span className="font-semibold text-slate-800 truncate max-w-[210px]">{certAName}</span>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={filterA}
              onChange={(e) => handleFilterAChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runComparison(certAName, certBName);
                }
              }}
              placeholder="A 자격증 검색 (예: 건축기사, ㄱㅊㄱㅅ, 직접 입력)"
              className="w-full pl-8 pr-8 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            {filterA && (
              <button
                type="button"
                onClick={() => setFilterA('')}
                aria-label="A 검색어 지우기"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {filterA.trim() && optionsA.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {optionsA.slice(0, 6).map((c) => {
                const picked = certAName === c.name;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCertAName(c.name)}
                    className={`px-2.5 py-1 text-xs rounded-md border transition-colors whitespace-nowrap ${
                      picked
                        ? 'bg-blue-700 text-white border-blue-700 font-semibold'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}

          {filterA.trim() && optionsA.length === 0 && (
            <div className="text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              목록 외 자격증 <strong>&apos;{filterA.trim()}&apos;</strong> 직접 비교 대상으로 지정됨
            </div>
          )}

          <select
            value={certAName}
            onChange={(e) => setCertAName(e.target.value)}
            aria-label="비교 대상 A 자격증 선택"
            className="w-full px-3 py-2.5 text-sm font-medium bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {!certAInOptions && certAName.trim() && (
              <option value={certAName}>[직접 선택] {certAName}</option>
            )}
            {optionsA.map((c) => (
              <option key={c.id} value={c.name}>
                [{c.category}] {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Swap Button */}
        <div className="lg:col-span-1 flex items-center justify-center lg:pt-10">
          <button
            type="button"
            onClick={handleSwap}
            title="A와 B 맞바꾸기"
            aria-label="두 자격증 위치 맞바꾸기"
            className="p-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 transition-colors"
          >
            <ArrowLeftRight className="w-4 h-4" />
          </button>
        </div>

        {/* Target B */}
        <div className="lg:col-span-5 space-y-2.5 border border-slate-200 rounded-xl p-4 bg-slate-50/50">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-emerald-700">비교 대상 B</span>
            <span className="font-semibold text-slate-800 truncate max-w-[210px]">{certBName}</span>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={filterB}
              onChange={(e) => handleFilterBChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runComparison(certAName, certBName);
                }
              }}
              placeholder="B 자격증 검색 (예: 산안기, 컴활, 직접 입력)"
              className="w-full pl-8 pr-8 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
            {filterB && (
              <button
                type="button"
                onClick={() => setFilterB('')}
                aria-label="B 검색어 지우기"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {filterB.trim() && optionsB.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {optionsB.slice(0, 6).map((c) => {
                const picked = certBName === c.name;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCertBName(c.name)}
                    className={`px-2.5 py-1 text-xs rounded-md border transition-colors whitespace-nowrap ${
                      picked
                        ? 'bg-emerald-700 text-white border-emerald-700 font-semibold'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}

          {filterB.trim() && optionsB.length === 0 && (
            <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              목록 외 자격증 <strong>&apos;{filterB.trim()}&apos;</strong> 직접 비교 대상으로 지정됨
            </div>
          )}

          <select
            value={certBName}
            onChange={(e) => setCertBName(e.target.value)}
            aria-label="비교 대상 B 자격증 선택"
            className="w-full px-3 py-2.5 text-sm font-medium bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
          >
            {!certBInOptions && certBName.trim() && (
              <option value={certBName}>[직접 선택] {certBName}</option>
            )}
            {optionsB.map((c) => (
              <option key={c.id} value={c.name}>
                [{c.category}] {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Selected Pair Confirmation & Execute Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
        <div className="text-xs text-slate-600 space-y-0.5">
          <div>
            선택된 비교 조합:{' '}
            <strong className="text-blue-700">{certAName}</strong>
            <span className="mx-1.5 text-slate-400">vs</span>
            <strong className="text-emerald-700">{certBName}</strong>
            {sameSelection && (
              <span className="ml-2 text-red-600 font-semibold">(서로 다른 종목을 선택하세요)</span>
            )}
          </div>
          <div>
            조회 방식:{' '}
            <strong className="text-slate-800">
              {preferKeyless ? 'API 키 없이 공식·위키 즉시 비교' : '자동 (AI+공식 교차검증)'}
            </strong>
          </div>
        </div>

        <button
          type="button"
          onClick={() => runComparison(certAName, certBName)}
          disabled={loading || sameSelection || !certAName.trim() || !certBName.trim()}
          className="inline-flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50 shrink-0"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                {certAName} vs {certBName} 비교 중...
              </span>
            </>
          ) : (
            <>
              <GitCompare className="w-4 h-4" />
              <span>선택한 2종 1:1 비교 실행</span>
            </>
          )}
        </button>
      </div>

      {errorMsg && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => runComparison(certAName, certBName, true)}
            disabled={loading}
            className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap self-start sm:self-auto"
          >
            API 키 없이 공식·위키로 비교하기
          </button>
        </div>
      )}

      {/* Comparison Results */}
      {comparedData && (
        <div className="space-y-6 pt-2">
          {/* Pass Rate Comparison Bar Chart */}
          {comparisonChartData.length > 0 && (
            <div className="border border-slate-200 rounded-xl p-5 bg-slate-50/50 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    최근 공식 합격률 1:1 비교 도표 ({comparedData.a.certName} vs{' '}
                    {comparedData.b.certName})
                  </h3>
                  <p className="text-xs text-slate-500">
                    단일 시험 자격증은 실기/2차 막대가 표시되지 않습니다
                  </p>
                </div>
              </div>
              <div className="w-full h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={comparisonChartData}
                    margin={{ top: 10, right: 20, left: -16, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="stage" tick={{ fontSize: 12, fill: '#334155' }} />
                    <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '8px',
                        borderColor: '#E2E8F0',
                        fontSize: '12px',
                      }}
                      formatter={(value, name) => [`${value}%`, String(name)]}
                    />
                    <Legend />
                    <Bar
                      dataKey="valA"
                      name={comparedData.a.certName}
                      fill="#1D4ED8"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={42}
                    />
                    <Bar
                      dataKey="valB"
                      name={comparedData.b.certName}
                      fill="#059669"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={42}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Side-by-Side Comparison Matrix Table */}
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="py-3.5 px-4 font-semibold text-slate-600 w-36">비교 항목</th>
                  <th className="py-3.5 px-4 font-bold text-blue-800 w-[42%]">
                    <div className="flex items-center justify-between gap-2">
                      <span>A. {comparedData.a.certName}</span>
                      <button
                        type="button"
                        onClick={() => onOpenSingleReport(comparedData.a.certName)}
                        className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0"
                      >
                        전체 리포트 →
                      </button>
                    </div>
                  </th>
                  <th className="py-3.5 px-4 font-bold text-emerald-800 w-[42%]">
                    <div className="flex items-center justify-between gap-2">
                      <span>B. {comparedData.b.certName}</span>
                      <button
                        type="button"
                        onClick={() => onOpenSingleReport(comparedData.b.certName)}
                        className="text-xs font-medium text-emerald-700 hover:underline whitespace-nowrap shrink-0"
                      >
                        전체 리포트 →
                      </button>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white align-top">
                <tr>
                  <td className="py-3 px-4 font-semibold text-slate-700 bg-slate-50/40">구분 · 주관기관</td>
                  <td className="py-3 px-4 text-slate-800">
                    {comparedData.a.overview.certType} · {comparedData.a.overview.officialOrganizer}
                  </td>
                  <td className="py-3 px-4 text-slate-800">
                    {comparedData.b.overview.certType} · {comparedData.b.overview.officialOrganizer}
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-semibold text-slate-700 bg-slate-50/40">응시 자격 요건</td>
                  <td className="py-3 px-4 text-slate-700 leading-relaxed">
                    {comparedData.a.overview.eligibility}
                  </td>
                  <td className="py-3 px-4 text-slate-700 leading-relaxed">
                    {comparedData.b.overview.eligibility}
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-semibold text-slate-700 bg-slate-50/40">시험 일정 · 응시료</td>
                  <td className="py-3 px-4 text-slate-700 space-y-1">
                    <div>{comparedData.a.overview.examSchedule2026}</div>
                    <div className="font-mono-num text-xs text-slate-500">
                      {comparedData.a.overview.feeInfo}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-700 space-y-1">
                    <div>{comparedData.b.overview.examSchedule2026}</div>
                    <div className="font-mono-num text-xs text-slate-500">
                      {comparedData.b.overview.feeInfo}
                    </div>
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-semibold text-slate-700 bg-slate-50/40">최근 공식 합격률</td>
                  <td className="py-3 px-4 font-mono-num text-slate-800 space-y-1">
                    {(comparedData.a.stats?.passRates ?? []).slice(-2).map((p, i) => (
                      <div key={i} className="text-xs">
                        <strong>{p.year}:</strong> 필기 {p.writtenRate} / 실기 {p.practicalRate}
                      </div>
                    ))}
                  </td>
                  <td className="py-3 px-4 font-mono-num text-slate-800 space-y-1">
                    {(comparedData.b.stats?.passRates ?? []).slice(-2).map((p, i) => (
                      <div key={i} className="text-xs">
                        <strong>{p.year}:</strong> 필기 {p.writtenRate} / 실기 {p.practicalRate}
                      </div>
                    ))}
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-semibold text-slate-700 bg-slate-50/40">과목 구성</td>
                  <td className="py-3 px-4 text-slate-700">
                    <ul className="space-y-1 text-xs">
                      {(comparedData.a.concepts?.subjects ?? []).map((s, i) => (
                        <li key={i}>
                          • <strong>{s.name}</strong> ({s.weight})
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="py-3 px-4 text-slate-700">
                    <ul className="space-y-1 text-xs">
                      {(comparedData.b.concepts?.subjects ?? []).map((s, i) => (
                        <li key={i}>
                          • <strong>{s.name}</strong> ({s.weight})
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-semibold text-slate-700 bg-slate-50/40">대표 강사 · 교재</td>
                  <td className="py-3 px-4 text-slate-700 text-xs space-y-1.5">
                    {(comparedData.a.lectures?.instructors ?? []).slice(0, 2).map((inst, i) => (
                      <div key={i}>
                        <strong>{inst.name}</strong> ({inst.platform}) — {inst.textbookUsed}
                      </div>
                    ))}
                    {(comparedData.a.workbooks?.books ?? []).slice(0, 2).map((b, i) => (
                      <div key={`wb-a-${i}`} className="text-slate-600">
                        교재: {b.title} [{b.conceptVsProblemRatio}]
                      </div>
                    ))}
                  </td>
                  <td className="py-3 px-4 text-slate-700 text-xs space-y-1.5">
                    {(comparedData.b.lectures?.instructors ?? []).slice(0, 2).map((inst, i) => (
                      <div key={i}>
                        <strong>{inst.name}</strong> ({inst.platform}) — {inst.textbookUsed}
                      </div>
                    ))}
                    {(comparedData.b.workbooks?.books ?? []).slice(0, 2).map((b, i) => (
                      <div key={`wb-b-${i}`} className="text-slate-600">
                        교재: {b.title} [{b.conceptVsProblemRatio}]
                      </div>
                    ))}
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-semibold text-slate-700 bg-slate-50/40">취득 혜택 · 우대</td>
                  <td className="py-3 px-4 text-slate-700 text-xs space-y-1">
                    {(comparedData.a.stats?.salaryAndBenefits ?? []).map((ben, i) => (
                      <div key={i}>• {ben}</div>
                    ))}
                    {comparedData.a.overview.officialPortalUrl && (
                      <a
                        href={comparedData.a.overview.officialPortalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-700 hover:underline pt-1"
                      >
                        <span>공식 사이트 바로가기</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </td>
                  <td className="py-3 px-4 text-slate-700 text-xs space-y-1">
                    {(comparedData.b.stats?.salaryAndBenefits ?? []).map((ben, i) => (
                      <div key={i}>• {ben}</div>
                    ))}
                    {comparedData.b.overview.officialPortalUrl && (
                      <a
                        href={comparedData.b.overview.officialPortalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-700 hover:underline pt-1"
                      >
                        <span>공식 사이트 바로가기</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};
