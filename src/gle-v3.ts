import { normalizeQuery, tokens, type Language, type Source } from './engine';
import { generateLanguageResponse, type GLEResponse } from './gle';

export type ContextTurn = { question: string; answer?: string };
export type EvidenceInsight = {
  contextUsed: boolean;
  corroborated: number;
  singleSource: number;
  possibleDisagreements: number;
  summary: string;
  details: string[];
};
export type GLEv3Response = GLEResponse & { evidence: EvidenceInsight };

const FOLLOW_UP = /^(why|how|what about|and|also|explain more|tell me more|continue|its|it is|they|them|that|this|हे का|ते का|असे का|कसे|कसं|आणखी|अधिक माहिती|त्याबद्दल|याबद्दल|मग|आणि)(?:\\b|\\s|$)/i;
const NEGATIVE = /\b(not|no|never|neither|cannot|can't|isn't|wasn't|doesn't|didn't|without)\b|नाही|नसते|नव्हते|नव्हता|नसल्यामुळे/i;

type Passage = { text: string; source: Source; terms: string[] };

function splitPassages(sources: Source[]): Passage[] {
  const out: Passage[] = [];
  for (const source of sources) {
    const parts = source.extract.split(/(?<=[.!?।॥])\s+|\n+/u);
    for (const raw of parts) {
      const text = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text.length < 35 || text.length > 700) continue;
      out.push({ text, source, terms: tokens(text) });
    }
  }
  return out;
}

function overlapCount(a: string[], b: string[]): number {
  const right = new Set(b);
  return new Set(a.filter(term => right.has(term))).size;
}

export function buildContextualQuery(query: string, history: ContextTurn[]): { query: string; contextUsed: boolean } {
  const cleanQuery = query.trim();
  const previous = history.filter(turn => turn.question.trim()).slice(-4);
  if (!previous.length || cleanQuery.length > 90 || !FOLLOW_UP.test(normalizeQuery(cleanQuery))) {
    return { query: cleanQuery, contextUsed: false };
  }
  const anchor = previous[previous.length - 1].question.trim();
  return { query: cleanQuery + ' ' + anchor, contextUsed: true };
}

function inspectEvidence(query: string, sources: Source[], contextUsed: boolean, language: Language): EvidenceInsight {
  const queryTerms = tokens(query);
  const passages = splitPassages(sources).map(p => ({
    ...p,
    relevance: queryTerms.length ? overlapCount(queryTerms, p.terms) / queryTerms.length : 0,
  })).filter(p => p.relevance >= 0.2).sort((a, b) => b.relevance - a.relevance).slice(0, 18);

  let corroborated = 0;
  let singleSource = 0;
  let possibleDisagreements = 0;
  const used = new Set<number>();
  for (let i = 0; i < passages.length; i++) {
    if (used.has(i)) continue;
    const group = [i];
    for (let j = i + 1; j < passages.length; j++) {
      if (used.has(j) || passages[i].source.id === passages[j].source.id) continue;
      const shared = overlapCount(passages[i].terms, passages[j].terms);
      const denominator = Math.max(1, Math.min(new Set(passages[i].terms).size, new Set(passages[j].terms).size));
      if (shared >= 3 && shared / denominator >= 0.52) group.push(j);
    }
    group.forEach(index => used.add(index));
    if (new Set(group.map(index => passages[index].source.id)).size > 1) corroborated++;
    else singleSource++;
  }

  for (let i = 0; i < passages.length; i++) {
    for (let j = i + 1; j < passages.length; j++) {
      if (passages[i].source.id === passages[j].source.id) continue;
      const shared = overlapCount(passages[i].terms, passages[j].terms);
      const denominator = Math.max(1, Math.min(new Set(passages[i].terms).size, new Set(passages[j].terms).size));
      if (shared >= 4 && shared / denominator >= 0.65 && NEGATIVE.test(passages[i].text) !== NEGATIVE.test(passages[j].text)) {
        possibleDisagreements++;
      }
    }
  }

  const summary = language === 'mr'
    ? (contextUsed ? 'मागील प्रश्नाचा संदर्भ वापरला. ' : 'हा प्रश्न स्वतंत्रपणे तपासला. ') + 'स्रोतांमधील पुष्टीचे गट: ' + corroborated + '; एकाच स्रोतावर आधारित गट: ' + singleSource + '; संभाव्य मतभेद: ' + possibleDisagreements + '.'
    : (contextUsed ? 'Previous-question context was used. ' : 'This question was checked independently. ') + 'Cross-source support groups: ' + corroborated + '; single-source groups: ' + singleSource + '; possible disagreements: ' + possibleDisagreements + '.';

  const details = language === 'mr'
    ? ['एकाच विषयावरील समान मजकूर वेगवेगळ्या स्रोतांत आढळल्यास पुष्टीचा संकेत मोजला जातो.', 'संभाव्य मतभेद हा फक्त तपासण्याचा इशारा आहे; तो स्वतःहून कोणता स्रोत बरोबर आहे हे ठरवत नाही.']
    : ['Similar passages across different sources are counted as a support signal.', 'A possible disagreement is only a review flag; it does not decide which source is correct.'];

  return { contextUsed, corroborated, singleSource, possibleDisagreements, summary, details };
}

export function generateGLEv3Response(
  query: string,
  sources: Source[],
  history: ContextTurn[] = [],
  preferredLanguage?: Language,
): GLEv3Response {
  const contextual = buildContextualQuery(query, history);
  const base = generateLanguageResponse(query, sources, preferredLanguage);
  const evidence = inspectEvidence(contextual.query, sources, contextual.contextUsed, base.language);
  return { ...base, evidence };
}

export function getGLEv3Diagnostics(response: GLEv3Response): string {
  const confidence = Math.round(response.confidence * 100);
  const context = response.evidence.contextUsed ? 'context-aware' : 'standalone';
  return 'GLE v3 · ' + response.intent + ' · ' + confidence + '% evidence-match · ' +
    response.evidence.corroborated + ' cross-source support groups · ' + context;
}
