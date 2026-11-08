import { classifyIntent, detectLanguage, normalizeQuery, tokens, type Language, type Source } from './engine';
import type { GLEResponse, GLESection } from './gle';
import type { RetrievalV5Result } from './retrieval-v5';

type EvidenceSentence = {text:string;source:Source;score:number};
const STOP = new Set([
  'what','where','when','who','why','how','tell','about','give','show','information','details','explain','describe','is','are','the','of','for','in','on','and','or','to','a','an','does','do','which','that','this','with',
  'काय','कसे','कशी','कसा','कोण','कुठे','कधी','का','माहिती','सांगा','द्या','बद्दल','विषयी','स्पष्ट','करा','आहे','होते','असते','याबद्दल','थोडक्यात','म्हणजे','आणि','यांची','यांचे','याचा','याची','यात','होतात','होतो','एक','प्रमुख','कोणती','कोणते','समजावून','सांग','सोप्या','मराठीत',
]);
const SYNONYMS:Record<string,string[]> = {
  'ऋतू':['seasons','season','axial tilt','earth tilt','climate'],
  'वैशिष्ट्ये':['features','characteristics','preamble','fundamental rights','directive principles','राज्यव्यवस्था','मूलभूत हक्क'],
  'पृथ्वी':['earth','planet','axis','orbit'],
  'निर्माण':['caused','cause','occur','formation'],
  'संविधान':['constitution','constitutional','राज्यघटना'],
  'भारतीय':['india','indian'],
  'वैशिष्ट्ये':['features','characteristics','salient'],
  'माणगाव':['mangaon'],
  'भौगोलिक':['geography','geographical','location'],
  'ऐतिहासिक':['history','historical'],
  'आर्थिक':['economy','economic'],
  'gravity':['गुरुत्वाकर्षण','gravitation'],
  'photosynthesis':['प्रकाशसंश्लेषण'],
  'constitution':['संविधान','राज्यघटना'],
  'seasons':['ऋतू','ऋतुमान','पृथ्वीचा अक्ष'],
};
const SPLIT = /(?<=[.!?।॥])\s+|\n+/u;

function termsFor(query:string):string[] {
  const base = tokens(query).filter(t=>!STOP.has(t));
  const expanded = base.flatMap(t=>SYNONYMS[t]??Object.entries(SYNONYMS).find(([key])=>t.startsWith(key)&&key.length>2)?.[1]??[]);
  return [...new Set([...base,...expanded].map(normalizeQuery).filter(t=>t.length>1))];
}
function clean(input:string):string {
  return input.replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
    .replace(/^\s*(title|description|keywords|slug|layout|permalink)\s*:\s*.*$/gim,' ')
    .replace(/^\s*\|.*\|\s*$/gm,' ').replace(/^\s*[-|:\s]{3,}\s*$/gm,' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm,'').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1')
    .replace(/\*\*([^*]+)\*\*/g,'$1').replace(/\s+/g,' ').trim();
}
function overlap(queryTerms:string[], text:string):number {
  const normalized = ' ' + normalizeQuery(text).replace(/[^\\p{L}\\p{N}]+/gu,' ') + ' ';
  const hits = queryTerms.filter(term=>normalized.includes(' ' + normalizeQuery(term) + ' '));
  return queryTerms.length ? hits.length/queryTerms.length : 0;
}
function titleScore(queryTerms:string[],title:string):number {
  return overlap(queryTerms,title);
}
function collectEvidence(query:string,sources:Source[],language:Language):EvidenceSentence[] {
  const qTerms=termsFor(query);
  const out:EvidenceSentence[]=[];
  for(const source of sources) {
    const title=titleScore(qTerms,source.title);
    const body=clean(source.extract);
    if(!body) continue;
    const parts=body.split(SPLIT);
    for(const part of parts) {
      const text=part.trim();
      if(text.length<35||text.length>760) continue;
      if(/^(references|external links|see also|संदर्भ|बाह्य दुवे)\b/i.test(text)) continue;
      const bodyScore=overlap(qTerms,text);
      if(bodyScore===0 && title<0.34) continue;
      const langBonus=source.language===(language==='mr'?'mr':'en')?0.09:0;
      const providerBonus=source.provider==='Factpedia'?0.035:0.02;
      const score=bodyScore*0.66+title*0.25+langBonus+providerBonus+Math.min(text.length/3000,0.025);
      out.push({text,source,score});
    }
  }
  const seen=new Set<string>();
  return out.sort((a,b)=>b.score-a.score).filter(item=>{
    const key=normalizeQuery(item.text).slice(0,180);
    if(seen.has(key)) return false;
    seen.add(key);return true;
  }).slice(0,8);
}
function compose(query:string,evidence:EvidenceSentence[],language:Language):GLESection[] {
  if(!evidence.length) return [];
  const mr=language==='mr';
  const subject=query.trim().replace(/[?？!।]+$/g,'');
  const intro=mr
    ? 'तुमच्या प्रश्नातील विषयाशी संबंधित Wikipedia आणि Factpedia मधील उपलब्ध लेख तपासले. खाली संबंधित माहिती आणि तिचे स्रोत दिले आहेत.'
    : 'I searched the relevant Marathi and English Wikipedia articles and Factpedia entries. The evidence below is organized around your question.';
  const paragraphs=evidence.slice(0,6).map(item=>{
    const citation='〔'+item.source.provider+': '+item.source.title+'〕';
    const sourceLanguage=item.source.language===(mr?'mr':'en')?'':' ('+(item.source.language==='mr'?'मराठी स्रोत':'English source')+')';
    return item.text+' '+citation+sourceLanguage;
  });
  const headings=mr?['उत्तर','स्रोतांमधील संबंधित माहिती']:['Answer','Relevant source evidence'];
  return [{heading:headings[0],paragraphs:[intro+' विषय: '+subject+'.']},{heading:headings[1],paragraphs}];
}
export function generateGLEv5Response(query:string,retrieval:RetrievalV5Result,preferredLanguage?:Language):GLEResponse {
  const detected=detectLanguage(query);
  const language:Language=preferredLanguage==='mixed'?(detected==='mr'?'mr':'en'):(preferredLanguage??detected);
  const {intent}=classifyIntent(query);
  const evidence=collectEvidence(query,retrieval.sources,language);
  const sourcesUsed=new Set(evidence.map(e=>e.source.id));
  const best=evidence[0]?.score??0;
  const confidence=Math.max(0,Math.min(0.96,best*0.72+Math.min(sourcesUsed.size,4)*0.045));
  const sections=compose(query,evidence,language);
  const insufficient=language==='mr'
    ? 'Wikipedia (मराठी व इंग्रजी) आणि Factpedia मध्ये या प्रश्नाशी थेट जुळणारा पुरेसा मजकूर सापडला नाही. प्रश्नातील विषय किंवा नाव अधिक स्पष्ट करून विचारा.'
    : 'I could not find enough directly relevant text in Marathi Wikipedia, English Wikipedia, or Factpedia. Try adding the exact topic or subject name.';
  const answer=sections.length?sections.map(s=>s.heading+'\n'+s.paragraphs.join('\n\n')).join('\n\n'):insufficient;
  return {answer,sections,intent,language,confidence,evidenceCount:evidence.length,mode:evidence.length?'evidence-grounded':'insufficient-evidence',note:''};
}
export function getGLEv5Diagnostics(response:GLEResponse,retrieval:RetrievalV5Result):string {
  const mr=response.language==='mr';
  const status=mr?'GLE v5++':'GLE v5++';
  return status+' · '+response.intent+' · '+Math.round(response.confidence*100)+'% evidence match · '+response.evidenceCount+' passages · Wikipedia MR '+retrieval.wikiMrCount+' / EN '+retrieval.wikiEnCount+' · Factpedia '+retrieval.factpediaCount+(retrieval.errors.length?' · Retrieval warnings '+retrieval.errors.length:'');
}
