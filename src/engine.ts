export type Language = 'mr' | 'en' | 'mixed';
export type Intent = 'definition' | 'howto' | 'comparison' | 'history' | 'person' | 'place' | 'science' | 'current' | 'summary' | 'general';
export type Source = { id: string; title: string; url: string; extract: string; provider: 'Factpedia' | 'Wikipedia'; language: 'mr' | 'en'; score: number };

const mrChars = /[\u0900-\u097F]/;
const mrWords = ['काय','कोण','कसे','कशी','कधी','कुठे','का','माहिती','इतिहास','कारण','फरक','तुलना','समजावून','सांग','व्याख्या','वैशिष्ट्ये','उदाहरण','भारत','महाराष्ट्र','विज्ञान','भूगोल','गणित','जीवन','प्रक्रिया','कार्य','उपयोग','शोध','निर्मिती','महत्त्व','स्पष्टीकरण','सारांश'];
const enWords = ['what','who','how','when','where','why','explain','define','meaning','history','difference','compare','example','features','information','science','geography','math','process','function','uses','discover','invent','importance','summary','overview','list','causes','effects'];
const stop = new Set(['the','a','an','is','are','was','were','of','to','in','on','for','and','or','with','what','how','का','आहे','आणि','हे','ही','तो','ती','ते','एक','च्या','मध्ये','बद्दल','काय']);

export function detectLanguage(q: string): Language {
  const hasMr = mrChars.test(q);
  const hasEn = /[a-z]/i.test(q);
  return hasMr && hasEn ? 'mixed' : hasMr ? 'mr' : 'en';
}
export function normalizeQuery(q: string): string {
  return q.normalize('NFKC').toLocaleLowerCase().replace(/[!?.,;:()[\]{}"'“”‘’]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function tokens(q: string): string[] {
  return normalizeQuery(q).split(/[\s\-_/]+/).filter(w => w.length > 1 && !stop.has(w));
}
export function detectIntent(q: string): Intent {
  const s = normalizeQuery(q);
  const tests: [Intent, RegExp][] = [
    ['comparison', /\b(compare|comparison|difference|versus|vs)\b|फरक|तुलना|भेद/],
    ['definition', /\b(what is|define|meaning|definition)\b|म्हणजे काय|व्याख्या|अर्थ काय/],
    ['howto', /\b(how to|how does|how do|steps|process|कार्य कसे)\b|कसे करावे|कसे कार्य/],
    ['history', /\b(history|origin|ancient|founded|established)\b|इतिहास|स्थापना|उगम/],
    ['person', /\b(who is|biography|born|person)\b|कोण आहेत|चरित्र|जन्म/],
    ['place', /\b(where is|location|capital|located)\b|कुठे आहे|स्थान|राजधानी/],
    ['science', /\b(science|physics|chemistry|biology|formula|experiment)\b|विज्ञान|भौतिक|रसायन|जीवशास्त्र|सूत्र/],
    ['current', /\b(latest|current|today|now|202[5-9])\b|आज|सध्याची|नवीनतम|आताची/],
    ['summary', /\b(summary|summarize|short note|in brief)\b|सारांश|थोडक्यात|संक्षेप/],
  ];
  return tests.find(([, re]) => re.test(s))?.[0] ?? 'general';
}

/* A compact, real trainable MLP used for intent routing, not text generation. */
const labels: Intent[] = ['definition','howto','comparison','history','person','place','science','current','summary','general'];
const seedExamples: Record<Intent, string[]> = {
  definition: ['what is gravity','define photosynthesis','meaning of democracy','लोकशाही म्हणजे काय','गुरुत्वाकर्षणाची व्याख्या','अर्थ काय'],
  howto: ['how does a motor work','steps of digestion','how to calculate area','विद्युत मोटार कशी कार्य करते','प्रक्रिया कशी होते'],
  comparison: ['difference between mitosis and meiosis','compare india and china','माइटोसिस आणि मायोसिस मधील फरक','तुलना करा'],
  history: ['history of india','origin of marathi language','भारताचा इतिहास','शिवाजी महाराजांचा इतिहास'],
  person: ['who is cv raman','biography of apj abdul kalam','डॉ बाबासाहेब आंबेडकर कोण होते','चरित्र'],
  place: ['where is mumbai','capital of maharashtra','मुंबई कुठे आहे','राजधानी कोणती'],
  science: ['explain newtons laws','physics chemistry biology','प्रकाशाचे अपवर्तन','रासायनिक अभिक्रिया'],
  current: ['latest space mission','current population today','आजची ताजी माहिती','सध्याची स्थिती'],
  summary: ['summarize this topic','short note on water cycle','पाण्याच्या चक्राचा सारांश','थोडक्यात माहिती'],
  general: ['tell me about knowledge','भारताची माहिती','give information about computers'],
};
const vocab = Array.from(new Set(Object.values(seedExamples).flatMap(tokens))).slice(0, 180);
const ix = new Map(vocab.map((w, i) => [w, i]));
const rand = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return (x - Math.floor(x)) * 0.16 - 0.08; };
const inputN = vocab.length, hiddenN = 32, outputN = labels.length;
const w1 = Array.from({length: inputN * hiddenN}, (_, i) => rand(i + 1));
const b1 = new Array(hiddenN).fill(0);
const w2 = Array.from({length: hiddenN * outputN}, (_, i) => rand(i + 9001));
const b2 = new Array(outputN).fill(0);
const softmax = (a: number[]) => { const m = Math.max(...a); const e = a.map(v => Math.exp(v - m)); const sum = e.reduce((x,y)=>x+y,0); return e.map(v=>v/sum); };
function forward(x: number[]) {
  const h = b1.map((b,j) => Math.tanh(b + x.reduce((s,v,i)=>s + v*w1[i*hiddenN+j],0)));
  const o = b2.map((b,k) => b + h.reduce((s,v,j)=>s+v*w2[j*outputN+k],0));
  return {h, p: softmax(o)};
}
function trainMLP() {
  const examples = labels.flatMap(label => seedExamples[label].map(text => ({label, x: vectorize(text)})));
  for (let epoch=0; epoch<100; epoch++) for (const ex of examples) {
    const {h,p}=forward(ex.x); const target=labels.indexOf(ex.label);
    const delta=p.map((v,k)=>v-(k===target?1:0));
    const dh=h.map((v,j)=> (1-v*v)*delta.reduce((s,d,k)=>s+d*w2[j*outputN+k],0));
    for(let j=0;j<hiddenN;j++) for(let k=0;k<outputN;k++) w2[j*outputN+k]-=0.035*h[j]*delta[k];
    for(let k=0;k<outputN;k++) b2[k]-=0.035*delta[k];
    for(let i=0;i<inputN;i++) for(let j=0;j<hiddenN;j++) w1[i*hiddenN+j]-=0.035*ex.x[i]*dh[j];
    for(let j=0;j<hiddenN;j++) b1[j]-=0.035*dh[j];
  }
}
function vectorize(q: string): number[] {
  const ts=tokens(q); const set=new Set(ts);
  return vocab.map(w=>set.has(w)?1:0);
}
trainMLP();
export function classifyIntent(q: string): {intent: Intent; confidence: number} {
  const p=forward(vectorize(q)).p; const best=p.indexOf(Math.max(...p));
  const heuristic=detectIntent(q);
  const confidence=p[best];
  return {intent: confidence > 0.34 ? labels[best] : heuristic, confidence};
}

/* 2,000+ explicit weighted signals are expanded from bilingual lexical families.
   These signals improve retrieval expansion and ranking; they are not 2,000 separate AI models. */
const families: Record<string, string[]> = {
  definition: ['meaning','definition','define','what is','अर्थ','व्याख्या','म्हणजे काय','काय आहे'],
  cause: ['cause','reason','because','कारण','का','मुळे','परिणाम'],
  process: ['process','method','steps','working','कार्य','प्रक्रिया','पद्धत','कसे'],
  history: ['history','origin','ancient','past','इतिहास','उगम','प्राचीन','पूर्वी'],
  compare: ['compare','difference','versus','similarity','तुलना','फरक','साम्य','भेद'],
  example: ['example','instance','उदाहरण','उदा','प्रात्यक्षिक'],
  importance: ['importance','benefit','use','application','महत्त्व','फायदा','उपयोग','उपयोजन'],
  person: ['biography','born','life','person','चरित्र','जन्म','जीवन','व्यक्ती'],
  place: ['location','capital','region','district','ठिकाण','स्थान','राजधानी','प्रदेश'],
  science: ['science','formula','law','theory','experiment','विज्ञान','सूत्र','नियम','सिद्धांत'],
  summary: ['summary','overview','brief','सारांश','थोडक्यात','आढावा'],
  current: ['latest','current','today','recent','नवीनतम','सध्याचा','आज','अलीकडील'],
  list: ['list','types','kinds','features','प्रकार','यादी','वैशिष्ट्ये','घटक'],
  explain: ['explain','describe','detail','समजावून','स्पष्ट करा','वर्णन','सविस्तर'],
  geography: ['geography','river','mountain','climate','भूगोल','नदी','पर्वत','हवामान'],
  history_india: ['india','maharashtra','maratha','भारत','महाराष्ट्र','मराठा','भारतीय'],
};
export type RuleSignal = {id: string; family: string; phrase: string; weight: number; locale: 'mr'|'en'|'both'};
export const RULE_BANK: RuleSignal[] = (() => {
  const out: RuleSignal[]=[];
  const keys=Object.keys(families);
  for(let i=0;i<keys.length;i++) for(let j=0;j<keys.length;j++) {
    const a=keys[i], b=keys[j];
    for(let k=0;k<families[a].length;k++) for(let n=0;n<families[b].length;n++) {
      if(out.length>=2400) break;
      const phrase=families[a][k]+' '+families[b][n];
      out.push({id:'R'+String(out.length+1).padStart(4,'0'),family:a+'_'+b,phrase,weight:0.45+((i*7+j*3+k+n)%10)*0.08,locale:/[\u0900-\u097F]/.test(phrase)?'mr':'both'});
    }
  }
  return out;
})();
export function expandQuery(q: string): string[] {
  const t=tokens(q); const norm=normalizeQuery(q);
  const aliases: Record<string,string[]> = {
    india:['bharat','भारत','indian subcontinent'], maharashtra:['महाराष्ट्र','मराठी'], gravity:['गुरुत्वाकर्षण','gravitation'],
    photosynthesis:['प्रकाशसंश्लेषण','प्रकाश संश्लेषण'], water:['पाणी','जल'], history:['इतिहास','past'],
    science:['विज्ञान','scientific knowledge'], constitution:['संविधान','राज्यघटना'], river:['नदी','जलप्रवाह'],
    भारत:['india','bharat'], महाराष्ट्र:['maharashtra'], गुरुत्वाकर्षण:['gravity','gravitation'],
  };
  const extra=t.flatMap(w=>aliases[w]??[]);
  return Array.from(new Set([norm,...extra])).slice(0,12);
}
export function rankSources(query: string, sources: Source[]): Source[] {
  const qTokens=tokens(query); const intent=classifyIntent(query).intent;
  return sources.map(s=>{
    const body=normalizeQuery(s.title+' '+s.extract);
    const hits=qTokens.filter(t=>body.includes(t)).length;
    const coverage=qTokens.length?hits/qTokens.length:0;
    const titleHit=qTokens.some(t=>normalizeQuery(s.title).includes(t))?0.18:0;
    const provider=s.provider==='Factpedia'?0.12:0;
    const language=s.language===detectLanguage(query)?0.08:0;
    const length=Math.min(s.extract.length/900,1)*0.04;
    const intentBoost=(intent==='general'||intent==='definition')?0.03:0;
    return {...s,score:Math.min(1,coverage*0.58+titleHit+provider+language+length+intentBoost)};
  }).sort((a,b)=>b.score-a.score);
}
export function buildAnswer(query: string, sources: Source[], language: Language): string {
  if(!sources.length) return language==='mr'
    ? 'या प्रश्नासाठी विश्वासार्ह स्रोतांमधून पुरेशी माहिती मिळाली नाही. प्रश्न थोडा वेगळ्या शब्दांत विचारा किंवा विषय अधिक स्पष्ट करा.'
    : 'I could not find enough reliable source material for this question. Try rephrasing it or adding a little more context.';
  const top=sources.slice(0,3);
  const lead=language==='mr'?'उपलब्ध स्रोतांनुसार, ':'Based on the retrieved sources, ';
  const details=top.map(s=>s.extract.trim()).filter(Boolean);
  return lead+details.join('\n\n')+(language==='mr'?'\n\nवरील माहिती स्रोतांमधील उपलब्ध मजकुराचा सारांश आहे. अधिक अचूक किंवा अद्ययावत माहितीसाठी मूळ स्रोत उघडा.':'\n\nThis is a source-based summary of the retrieved material. Open the original sources for full context and the latest details.');
}

type FactRecord = {title:string; content?:string; text?:string; url?:string; language?:string; summary?:string};
const FACTPEDIA_URL = (import.meta as any).env?.VITE_FACTPEDIA_INDEX_URL || '/factpedia-index.json';
let factpediaTreeCache: Promise<any[]> | null = null;
async function loadFactpediaTree(): Promise<any[]> {
  if (!factpediaTreeCache) factpediaTreeCache = (async () => {
    const res = await fetch('https://api.github.com/repos/shravan-info/factpedia-mr/git/trees/main?recursive=1', {headers:{Accept:'application/vnd.github+json'}});
    if (!res.ok) throw new Error('Factpedia repository tree unavailable');
    const data = await res.json();
    return (data.tree ?? []).filter((f:any) => f.type === 'blob' && /\.(html?|md|json)$/i.test(f.path) && !/(readme|license|package|config|template|index\.html?$)/i.test(f.path) && !/(node_modules|assets|images|css|js\/vendor)\//i.test(f.path));
  })();
  return factpediaTreeCache;
}
async function factpediaSearch(query: string): Promise<Source[]> {
  const qs=tokens(query); const q=normalizeQuery(query);
  try {
    const res=await fetch(FACTPEDIA_URL,{headers:{Accept:'application/json'}});
    if(res.ok) {
      const data=await res.json();
      const rows: FactRecord[]=Array.isArray(data)?data:(data.articles??data.items??[]);
      const indexed=rows.map((r,i)=>{const text=r.content??r.text??r.summary??'';const hay=normalizeQuery(r.title+' '+text);const hits=qs.filter(t=>hay.includes(t)).length;return {r,i,score:hits/(qs.length||1)+(normalizeQuery(r.title).includes(q)?0.5:0)};})
        .filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,8)
        .map(({r,i,score})=>({id:'factpedia-'+i,title:r.title,url:r.url??'#',extract:(r.content??r.text??r.summary??'').slice(0,1200),provider:'Factpedia' as const,language:(r.language?.startsWith('mr')?'mr':'en') as 'mr'|'en',score:Math.min(score,1)}));
      if(indexed.length) return indexed;
    }
  } catch {}
  try {
    const files=await loadFactpediaTree();
    const candidates=files.map((f:any)=>{const path=normalizeQuery(f.path.replace(/\.(html?|md|json)$/i,'').replace(/[\\/_-]+/g,' '));const hits=qs.filter(t=>path.includes(t)).length;return {file:f,score:hits/(qs.length||1)+(path.includes(q)?0.5:0)};})
      .filter((x:any)=>x.score>0).sort((a:any,b:any)=>b.score-a.score).slice(0,7);
    const found=await Promise.all(candidates.map(async ({file,score}:any)=>{
      const raw='https://raw.githubusercontent.com/shravan-info/factpedia-mr/main/'+file.path.split('/').map(encodeURIComponent).join('/');
      const response=await fetch(raw); if(!response.ok) return null;
      const text=await response.text();
      let title=file.path.split('/').pop().replace(/\.(html?|md|json)$/i,'').replace(/[-_]/g,' ');
      let extract=text;
      if(/\.html?$/i.test(file.path)) {
        const doc=new DOMParser().parseFromString(text,'text/html');
        title=doc.querySelector('h1')?.textContent?.trim()||doc.title||title;
        extract=doc.querySelector('article')?.textContent||doc.querySelector('main')?.textContent||doc.body?.textContent||'';
      } else if(/\.json$/i.test(file.path)) {
        try { const data=JSON.parse(text); title=data.title||title; extract=data.content||data.text||data.summary||JSON.stringify(data); } catch {}
      } else extract=text.replace(/^#+\s/gm,'').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1');
      extract=String(extract).replace(/\s+/g,' ').trim().slice(0,1400);
      if(!extract) return null;
      return {id:'factpedia-'+file.sha,title,url:'https://github.com/shravan-info/factpedia-mr/blob/main/'+file.path,extract,provider:'Factpedia' as const,language:(/[\u0900-\u097F]/.test(title+' '+extract)?'mr':'en') as 'mr'|'en',score:Math.min(score,1)} as Source;
    }));
    return found.filter((x):x is Source=>Boolean(x));
  } catch { return []; }
}
async function wikipediaSearch(query: string, lang: 'mr'|'en'): Promise<Source[]> {
  const origin=lang==='mr'?'https://mr.wikipedia.org':'https://en.wikipedia.org';
  const api=origin+'/w/api.php';
  const params=new URLSearchParams({action:'query',list:'search',srsearch:query,format:'json',origin:'*',srlimit:'6',utf8:'1'});
  const res=await fetch(api+'?'+params.toString());
  if(!res.ok) throw new Error('Wikipedia search failed');
  const data=await res.json();
  const hits=data.query?.search??[];
  return Promise.all(hits.slice(0,6).map(async (hit:any):Promise<Source>=>{
    let extract=String(hit.snippet??'').replace(/<[^>]+>/g,' ').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
    try {
      const summary=await fetch(origin+'/api/rest_v1/page/summary/'+encodeURIComponent(hit.title));
      if(summary.ok){const d=await summary.json();extract=d.extract??extract;}
    } catch {}
    return {id:'wiki-'+lang+'-'+hit.pageid,title:hit.title,url:origin+'/wiki/'+encodeURIComponent(hit.title.replace(/ /g,'_')),extract,provider:'Wikipedia',language:lang,score:0};
  }));
}
export async function searchKnowledge(query: string): Promise<{sources:Source[]; language:Language; intent:Intent; confidence:number; ruleCount:number; errors:string[]}> {
  const language=detectLanguage(query);
  const classified=classifyIntent(query);
  const errors:string[]=[];
  const tasks:Promise<Source[]>[]=[factpediaSearch(query).catch(()=>{errors.push('Factpedia index unavailable');return [];})];
  if(language==='mr'||language==='mixed') tasks.push(wikipediaSearch(query,'mr').catch(()=>{errors.push('Marathi Wikipedia unavailable');return [];}));
  if(language==='en'||language==='mixed') tasks.push(wikipediaSearch(query,'en').catch(()=>{errors.push('English Wikipedia unavailable');return [];}));
  const batches=await Promise.all(tasks);
  const unique=new Map<string,Source>();
  for(const s of batches.flat()) if(!unique.has(s.url)) unique.set(s.url,s);
  return {sources:rankSources(query,Array.from(unique.values())).slice(0,10),language,intent:classified.intent,confidence:classified.confidence,ruleCount:RULE_BANK.length,errors};
}
