import { CERT_CATALOG } from '../src/data/certCatalog.js';
import { findVerifiedBenchmark } from '../src/data/verifiedCertBenchmarks.js';
import { findVerifiedCurriculum } from '../src/data/verifiedCurriculums.js';
import type {
  AskAnswer,
  CertCatalogItem,
  CertResearchResult,
  GroundingSource,
  LearnerLevel,
  StudyAreaId,
} from '../src/types/cert.js';
import { fetchStrictKoreanWikiArticle, pickWikiSection } from './koreanWiki.js';

function normalizeKey(name: string): string {
  return name.replace(/\s*\(.*?\)/g, '').replace(/[\s·\-_/]+/g, '').toLowerCase();
}

function normalizeFullKey(name: string): string {
  return name.replace(/[\s·\-_/()[\]]+/g, '').toLowerCase();
}

export function findCatalogMatch(certName: string): CertCatalogItem | undefined {
  const trimmed = certName.trim();
  if (!trimmed) return undefined;

  const exact = CERT_CATALOG.find((c) => c.name === trimmed);
  if (exact) return exact;

  const fullNorm = normalizeFullKey(trimmed);
  const byFull = CERT_CATALOG.find((c) => {
    if (normalizeFullKey(c.name) === fullNorm) return true;
    const parenAlias = c.name.match(/\(([^)]+)\)/)?.[1];
    if (parenAlias && normalizeFullKey(parenAlias) === fullNorm) return true;
    return c.aliases.some((a) => normalizeFullKey(a) === fullNorm);
  });
  if (byFull) return byFull;

  if (!/\([^)]+\)/.test(trimmed)) {
    const targetNorm = normalizeKey(trimmed);
    return CERT_CATALOG.find(
      (c) =>
        normalizeKey(c.name) === targetNorm ||
        c.aliases.some((a) => normalizeKey(a) === targetNorm)
    );
  }
  return undefined;
}

function buildLiveSearchLinks(certName: string, organizer: string, officialUrl: string) {
  const cleanName = certName.replace(/\s*\(.*?\)/g, '').trim();
  const encoded = encodeURIComponent(cleanName);
  return [
    {
      name: `${organizer || cleanName} 공식 사이트`,
      url: officialUrl || 'https://www.q-net.or.kr',
      description: '최신 시험일정, 응시자격 자가진단, 원서접수 및 공식 합격률 통계 확인',
    },
    {
      name: '전자문제집 CBT 무료 기출풀이 (comcbt.com)',
      url: 'https://www.comcbt.com',
      description: '국가기술자격·상공회의소 등 과년도 필기 기출문제를 무료 온라인/PDF로 풀이',
    },
    {
      name: `교보문고 '${cleanName}' 최신 수험서 검색`,
      url: `https://search.kyobobook.co.kr/web/search?vPstrKeyWord=${encoded}`,
      description: '출간 최신 개정판 수험서 목록, 목차 및 독자 리뷰·별점 실시간 확인',
    },
  ];
}

export async function runKeylessCertResearch(input: {
  certName: string;
  organizer?: string;
  officialUrl?: string;
  selectedAreas: StudyAreaId[];
  learnerLevel: LearnerLevel;
  fallbackReason?: string;
}): Promise<CertResearchResult> {
  const cleanCertName = input.certName.trim();
  const catalogMatch = findCatalogMatch(cleanCertName);
  const canonicalName = catalogMatch?.name || cleanCertName;
  const cleanNoParens = canonicalName.replace(/\s*\(.*?\)/g, '').trim();

  const curriculum =
    findVerifiedCurriculum(canonicalName) || findVerifiedCurriculum(cleanCertName);
  const benchmark =
    findVerifiedBenchmark(canonicalName) || findVerifiedBenchmark(cleanCertName);

  const organizer = input.organizer || catalogMatch?.organizer || '공식 시행처 확인 필요';
  const officialUrl = input.officialUrl || catalogMatch?.officialUrl || 'https://www.q-net.or.kr';
  const certType = catalogMatch?.certType || '국내 자격증';

  const wiki = await fetchStrictKoreanWikiArticle(canonicalName);
  const encoded = encodeURIComponent(cleanNoParens);

  const wikiEligibility = wiki ? pickWikiSection(wiki.sections, ['응시자격', '자격요건', '응시']) : '';
  const wikiSubjects = wiki ? pickWikiSection(wiki.sections, ['시험과목', '과목', '출제', '구성', '내용']) : '';
  const wikiCriteria = wiki ? pickWikiSection(wiki.sections, ['합격기준', '합격', '평가', '검정']) : '';
  const wikiCareer = wiki ? pickWikiSection(wiki.sections, ['진로', '전망', '취업', '우대', '특전', '활용']) : '';

  const isQnet = organizer.includes('산업인력공단') || officialUrl.includes('q-net.or.kr');
  const isKdata = organizer.includes('데이터산업진흥원') || officialUrl.includes('dataq.or.kr');
  const isKorcham = organizer.includes('대한상공회의소') || officialUrl.includes('korcham.net');

  const defaultEligibility =
    curriculum?.eligibility ||
    wikiEligibility.slice(0, 260) ||
    (isQnet && cleanNoParens.endsWith('기사') && !cleanNoParens.endsWith('산업기사') && !cleanNoParens.endsWith('기능사')
      ? '관련 학과 4년제 대졸(예정), 산업기사+실무 1년, 실무 4년, 학점은행제 106학점 등 (큐넷 응시자격 자가진단 확인 필수)'
      : isQnet && cleanNoParens.endsWith('산업기사')
      ? '관련 학과 2·3년제 대졸(예정), 기능사+실무 1년, 실무 2년, 학점은행제 41학점 등 (큐넷 자가진단 확인)'
      : isQnet && cleanNoParens.endsWith('기능사')
      ? '학력·경력·연령 제한 없이 누구나 응시 가능 (일부 종목 제외, 큐넷 공고 확인)'
      : `${organizer} 공식 원서접수 안내에서 최신 응시자격 요건을 확인하세요.`);

  const defaultFee =
    curriculum?.feeInfo ||
    (isQnet
      ? '필기 약 19,400원 / 실기 20,000원대~ (종목별 상이 — 큐넷 공식 공고 확인 필요)'
      : `${organizer} 공식 원서접수 공고에서 최신 응시료 확인 필요`);

  const defaultSchedule =
    curriculum?.schedule ||
    (isKorcham
      ? '상시 검정 또는 정기 검정 시행 (대한상공회의소 자격평가사업단 일정 확인)'
      : `${organizer} 공식 홈페이지 연간 시험일정 공고 확인 필요`);

  const defaultLatestChanges =
    curriculum?.latestChanges ||
    (wiki?.summary
      ? wiki.summary.slice(0, 180)
      : catalogMatch?.summary || '최신 출제기준 개정 여부는 공식 시험처 공고를 확인하세요.');

  const sources: GroundingSource[] = [
    { title: `${organizer} 공식 사이트`, uri: officialUrl },
    ...(wiki ? [{ title: `한국어 위키백과 — ${wiki.title}`, uri: wiki.url }] : []),
    {
      title: `교보문고 '${cleanNoParens}' 수험서 검색`,
      uri: `https://search.kyobobook.co.kr/web/search?vPstrKeyWord=${encoded}`,
    },
    {
      title: `YES24 '${cleanNoParens}' 수험서 검색`,
      uri: `https://www.yes24.com/Product/Search?domain=ALL&query=${encoded}`,
    },
    { title: '전자문제집 CBT 무료 기출풀이', uri: 'https://www.comcbt.com' },
  ];

  const todayStr = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const result: CertResearchResult = {
    certName: cleanCertName,
    researchedAt: todayStr,
    selectedAreas: input.selectedAreas,
    learnerLevel: input.learnerLevel,
    mode: 'keyless',
    fallbackReason: input.fallbackReason,
    overview: {
      officialOrganizer: organizer,
      officialPortalUrl: officialUrl,
      certType,
      examSchedule2026: defaultSchedule,
      eligibility: defaultEligibility,
      feeInfo: defaultFee,
      latestChanges: defaultLatestChanges,
    },
    verificationNote: curriculum
      ? '사전 검증된 한국 공식 시행기관 출제기준·통계 DB 및 엄격 필터링된 한국어 위키백과 자료를 기준으로 정리했습니다. 원서접수 전 공식 사이트 최종 공고를 확인해 주세요.'
      : 'API 키가 필요 없는 [무키 공식자료·위키 실시간 조회 모드]로 한국어 위키백과(정확 일치 검증) 및 공식 시행처 카탈로그 데이터를 조회했습니다. 확인되지 않은 세부 통계 수치는 임의로 생성하지 않습니다.',
    sources,
  };

  if (input.selectedAreas.includes('concepts')) {
    result.concepts = curriculum
      ? {
          subjects: curriculum.subjects,
          coreTakeaways: curriculum.coreTakeaways,
          studyOrderTip: curriculum.studyOrderTip,
        }
      : {
          subjects: [
            {
              name: `${cleanNoParens} 공식 출제기준 및 과목 구성`,
              weight: catalogMatch?.examFormat || '공식 시행처 기준',
              keyTopics: wikiSubjects
                ? wikiSubjects
                    .split(/[\n.]+/)
                    .map((s) => s.trim())
                    .filter((s) => s.length > 6)
                    .slice(0, 5)
                : [
                    catalogMatch?.summary || `${cleanCertName} 핵심 이론 및 실무 과목`,
                    `시험 형식: ${catalogMatch?.examFormat || '공식 시험 공고 참조'}`,
                    wikiCriteria || '합격 기준: 공식 공고 확인 (통상 100점 만점 기준 60점 이상)',
                  ],
              memorizationTips: wiki?.summary
                ? wiki.summary.slice(0, 220)
                : '공식 출제기준의 세부 항목별 출제 비중을 먼저 확인한 뒤 기출문제와 연결해 정리하세요.',
            },
          ],
          coreTakeaways: [
            `주관기관(${organizer}) 홈페이지에서 최신 연도 출제기준 파일을 반드시 내려받아 변경 범위를 확인하세요.`,
            catalogMatch?.examFormat
              ? `시험 형식: ${catalogMatch.examFormat}`
              : '필기·실기(또는 1·2차) 시험 형식과 과목당 과락 기준(보통 40%)을 우선 점검하세요.',
            `수험 수준(${input.learnerLevel})에 맞춰 기본 이론 1회독 후 최근 5개년 기출 회독을 권장합니다.`,
          ],
          studyOrderTip:
            '공식 출제기준 확인 → 전체 목차·기출 빈출 단원 파악 → 개념 1회독 → 과년도 기출 오답 노트 순으로 진행하세요.',
        };
  }

  if (input.selectedAreas.includes('past_exams')) {
    const cbtLinks = curriculum?.cbtLinks || buildLiveSearchLinks(canonicalName, organizer, officialUrl);
    result.past_exams = {
      cbtSources: cbtLinks,
      recentTrend: isQnet
        ? '국가기술자격 CBT 전환 확대 및 단순 암기형 지양·실무 응용/법규 최신 개정 반영 추세입니다.'
        : isKdata
        ? '실무 데이터 처리·쿼리 응용 및 최신 개정 출제기준 적용 문항 비중이 중요합니다.'
        : '단순 기출 암기뿐 아니라 최신 개정 법규·실무 사례형 문항 대비가 필요합니다.',
      repeatRateNote:
        '객관식 필기 시험은 과년도 핵심 개념 반복 비중이 높은 편이나, 실기·주관식 및 최근 회차는 신유형·개정 기준 문항이 섞여 출제되므로 최신 기출 확인이 필수입니다.',
      sampleQuestions: curriculum?.sampleQuestions || [],
    };
  }

  if (input.selectedAreas.includes('lectures')) {
    result.lectures = curriculum
      ? {
          selectionCriteria: `${cleanNoParens}은(는) ${input.learnerLevel} 수준에 맞춰 최신 개정 기준 반영 여부와 무료 맛보기 강의 전달력을 비교해 선택하는 것이 좋습니다.`,
          instructors: curriculum.knownLectures.map((l) => ({
            name: l.name,
            platform: l.platform,
            courseName: l.courseName,
            textbookUsed: l.textbookUsed,
            textbookPublisher: l.textbookPublisher,
            passRateInfo: '공식 합격률 수치 미공개 (수강생 후기 기반 · 허위 수치 배제)',
            teachingStyle: l.style,
            pros: l.pros,
            cautions: l.cautions,
            bestFor: l.bestFor,
            officialUrl: l.officialUrl,
          })),
        }
      : {
          selectionCriteria:
            'API 키 미사용 모드에서는 검증되지 않은 강사 합격률을 임의로 생성하지 않습니다. 아래 공식·유튜브 강좌 검색을 통해 최신 커리큘럼과 샘플 강의를 직접 비교해 보세요.',
          instructors: [
            {
              name: `${cleanNoParens} 대표 인강·무료 특강 검색`,
              platform: '유튜브 / 에듀윌 / 해커스 / 시대고시 / 인프런 등',
              courseName: `${cleanNoParens} 최신 대비 강좌`,
              textbookUsed: '강사 지정 기본서 또는 시중 베스트셀러 연동',
              textbookPublisher: '강좌 상세페이지 확인',
              passRateInfo: '공식 합격률 수치 미공개 (각 교육기관 공지 및 실제 수강 후기 직접 확인 필요)',
              teachingStyle: `${input.learnerLevel} 수준에 맞는 기출풀이·개념강의 샘플을 1~2강 미리 들어보고 판서·교재 일치 여부를 비교하세요.`,
              pros: ['무료 유튜브 요약/기출해설 강의를 먼저 체험해 비용 낭비 방지 가능'],
              cautions: ['교재 개정 연도가 최신 시험 기준과 일치하는지 반드시 확인 필요'],
              bestFor: `${input.learnerLevel} 수험생`,
              officialUrl: `https://www.youtube.com/results?search_query=${encoded}+인강`,
            },
          ],
        };
  }

  if (input.selectedAreas.includes('workbooks')) {
    result.workbooks = curriculum
      ? {
          buyingGuide:
            '교재는 [개념서 vs 기출문제집] 비율과 최신 개정판(2025~2026) 발행 여부를 확인해 선택하세요.',
          books: curriculum.knownPublishers.map((b) => ({
            title: b.title,
            publisher: b.publisher,
            editionInfo: '최신 개정판 발행 여부 서점 확인',
            conceptVsProblemRatio: b.ratio,
            keyCharacteristic: b.characteristic,
            pros: b.pros,
            cons: b.cons,
            bestFor: b.bestFor,
          })),
        }
      : {
          buyingGuide:
            '실제 서점 베스트셀러 및 최근 독자 평점이 가장 정확합니다. 아래 교보문고·YES24 실시간 검색 링크에서 목차(개념 vs 문제 비중)와 최신 개정판을 확인하세요.',
          books: [
            {
              title: `${cleanNoParens} 최신 수험서 실시간 비교 (교보문고·YES24)`,
              publisher: '주요 수험 출판사 (길벗·영진·에듀윌·시대고시·성안당 등)',
              editionInfo: '서점 실시간 출간일 확인 필요',
              conceptVsProblemRatio: '이론형 vs 과년도기출형 교재 비교 필요',
              keyCharacteristic:
                '입문자라면 [이론 설명이 풍부한 기본서], 기본기가 있다면 [과년도 기출 수록량이 많은 문제집]을 고르는 것이 핵심입니다.',
              pros: ['출판사별 무료 부록(요약집·CBT·특강) 제공 여부를 서점 상세페이지에서 바로 비교 가능'],
              cons: ['구버전 중고 교재 구매 시 최신 개정 출제기준 누락 위험'],
              bestFor: `${input.learnerLevel} 수험생`,
            },
          ],
        };
  }

  if (input.selectedAreas.includes('interview')) {
    result.interview = {
      hasOfficialInterview: curriculum?.hasOfficialInterview ?? false,
      interviewFormatNote: curriculum?.hasOfficialInterview
        ? `${cleanNoParens}는 공식 시험 과정 내 구술/면접 평가를 포함하고 있으므로 공식 시행처의 평가 기준표를 확인하세요.`
        : `${cleanNoParens}는 별도 시험 면접보다는 취득 후 취업/이직 직무 면접에서 실무 이해도 및 자격 취득 과정에서 배운 핵심 개념을 검증받는 데 활용됩니다.`,
      qaList: [
        {
          category: '직무 역량 · 자격 취득 동기',
          question: `${cleanNoParens} 자격을 취득하며 가장 깊이 학습한 핵심 개념과 실무 적용 방안은 무엇인가요?`,
          keyPoints: ['공식 시험 과목 핵심 키워드', '트러블슈팅/현장 적용 사례'],
          modelAnswer: `시험 과목 중 핵심이 되는 이론(${catalogMatch?.summary || cleanNoParens})을 단순 암기한 것이 아니라, 실제 현업 상황(안전/설계/분석/법규 준수 등)에서 어떤 기준과 절차로 적용하는지 구체적 예시 1가지를 들어 답변하세요.`,
        },
        {
          category: '실기 · 실무 문제 해결',
          question: '현장에서 법규·기술 기준이 변경되거나 예외 상황이 발생했을 때 어떻게 대응하시겠습니까?',
          keyPoints: ['최신 기준 확인 습관', '원칙 준수 및 검산/검증 절차'],
          modelAnswer: `공식 기관(${organizer})의 최신 개정 기준을 우선 확인하고, 체크리스트에 따라 원인 파악 → 규정 대조 → 재발 방지 대책 순으로 논리적으로 설명하는 구조가 좋습니다.`,
        },
      ],
    };
  }

  if (input.selectedAreas.includes('stats')) {
    result.stats = {
      passRates: benchmark
        ? benchmark.passRates
        : [
            {
              year: '최근 공식 통계',
              writtenRate: '공식 통계 페이지 확인',
              practicalRate: '공식 통계 페이지 확인',
              applicantsNote: `${organizer} 공식 자격정보/자료실에 연도별 응시자 수 및 최종 합격률이 공시됩니다. (임의 추정 수치 생성 배제)`,
            },
          ],
      competitionContext: benchmark
        ? `[${benchmark.sourceLabel}] ${benchmark.difficultyNote}`
        : isQnet
        ? '국가기술자격은 절대평가(과목당 40점, 평균 60점 이상)로 타인과의 경쟁률보다 절대 점수 기준 충족 여부가 중요하며, 시험 회차별 난이도 편차가 존재합니다.'
        : '절대평가/상대평가 구분 및 최근 회차 합격률 추이는 공식 시행처 통계 공고를 기준으로 확인하시기 바랍니다.',
      employmentRateInfo: wikiCareer
        ? wikiCareer.slice(0, 260)
        : '특정 자격증 단일 기준의 공식 취업률 백분위 통계는 대부분 기관에서 별도 집계하지 않습니다. 대신 고용24(work24.go.kr)에서 해당 자격증 우대 채용 공고 수를 직접 확인하는 것이 가장 정확합니다.',
      salaryAndBenefits: curriculum?.benefits || [
        `${organizer} 발행 공인 자격으로서 관련 직무 지원 시 전문성 증빙`,
        '채용 공고상 자격 우대·가산점 및 일부 분야 법정 선임/배치 기준 참고 (공고별 확인 필요)',
        '고용24·잡코리아 등에서 해당 자격증 키워드로 실제 우대 채용 수요 및 연봉 수준 직접 조회 가능',
      ],
    };
  }

  return result;
}

export async function runKeylessCertAsk(
  certName: string,
  question: string,
  fallbackReason?: string
): Promise<AskAnswer> {
  const cleanCert = certName.trim();
  const cleanQuestion = question.trim();
  const catalogMatch = findCatalogMatch(cleanCert);
  const canonicalName = catalogMatch?.name || cleanCert;
  const cleanNoParens = canonicalName.replace(/\s*\(.*?\)/g, '').trim();

  const curriculum =
    findVerifiedCurriculum(canonicalName) || findVerifiedCurriculum(cleanCert);
  const benchmark =
    findVerifiedBenchmark(canonicalName) || findVerifiedBenchmark(cleanCert);
  const wikiCert = await fetchStrictKoreanWikiArticle(canonicalName);

  const organizer = catalogMatch?.organizer || '공식 시행처';
  const officialUrl = catalogMatch?.officialUrl || 'https://www.q-net.or.kr';

  const sources: GroundingSource[] = [
    {
      title: `${organizer} 공식 사이트`,
      uri: officialUrl,
    },
  ];
  if (wikiCert) {
    sources.push({ title: `한국어 위키백과 — ${wikiCert.title}`, uri: wikiCert.url });
  }
  const encoded = encodeURIComponent(cleanNoParens);
  sources.push({
    title: `교보문고 '${cleanNoParens}' 수험서 검색`,
    uri: `https://search.kyobobook.co.kr/web/search?vPstrKeyWord=${encoded}`,
  });

  const qLower = cleanQuestion.toLowerCase();
  const sections: string[] = [];
  sections.push(`[무키 공식자료 기반 답변 — ${canonicalName}]`);

  if (catalogMatch) {
    sections.push(
      `• 기본 정보: ${catalogMatch.certType} · 주관: ${catalogMatch.organizer}\n• 시험 형식: ${catalogMatch.examFormat}`
    );
  }

  let matchedSpecificTopic = false;

  if (curriculum) {
    if (/과목|범위|공부|순서|시험|구성|준비|어떻게|독학/.test(qLower)) {
      matchedSpecificTopic = true;
      const subjLines = curriculum.subjects
        .map((s) => `  - ${s.name} (${s.weight}): ${s.keyTopics.slice(0, 3).join(', ')}`)
        .join('\n');
      sections.push(`• 시험 과목 및 추천 순서:\n${subjLines}\n  → 추천 학습 순서: ${curriculum.studyOrderTip}`);
    }
    if (/자격|요건|비전공|학력|경력|응시/.test(qLower)) {
      matchedSpecificTopic = true;
      sections.push(`• 응시 자격: ${curriculum.eligibility}`);
    }
    if (/응시료|비용|가격|수수료|얼마/.test(qLower)) {
      matchedSpecificTopic = true;
      sections.push(`• 검정료(응시료): ${curriculum.feeInfo}`);
    }
    if (/일정|날짜|언제|몇회|회차|접수/.test(qLower)) {
      matchedSpecificTopic = true;
      sections.push(`• 시행 일정: ${curriculum.schedule}`);
    }
    if (/교재|책|문제집|기출|서적/.test(qLower)) {
      matchedSpecificTopic = true;
      const books = curriculum.knownPublishers
        .map((b) => `  - ${b.title} (${b.publisher} · ${b.ratio}): ${b.characteristic}`)
        .join('\n');
      sections.push(`• 대표 수험서 안내:\n${books}`);
    }
    if (/인강|강사|선생님|강의|유튜브|학원/.test(qLower)) {
      matchedSpecificTopic = true;
      const lecs = curriculum.knownLectures
        .map((l) => `  - ${l.name} (${l.platform}): ${l.style} [교재: ${l.textbookUsed}]`)
        .join('\n');
      sections.push(`• 대표 강의·강사진 안내:\n${lecs}`);
    }
  }

  if (/합격률|난이도|어려|쉬|통계|커트라인|취업|연봉|가산점|혜택/.test(qLower)) {
    matchedSpecificTopic = true;
    if (benchmark) {
      const rateLines = benchmark.passRates
        .slice(-3)
        .map((p) => `  - ${p.year}: 필기/1차 ${p.writtenRate} · 실기/2차 ${p.practicalRate}`)
        .join('\n');
      sections.push(
        `• 공식 합격률 및 난이도 (${benchmark.sourceLabel}):\n${rateLines}\n  → ${benchmark.difficultyNote}`
      );
    }
    if (curriculum?.benefits?.length) {
      sections.push(`• 취득 활용·우대:\n${curriculum.benefits.map((b) => `  - ${b}`).join('\n')}`);
    }
  }

  if (!matchedSpecificTopic && curriculum) {
    sections.push(
      `• 핵심 요약:\n${curriculum.coreTakeaways.map((t) => `  - ${t}`).join('\n')}\n• 응시자격: ${curriculum.eligibility}\n• 일정·응시료: ${curriculum.schedule} / ${curriculum.feeInfo}`
    );
    if (benchmark) {
      const latest = benchmark.passRates[benchmark.passRates.length - 1];
      if (latest) {
        sections.push(
          `• 최근 공식 합격률 (${latest.year}): 필기 ${latest.writtenRate} / 실기 ${latest.practicalRate}`
        );
      }
    }
  }

  if (wikiCert?.summary) {
    sections.push(`• 한국어 위키백과 참고 (${wikiCert.title}):\n${wikiCert.summary.slice(0, 480)}`);
  }

  sections.push(
    `• 공식 최종 확인 안내: 세부 접수 기간·개별 응시자격 판정·최신 개정 공고는 공식 사이트(${officialUrl})에서 직접 확인해 주세요.`
  );

  return {
    question: cleanQuestion,
    answer: sections.join('\n\n'),
    sources,
    askedAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    mode: 'keyless',
    fallbackReason,
  };
}
