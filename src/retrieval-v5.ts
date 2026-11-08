import { detectLanguage, normalizeQuery, rankSources, tokens, type Language, type Source } from './engine';

export type RetrievalV5Result = {
  sources: Source[];
  language: Language;
  errors: string[];
  wikiMrCount: number;
  wikiEnCount: number;
  factpediaCount: number;
  queriesUsed: string[];
};

const STOP = new Set([
  'what','where','when','who','why','how','tell','about','give','show','information','details','explain','describe','is','are','the','of','for','in','on','and','or','to','a','an','does','do','was','were','will','would','can','could','should','which','that','this','with','from',
  'काय','कसे','कशी','कसा','कोण','कोणती','कोणते','कुठे','कधी','का','माहिती','सांगा','द्या','बद्दल','विषयी','स्पष्ट','करा','आहे','होते','असते','याबद्दल','थोडक्यात','म्हणजे','आणि','यांची','यांचे','याचा','याची','यात','कसे','होतात','होतो','होते','एक','प्रमुख','वैशिष्ट्ये','समजावून','सांग',
]);

const ALIASES: Record<string, string[]> = {
  'ऋतू':['seasons','season','axial tilt','earth tilt','ऋतुमान'],
  'पृथ्वी':['earth','planet earth','भूमी'],
  'संविधान':['constitution','राज्यघटना','indian constitution'],
  'राज्यघटना':['constitution','संविधान','indian constitution'],
  'वैशिष्ट्ये':['features','characteristics','प्रमुख गुणधर्म'],
  'माणगाव':['mangaon','mangaon taluka'],
  'गुरुत्वाकर्षण':['gravity','gravitation'],
  'प्रकाशसंश्लेषण':['photosynthesis'],
  'लोकशाही':['democracy'],
  'भारत':['india','bharat'],
  'महाराष्ट्र':['maharashtra'],
  'seasons':['ऋतू','ऋतुमान','earth tilt'],
  'earth':['पृथ्वी','planet'],
  'constitution':['संविधान','राज्यघटना'],
  'features':['वैशिष्ट्ये','गुणधर्म'],
  'gravity':['गुरुत्वाकर्षण','gravitation'],
  'photosynthesis':['प्रकाशसंश्लेषण'],
  'democracy':['लोकशाही'],
  'india':['भारत','bharat'],
  'maharashtra':['महाराष्ट्र'],
};

function meaningfulTerms(query: string): string[] {
  return tokens(query).filter(t => !STOP.has(t) && t.length > 1);
}

function queryVariants(query: string): string[] {
  const terms = meaningfulTerms(query);
  const expanded = terms.flatMap(term => ALIASES[term] ?? Object.entries(ALIASES).find(([key]) => term.startsWith(key) && key.length > 2)?.[1] ?? []);
  const variants = [query.trim()];
  if (expanded.length) variants.push([...terms, ...expanded].join(' '));
  const direct = terms.flatMap(term => ALIASES[term] ?? []).filter(x => /^[a-z][a-z -]+$/i.test(x));
  if (direct.length) variants.push(direct.join(' '));
  return [...new Set(variants.map(v => v.trim()).filter(Boolean))].slice(0, 3);
}

function wikiEndpoint(lang: 'mr'|'en') {
  return (lang === 'mr' ? 'https://mr.wikipedia.org' : 'https://en.wikipedia.org') + '/w/api.php';
}

async function wikiRequest(endpoint: string, params: Record<string,string>): Promise<any> {
  const url = endpoint + '?' + new URLSearchParams({...params, format:'json', origin:'*', utf8:'1'}).toString();
  const response = await fetch(url, {headers:{Accept:'application/json'}});
  if (!response.ok) throw new Error('Wikipedia API returned HTTP ' + response.status);
  return response.json();
}

async function getWikiPages(lang: 'mr'|'en', titles: string[]): Promise<Source[]> {
  if (!titles.length) return [];
  const endpoint = wikiEndpoint(lang);
  const data = await wikiRequest(endpoint, {
    action:'query',
    prop:'extracts|info|langlinks',
    titles:titles.join('|'),
    explaintext:'1',
    exchars:'14000',
    exsectionformat:'plain',
    inprop:'url',
    redirects:'1',
    lllimit:'20',
  });
  const pages = Object.values(data.query?.pages ?? {}) as any[];
  return pages.filter(p => !p.missing && p.extract).map(p => ({
    id:'wiki-' + lang + '-' + p.pageid,
    title:String(p.title ?? ''),
    url:String(p.fullurl ?? ((lang === 'mr' ? 'https://mr.wikipedia.org/wiki/' : 'https://en.wikipedia.org/wiki/') + encodeURIComponent(String(p.title ?? '').replace(/ /g,'_')))),
    extract:String(p.extract ?? '').replace(/\s+/g,' ').trim().slice(0,14000),
    provider:'Wikipedia' as const,
    language:lang,
    score:0,
  }));
}

async function wikipediaSearch(query: string, lang: 'mr'|'en'): Promise<Source[]> {
  const endpoint = wikiEndpoint(lang);
  const variants = queryVariants(query);
  const searchBatches = await Promise.all(variants.map(async q => {
    const data = await wikiRequest(endpoint, {
      action:'query', list:'search', srsearch:q, srlimit:'5', srnamespace:'0', srwhat:'text',
    });
    return (data.query?.search ?? []).map((hit:any) => String(hit.title));
  }));
  const titles = [...new Set(searchBatches.flat())].slice(0, 8);
  return getWikiPages(lang, titles);
}

type FactRecord = {title?:string; content?:string; text?:string; url?:string; language?:string; summary?:string};
const FACTPEDIA_INDEX = (import.meta as any).env?.VITE_FACTPEDIA_INDEX_URL || '/factpedia-index.json';
let treePromise: Promise<any[]> | null = null;

async function loadFactpediaTree(): Promise<any[]> {
  if (!treePromise) treePromise = (async () => {
    const response = await fetch('https://api.github.com/repos/shravan-info/factpedia-mr/git/trees/main?recursive=1', {headers:{Accept:'application/vnd.github+json'}});
    if (!response.ok) throw new Error('Factpedia repository tree unavailable');
    const data = await response.json();
    return (data.tree ?? []).filter((f:any) =>
      f.type === 'blob' && /\.(html?|md|json)$/i.test(f.path) &&
      !/(readme|license|package|config|template|index\.html?$)/i.test(f.path) &&
      !/(node_modules|assets|images|css|js\/vendor)\//i.test(f.path)
    );
  })();
  return treePromise;
}

function scoreFact(queryTerms:string[], title:string, body:string):number {
  const titleNorm = normalizeQuery(title);
  const bodyNorm = normalizeQuery(body);
  const titleHits = queryTerms.filter(t => titleNorm.includes(t)).length;
  const bodyHits = queryTerms.filter(t => bodyNorm.includes(t)).length;
  const titleCoverage = queryTerms.length ? titleHits/queryTerms.length : 0;
  const bodyCoverage = queryTerms.length ? bodyHits/queryTerms.length : 0;
  return titleCoverage*0.72 + bodyCoverage*0.28;
}

function extractFactText(raw:string, path:string): {title:string; text:string} {
  let title = (path.split('/').pop() ?? path).replace(/\.(html?|md|json)$/i,'').replace(/[-_]/g,' ');
  let text = raw;
  if (/\.html?$/i.test(path)) {
    const doc = new DOMParser().parseFromString(raw,'text/html');
    title = doc.querySelector('h1')?.textContent?.trim() || doc.title || title;
    text = doc.querySelector('article')?.textContent || doc.querySelector('main')?.textContent || doc.body?.textContent || '';
  } else if (/\.json$/i.test(path)) {
    try { const data = JSON.parse(raw); title = data.title || title; text = data.content || data.text || data.summary || ''; } catch {}
  } else {
    text = raw.replace(/^---\s*[\s\S]*?---\s*/m,'').replace(/^#+\s*/gm,'').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1');
  }
  return {title:String(title).trim(),text:String(text).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()};
}

async function factpediaSearch(query:string):Promise<Source[]> {
  const terms = meaningfulTerms(query);
  try {
    const response = await fetch(FACTPEDIA_INDEX,{headers:{Accept:'application/json'}});
    if (response.ok) {
      const data = await response.json();
      const rows:FactRecord[] = Array.isArray(data) ? data : (data.articles ?? data.items ?? []);
      const matches = rows.map((r,i) => {
        const title = String(r.title ?? '');
        const text = String(r.content ?? r.text ?? r.summary ?? '');
        return {r,i,title,text,score:scoreFact(terms,title,text)};
      }).filter(x => x.score >= 0.12).sort((a,b)=>b.score-a.score).slice(0,8);
      if (matches.length) return matches.map(({r,i,title,text,score}) => ({
        id:'factpedia-index-'+i,title,url:r.url ?? '#',extract:text.slice(0,12000),
        provider:'Factpedia' as const,language:(r.language?.startsWith('mr') || /[\u0900-\u097F]/.test(title+' '+text) ? 'mr':'en') as 'mr'|'en',score,
      }));
    }
  } catch {}

  const files = await loadFactpediaTree();
  const ranked = files.map((file:any) => {
    const title = String(file.path).split('/').pop()?.replace(/\.(html?|md|json)$/i,'').replace(/[-_]/g,' ') ?? '';
    return {file,title,score:scoreFact(terms,title,'')};
  }).filter((x:any)=>x.score>0).sort((a:any,b:any)=>b.score-a.score).slice(0,10);

  const records = await Promise.all(ranked.map(async ({file}:any) => {
    const rawUrl = 'https://raw.githubusercontent.com/shravan-info/factpedia-mr/main/' + String(file.path).split('/').map(encodeURIComponent).join('/');
    const response = await fetch(rawUrl);
    if (!response.ok) return null;
    const parsed = extractFactText(await response.text(),String(file.path));
    const finalScore = scoreFact(terms,parsed.title,parsed.text);
    if (!parsed.text || finalScore < 0.12) return null;
    return {
      id:'factpedia-'+file.sha,title:parsed.title,
      url:'https://github.com/shravan-info/factpedia-mr/blob/main/'+file.path,
      extract:parsed.text.slice(0,12000),provider:'Factpedia' as const,
      language:(/[\u0900-\u097F]/.test(parsed.title+' '+parsed.text)?'mr':'en') as 'mr'|'en',
      score:finalScore,
    } as Source;
  }));
  return records.filter((x):x is Source=>Boolean(x));
}

export async function searchKnowledgeV5(query:string):Promise<RetrievalV5Result> {
  const language = detectLanguage(query);
  const errors:string[] = [];
  const tasks = await Promise.allSettled([
    wikipediaSearch(query,'mr'),
    wikipediaSearch(query,'en'),
    factpediaSearch(query),
  ]);
  const mr = tasks[0].status==='fulfilled' ? tasks[0].value : (errors.push('Marathi Wikipedia search failed'),[]);
  const en = tasks[1].status==='fulfilled' ? tasks[1].value : (errors.push('English Wikipedia search failed'),[]);
  const fp = tasks[2].status==='fulfilled' ? tasks[2].value : (errors.push('Factpedia search failed'),[]);
  const all = [...mr,...en,...fp];
  const unique = new Map<string,Source>();
  for (const source of all) {
    const key = source.url || source.id;
    const previous = unique.get(key);
    if (!previous || source.extract.length > previous.extract.length) unique.set(key,source);
  }
  const ranked = rankSources(query,Array.from(unique.values())).map(s => ({
    ...s,
    score:Math.min(1, s.score*0.55 + (s.provider==='Factpedia'?0.08:0.04) + (s.language=== (language==='mr'?'mr':'en')?0.12:0)),
  })).sort((a,b)=>b.score-a.score).slice(0,16);
  return {
    sources:ranked,language,errors,wikiMrCount:mr.length,wikiEnCount:en.length,
    factpediaCount:fp.length,queriesUsed:queryVariants(query),
  };
}
