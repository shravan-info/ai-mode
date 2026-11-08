import { classifyIntent, detectLanguage, normalizeQuery, rankSources, tokens, type Intent, type Language, type Source } from './engine';

export type GLESection = { heading: string; paragraphs: string[] };
export type GLEResponse = {
  answer: string;
  sections: GLESection[];
  intent: Intent;
  language: Language;
  confidence: number;
  evidenceCount: number;
  mode: 'evidence-grounded' | 'insufficient-evidence';
  note: string;
};

type Candidate = { text: string; source: Source; score: number; terms: string[] };

const LABELS: Record<Language, Record<string, string>> = {
  mr: {
    direct: 'थोडक्यात उत्तर', details: 'महत्त्वाचे मुद्दे', process: 'कार्यपद्धती', history: 'ऐतिहासिक माहिती',
    compare: 'तुलनेसाठी उपलब्ध माहिती', examples: 'उपलब्ध उदाहरणे', summary: 'सारांश', sources: 'स्रोतांवर आधारित माहिती',
    limited: 'माहितीची मर्यादा', note: 'हे उत्तर उपलब्ध स्रोतांतील मजकुरावर आधारित आहे. स्रोतांमध्ये नसलेली माहिती मुद्दाम जोडलेली नाही.',
    insufficient: 'या प्रश्नाचे विश्वासार्ह उत्तर तयार करण्यासाठी पुरेसा संदर्भ उपलब्ध नाही. अधिक स्पष्ट प्रश्न विचारा किंवा संबंधित विषयाचे नाव द्या.',
  },
  en: {
    direct: 'Quick answer', details: 'Key details', process: 'How it works', history: 'Historical context',
    compare: 'Comparison information found', examples: 'Examples in the sources', summary: 'Summary', sources: 'Source-based information',
    limited: 'Evidence limitation', note: 'This response is grounded in the retrieved source text. Details not supported by the sources have not been added.',
    insufficient: 'There is not enough relevant source material to form a reliable answer. Try a more specific question or add the topic name.',
  },
  mixed: {
    direct: 'थोडक्यात उत्तर / Quick answer', details: 'महत्त्वाचे मुद्दे / Key details', process: 'कार्यपद्धती / How it works',
    history: 'ऐतिहासिक माहिती / Historical context', compare: 'तुलनेसाठी माहिती / Comparison',
    examples: 'उदाहरणे / Examples', summary: 'सारांश / Summary', sources: 'स्रोतांवर आधारित माहिती / Source evidence',
    limited: 'माहितीची मर्यादा / Evidence limitation',
    note: 'हे उत्तर उपलब्ध स्रोतांवर आधारित आहे. This response is grounded in retrieved sources; unsupported details are not added.',
    insufficient: 'पुरेसा संदर्भ उपलब्ध नाही. Not enough relevant source material was found. प्रश्न अधिक स्पष्ट करून विचारा.',
  },
};

const MODE_KEYWORDS: Record<Intent, string[]> = {
  definition: ['definition','meaning','defined','refers to','म्हणजे','व्याख्या','अर्थ','म्हटले जाते'],
  howto: ['process','method','steps','works','working','कार्य','प्रक्रिया','पद्धत','कार्य करते'],
  comparison: ['difference','whereas','while','unlike','compared','फरक','तुलनेत','तर','याउलट'],
  history: ['history','century','founded','established','born','इतिहास','स्थापना','साली','शतक'],
  person: ['born','scientist','leader','writer','known for','जन्म','शास्त्रज्ञ','नेते','लेखक'],
  place: ['located','region','district','capital','river','स्थित','प्रदेश','जिल्हा','राजधानी','नदी'],
  science: ['energy','force','reaction','cell','organism','process','ऊर्जा','बल','अभिक्रिया','पेशी','सजीव'],
  current: ['currently','latest','today','recent','as of','सध्या','आज','अलीकडे','नवीनतम'],
  summary: ['important','main','key','includes','consists','महत्त्वाचे','मुख्य','यामध्ये','समाविष्ट'],
  general: [],
};

const SENTENCE_SPLIT = /(?<=[.!?।॥])\s+|\n+/u;
const clean = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const overlap = (a: string[], b: string[]) => a.filter(x => b.includes(x)).length;

function sentences(source: Source): string[] {
  return source.extract.split(SENTENCE_SPLIT).map(clean).filter(s => s.length >= 35 && s.length <= 700);
}

function collectCandidates(query: string, sources: Source[], intent: Intent): Candidate[] {
  const queryTerms = tokens(query);
  const modeTerms = MODE_KEYWORDS[intent].flatMap(tokens);
  const ranked = rankSources(query, sources);
  const candidates: Candidate[] = [];
  for (const source of ranked) {
    for (const [index, text] of sentences(source).entries()) {
      const words = tokens(text);
      const queryHits = overlap(queryTerms, words);
      const modeHits = overlap(modeTerms, words);
      const coverage = queryTerms.length ? queryHits / queryTerms.length : 0;
      const density = words.length ? queryHits / Math.min(words.length, 50) : 0;
      const startBonus = index === 0 ? 0.035 : 0;
      const sourceBonus = source.provider === 'Factpedia' ? 0.025 : 0;
      const score = coverage * 0.62 + density * 0.18 + Math.min(modeHits, 3) * 0.035 + source.score * 0.14 + startBonus + sourceBonus;
      if (queryHits > 0 || source.score >= 0.35) candidates.push({ text, source, score, terms: words });
    }
  }
  const seen = new Set<string>();
  return candidates.sort((a,b)=>b.score-a.score).filter(c=>{
    const key=normalizeQuery(c.text).slice(0,180);
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sentenceGroups(intent: Intent, candidates: Candidate[], language: Language): GLESection[] {
  const labels=LABELS[language];
  const selected=candidates.slice(0,7);
  if (!selected.length) return [];
  const primary=selected.slice(0,2).map(c=>c.text);
  const rest=selected.slice(2,7).map(c=>c.text);
  const sections: GLESection[]=[];
  sections.push({heading:labels.direct,paragraphs:primary});
  if (rest.length) {
    const heading = intent==='howto' ? labels.process : intent==='history' ? labels.history :
      intent==='comparison' ? labels.compare : intent==='summary' ? labels.summary :
      intent==='definition' ? labels.details : labels.sources;
    sections.push({heading,paragraphs:rest});
  }
  return sections;
}

function renderSections(sections: GLESection[], note: string): string {
  return sections.map(section => section.heading + '\n' + section.paragraphs.join('\n')).join('\n\n') + '\n\n' + note;
}

export function generateLanguageResponse(query: string, sources: Source[], preferredLanguage?: Language): GLEResponse {
  const detected=detectLanguage(query);
  const language=preferredLanguage ?? detected;
  const {intent}=classifyIntent(query);
  const ranked=rankSources(query,sources);
  const candidates=collectCandidates(query,ranked,intent);
  const uniqueSources=new Set(candidates.slice(0,7).map(c=>c.source.id));
  const evidenceCount=candidates.slice(0,7).length;
  const best=candidates[0]?.score ?? 0;
  const confidence=Math.max(0,Math.min(0.96,best*0.72+Math.min(uniqueSources.size,4)*0.055));
  const labels=LABELS[language];
  if (!candidates.length || confidence < 0.12) {
    const answer=labels.insufficient;
    return {answer,sections:[],intent,language,confidence,evidenceCount:0,mode:'insufficient-evidence',note:labels.note};
  }
  const sections=sentenceGroups(intent,candidates,language);
  const answer=renderSections(sections,labels.note);
  return {answer,sections,intent,language,confidence,evidenceCount,mode:'evidence-grounded',note:labels.note};
}

export function getGLEDiagnostics(response: GLEResponse): string {
  const percent=Math.round(response.confidence*100);
  return 'GLE v1 · '+response.intent+' · '+percent+'% evidence-match · '+response.evidenceCount+' extracted passages';
}
