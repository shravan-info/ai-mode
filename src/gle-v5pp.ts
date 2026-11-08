import { classifyIntent, detectLanguage, normalizeQuery, tokens, type Language, type Source } from './engine';
import type { GLEResponse, GLESection } from './gle';
import type { RetrievalV5Result } from './retrieval-v5';

type Passage = { text: string; source: Source; score: number; coverage: number };

const STOP = new Set([
  'what','where','when','who','why','how','tell','about','give','show','information','details','explain','describe','is','are','the','of','for','in','on','and','or','to','a','an','does','do','which','that','this','with','from',
  'काय','कसे','कशी','कसा','कोण','कोणती','कोणते','कुठे','कधी','का','माहिती','सांगा','द्या','बद्दल','विषयी','स्पष्ट','करा','आहे','होते','असते','याबद्दल','थोडक्यात','म्हणजे','आणि','यांची','यांचे','याचा','याची','यात','होतात','होतो','एक','प्रमुख','वैशिष्ट्ये','समजावून','सांग','सोप्या','मराठीत',
]);

const EXPANSIONS: Record<string, string[]> = {
  'कृत्रिम बुद्धिमत्ता':['artificial intelligence','AI'],
  'artificial intelligence':['कृत्रिम बुद्धिमत्ता','AI'],
  'संविधान':['constitution','राज्यघटना'],
  'राज्यघटना':['constitution','संविधान'],
  'पृथ्वी':['earth','planet'],
  'earth':['पृथ्वी','planet'],
  'ऋतू':['seasons','season','axial tilt'],
  'seasons':['ऋतू','ऋतुमान','axial tilt'],
  'गुरुत्वाकर्षण':['gravity','gravitation'],
  'gravity':['गुरुत्वाकर्षण','gravitation'],
  'प्रकाशसंश्लेषण':['photosynthesis'],
  'photosynthesis':['प्रकाशसंश्लेषण'],
  'लोकशाही':['democracy'],
  'democracy':['लोकशाही'],
  'वैशिष्ट्ये':['features','characteristics'],
  'features':['वैशिष्ट्ये','characteristics'],
  'इतिहास':['history','historical'],
  'history':['इतिहास','historical'],
};

function queryTerms(query: string): string[] {
  const base = tokens(query).map(normalizeQuery).filter(t => t.length > 1 && !STOP.has(t));
  const expanded = base.flatMap(term => EXPANSIONS[term] ?? []);
  return [...new Set([...base, ...expanded].map(normalizeQuery).filter(Boolean))];
}

function words(value: string): string[] {
  return normalizeQuery(value).toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function coverage(terms: string[], value: string): number {
  if (!terms.length) return 0;
  const haystack = new Set(words(value));
  const hits = terms.filter(term => {
    const parts = words(term);
    return parts.length > 0 && parts.every(part => haystack.has(part));
  });
  return hits.length / terms.length;
}

function splitPassages(value: string): string[] {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?।॥])\s+|\n+/u)
    .map(part => part.trim())
    .filter(part => part.length >= 45 && part.length <= 900)
    .filter(part => !/^(references|external links|see also|संदर्भ|बाह्य दुवे|category|श्रेणी)\b/i.test(part));
}

function collectPassages(query: string, sources: Source[], language: Language): Passage[] {
  const terms = queryTerms(query);
  const candidates: Passage[] = [];

  for (const source of sources) {
    // Do not silently mix languages in the answer. The source cards remain available separately.
    if (source.language !== language) continue;

    const titleCoverage = coverage(terms, source.title);
    for (const text of splitPassages(source.extract)) {
      const bodyCoverage = coverage(terms, text);
      if (bodyCoverage === 0 && titleCoverage < 0.34) continue;

      const exactTitleBoost = titleCoverage >= 0.5 ? 0.18 : 0;
      const sourceBoost = source.provider === 'Factpedia' ? 0.035 : 0.02;
      const lengthPenalty = text.length > 650 ? 0.035 : 0;
      const score = bodyCoverage * 0.68 + titleCoverage * 0.24 + exactTitleBoost + sourceBoost - lengthPenalty;
      candidates.push({ text, source, score, coverage: bodyCoverage });
    }
  }

  const seen = new Set<string>();
  return candidates
    .sort((a, b) => b.score - a.score)
    .filter(item => {
      const key = normalizeQuery(item.text).slice(0, 220);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 7);
}

function buildSections(query: string, passages: Passage[], language: Language): GLESection[] {
  if (!passages.length) return [];
  const mr = language === 'mr';
  const direct = passages[0];
  const detail = passages.slice(1, 5);
  const heading = mr ? 'थेट उत्तर' : 'Direct answer';
  const detailHeading = mr ? 'महत्त्वाची माहिती' : 'Key information';

  const first = direct.text + ' 〔' + direct.source.title + '〕';
  const details = detail.map(item => item.text + ' 〔' + item.source.title + '〕');
  const intro = mr
    ? 'खालील उत्तर उपलब्ध मराठी स्रोतांमधील संबंधित मजकुरावर आधारित आहे.'
    : 'This answer is based on the most relevant passages found in the selected sources.';

  const sections: GLESection[] = [
    { heading, paragraphs: [intro, first] },
  ];
  if (details.length) sections.push({ heading: detailHeading, paragraphs: details });
  return sections;
}

function insufficientMessage(language: Language, hasOtherLanguageEvidence: boolean): string {
  if (language === 'mr') {
    return hasOtherLanguageEvidence
      ? 'या प्रश्नासाठी इंग्रजी स्रोत सापडले, पण उपलब्ध मराठी स्रोतांमध्ये पुरेसा थेट पुरावा मिळाला नाही. भाषा English निवडा किंवा अधिक नेमका प्रश्न विचारा.'
      : 'मराठी व इंग्रजी Wikipedia आणि Factpedia मधून या प्रश्नाशी थेट संबंधित पुरेसा पुरावा मिळाला नाही. विषयाचे पूर्ण नाव किंवा अधिक संदर्भ देऊन विचारा.';
  }
  return hasOtherLanguageEvidence
    ? 'Relevant Marathi sources were found, but the available English sources did not contain enough direct evidence. Switch the answer language to Marathi or refine the question.'
    : 'I could not find enough directly relevant evidence in Marathi Wikipedia, English Wikipedia, or Factpedia. Try a more specific topic name or add context.';
}

export function generateGLEv5ppResponse(
  query: string,
  retrieval: RetrievalV5Result,
  preferredLanguage?: Language,
): GLEResponse {
  const detected = detectLanguage(query);
  const language: Language = preferredLanguage ?? detected;
  const { intent } = classifyIntent(query);
  const passages = collectPassages(query, retrieval.sources, language);
  const usedSources = new Set(passages.map(item => item.source.id));
  const otherLanguageEvidence = retrieval.sources.some(source => source.language !== language);
  const sections = buildSections(query, passages, language);
  const answer = sections.length
    ? sections.map(section => section.heading + '\n' + section.paragraphs.join('\n\n')).join('\n\n')
    : insufficientMessage(language, otherLanguageEvidence);

  // Confidence is a relevance indicator, not a probability that every statement is true.
  const topScore = passages[0]?.score ?? 0;
  const sourceSupport = Math.min(usedSources.size, 4) * 0.055;
  const confidence = Math.max(0, Math.min(0.94, topScore * 0.72 + sourceSupport));

  return {
    answer,
    sections,
    intent,
    language,
    confidence,
    evidenceCount: passages.length,
    mode: passages.length ? 'evidence-grounded' : 'insufficient-evidence',
    note: passages.length ? 'Evidence relevance score; verify important facts against cited sources.' : '',
  };
}

export function getGLEv5ppDiagnostics(response: GLEResponse, retrieval: RetrievalV5Result): string {
  return 'GLE v5+++ · ' + response.intent + ' · ' + Math.round(response.confidence * 100) +
    '% evidence relevance · ' + response.evidenceCount + ' passages · MR Wiki ' +
    retrieval.wikiMrCount + ' / EN Wiki ' + retrieval.wikiEnCount + ' / Factpedia ' +
    retrieval.factpediaCount + (retrieval.errors.length ? ' · ' + retrieval.errors.length + ' retrieval warnings' : '');
}
