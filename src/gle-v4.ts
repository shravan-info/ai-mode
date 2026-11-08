import { classifyIntent, detectLanguage, normalizeQuery, tokens, type Language, type Source } from './engine';
import type { GLEResponse, GLESection } from './gle';

type Candidate = { text: string; source: Source; score: number };

const STOP = new Set([
  'what','where','when','who','why','how','tell','about','give','show','information','details','explain','describe','is','are','the','of','for','in','on','and','or',
  'काय','कसे','कशी','कसा','कोण','कुठे','कधी','का','माहिती','सांगा','द्या','बद्दल','विषयी','स्पष्ट','करा','आहे','होते','असते','याबद्दल','थोडक्यात',
  'तालुका','जिल्हा','गाव','शहर','भारत','महाराष्ट्र',
]);
const SENTENCE_END = /(?<=[.!?।॥])\s+|\n+/u;

function topicTerms(query: string): string[] {
  return tokens(query).filter(term => !STOP.has(term));
}

function cleanText(input: string): string {
  let text = input
    .replace(/^\uFEFF/, '')
    .replace(/^\s*---\s*[\s\S]*?\n---\s*/u, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/^\s*(title|description|keywords|slug|layout|permalink)\s*:\s*.*$/gim, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^\s*[-|:\s]{3,}\s*$/gm, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  text = text.replace(/This response is grounded in retrieved sources[\s\S]*$/i, '');
  text = text.replace(/हे उत्तर उपलब्ध स्रोतांतील मजकुरावर आधारित आहे[\s\S]*$/i, '');
  return text.trim();
}

function titleRelevance(query: string, source: Source): number {
  const terms = topicTerms(query);
  if (!terms.length) return 1;
  const title = new Set(tokens(normalizeQuery(source.title)));
  const hits = terms.filter(term => title.has(term) || normalizeQuery(source.title).includes(term));
  return hits.length / terms.length;
}

function collectCandidates(query: string, sources: Source[], language: Language): Candidate[] {
  const qTerms = topicTerms(query);
  const out: Candidate[] = [];
  for (const source of sources) {
    const titleScore = titleRelevance(query, source);
    const sourceText = cleanText(source.extract);
    // When a query names a specific subject, do not mix in a different article
    // merely because it shares a generic word such as "taluka" or "district".
    if (qTerms.length && titleScore === 0) continue;
    if (!sourceText) continue;
    if (language !== 'mixed' && source.language !== language && titleScore < 0.5) continue;
    for (const raw of sourceText.split(SENTENCE_END)) {
      const sentence = raw.trim();
      if (sentence.length < 28 || sentence.length > 520) continue;
      if (/^(title|description|quick answer|source evidence|source-based information)\s*:/i.test(sentence)) continue;
      const words = new Set(tokens(sentence));
      const hits = qTerms.filter(term => words.has(term)).length;
      const coverage = qTerms.length ? hits / qTerms.length : 0;
      const score = coverage * 0.62 + titleScore * 0.25 + (source.provider === 'Factpedia' ? 0.08 : 0.03) + Math.min(sentence.length / 900, 0.05);
      if (!qTerms.length || hits > 0 || titleScore >= 0.5) out.push({ text: sentence, source, score });
    }
  }
  const seen = new Set<string>();
  return out.sort((a, b) => b.score - a.score).filter(item => {
    const key = normalizeQuery(item.text).slice(0, 160);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

function realizeSentence(sentence: string, language: Language, index: number): string {
  // Surface realization adds a newly authored explanatory frame while preserving
  // the source claim verbatim; it never guesses a translation or missing fact.
  if (language === 'mr') {
    const frames = [
      'उपलब्ध नोंदीनुसार, ',
      'या विषयावरील माहितीत पुढील बाब नमूद केली आहे: ',
      'स्रोतामध्ये याबाबत असे स्पष्ट केले आहे: ',
    ];
    return frames[index % frames.length] + sentence;
  }
  const frames = [
    'The available material reports that ',
    'One documented detail is that ',
    'The source further notes that ',
  ];
  return frames[index % frames.length] + sentence;
}

function makeSections(query: string, candidates: Candidate[], language: Language): GLESection[] {
  if (!candidates.length) return [];
  const mr = language === 'mr';
  const subject = query.trim().replace(/[?？!।]+$/g, '');
  const intro = mr
    ? subject + ' या विषयावर मिळालेल्या संबंधित स्रोतांमधील माहितीचा सारांश खाली दिला आहे.'
    : 'Here is a concise synthesis of the relevant source material about ' + subject + '.';
  const paragraphs = candidates.map((item, index) => realizeSentence(item.text, language, index));
  return [
    { heading: mr ? 'उत्तर' : 'Answer', paragraphs: [intro] },
    { heading: mr ? 'महत्त्वाची माहिती' : 'Key information', paragraphs },
  ];
}

export function generateGLEv4Response(
  query: string,
  sources: Source[],
  preferredLanguage?: Language,
): GLEResponse {
  const detected = detectLanguage(query);
  const language: Language = preferredLanguage === 'mixed'
    ? (/[\u0900-\u097F]/.test(query) ? 'mr' : 'en')
    : (preferredLanguage ?? detected);
  const { intent } = classifyIntent(query);
  const candidates = collectCandidates(query, sources, language);
  const distinctSources = new Set(candidates.map(item => item.source.id));
  const best = candidates[0]?.score ?? 0;
  const confidence = Math.max(0, Math.min(0.94, best * 0.7 + Math.min(distinctSources.size, 3) * 0.06));
  const sections = makeSections(query, candidates, language);
  const insufficient = language === 'mr'
    ? 'या विषयाशी थेट संबंधित पुरेशी माहिती स्रोतांमध्ये मिळाली नाही. कृपया विषयाचे अचूक नाव देऊन पुन्हा विचारा.'
    : 'The sources did not contain enough directly relevant information. Try asking again with the exact subject name.';
  const answer = sections.length
    ? sections.map(section => section.heading + '\n' + section.paragraphs.join('\n\n')).join('\n\n')
    : insufficient;
  return {
    answer, sections, intent, language, confidence,
    evidenceCount: candidates.length,
    mode: candidates.length ? 'evidence-grounded' : 'insufficient-evidence',
    note: '',
  };
}

export function getGLEv4Diagnostics(response: GLEResponse): string {
  return 'GLE v4 · ' + response.intent + ' · ' + Math.round(response.confidence * 100) + '% evidence match · ' + response.evidenceCount + ' relevant passages';
}
