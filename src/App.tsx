import { FormEvent, useMemo, useState } from 'react';
import { ArrowUp, Atom, BookOpen, Check, ChevronDown, Clock3, Globe2, Menu, Mic, Moon, Plus, Search, Sparkles, Sun, X } from 'lucide-react';
import { buildAnswer, searchKnowledge, type Source } from './engine';

type Turn = { id:number; question:string; answer:string; sources:Source[]; loading?:boolean; language:'mr'|'en'|'mixed' };
const starters = [
  {mr:'भारताच्या संविधानाची प्रमुख वैशिष्ट्ये कोणती?',en:'What are the key features of the Indian Constitution?',icon:'⚖'},
  {mr:'प्रकाशसंश्लेषण कसे कार्य करते?',en:'How does photosynthesis work?',icon:'🌱'},
  {mr:'महाराष्ट्रातील सह्याद्री पर्वतरांगांची माहिती',en:'Tell me about the Western Ghats',icon:'⛰'},
  {mr:'कृत्रिम बुद्धिमत्ता म्हणजे काय?',en:'What is artificial intelligence?',icon:'✦'},
];

export default function App() {
  const [query,setQuery]=useState('');
  const [turns,setTurns]=useState<Turn[]>([]);
  const [busy,setBusy]=useState(false);
  const [dark,setDark]=useState(false);
  const [language,setLanguage]=useState<'auto'|'mr'|'en'>('auto');
  const [menu,setMenu]=useState(false);
  const [history,setHistory]=useState<string[]>([]);
  const isHome=turns.length===0;
  const title=useMemo(()=>isHome?'Ask anything':'AI Mode', [isHome]);

  async function ask(value=query) {
    const q=value.trim(); if(!q||busy)return;
    setQuery(''); setBusy(true);
    const id=Date.now();
    setTurns(prev=>[...prev,{id,question:q,answer:'',sources:[],loading:true,language:/[\u0900-\u097F]/.test(q)?'mr':'en'}]);
    setHistory(prev=>[q,...prev].slice(0,12));
    try {
      const result=await searchKnowledge(q);
      const answer=buildAnswer(q,result.sources,language==='auto'?result.language:language);
      setTurns(prev=>prev.map(t=>t.id===id?{...t,answer,sources:result.sources,loading:false,language:result.language}:t));
    } catch {
      setTurns(prev=>prev.map(t=>t.id===id?{...t,answer:'Search could not be completed. Check your connection and try again.',loading:false}:t));
    } finally { setBusy(false); }
  }
  function submit(e:FormEvent){e.preventDefault();void ask();}
  function newChat(){setTurns([]);setQuery('');setMenu(false);}
  return <div className={dark?'app dark':'app'}>
    <header className="topbar">
      <div className="brand" onClick={newChat} role="button" tabIndex={0}><span className="brand-mark"><Sparkles size={19}/></span><span>Factpedia <b>AI Mode</b></span></div>
      <div className="top-actions">
        <div className="language-select"><Globe2 size={15}/><select value={language} onChange={e=>setLanguage(e.target.value as any)} aria-label="Answer language"><option value="auto">Auto</option><option value="mr">मराठी</option><option value="en">English</option></select><ChevronDown size={13}/></div>
        <button className="icon-btn" onClick={()=>setDark(!dark)} title="Toggle theme">{dark?<Sun size={18}/>:<Moon size={18}/>}</button>
        <button className="avatar">S</button>
      </div>
    </header>
    <main className={isHome?'main home':'main conversation'}>
      {isHome ? <section className="hero">
        <div className="hero-symbol"><Sparkles size={25}/></div>
        <p className="eyebrow">FACTPEDIA KNOWLEDGE ENGINE</p>
        <h1>What do you want to <span>know?</span></h1>
        <p className="subtitle">Explore knowledge with Factpedia and Wikipedia.<br/>Ask in Marathi or English.</p>
        <SearchBox query={query} setQuery={setQuery} submit={submit} busy={busy}/>
        <div className="suggestion-label">TRY ASKING</div>
        <div className="suggestions">{starters.map((s,i)=><button key={i} onClick={()=>void ask(language==='mr'?s.mr:s.en)}><span>{s.icon}</span>{language==='mr'?s.mr:s.en}<ArrowUp size={14}/></button>)}</div>
        <div className="source-pills"><span><span className="dot fact"/> Factpedia</span><span><span className="dot wiki"/> Wikipedia</span><span><Check size={13}/> Source-linked answers</span></div>
      </section> : <section className="thread">
        {turns.map(t=><article className="turn" key={t.id}>
          <div className="question-row"><div className="user-avatar">S</div><h2>{t.question}</h2></div>
          {t.loading?<div className="thinking"><span/><span/><span/> Searching trusted knowledge sources…</div>:<>
            <div className="answer-head"><span className="answer-icon"><Sparkles size={16}/></span><b>AI Overview</b><span className="verified"><Check size={12}/> Source-based</span></div>
            <div className="answer-text">{t.answer.split('\n').map((p,i)=>p&&<p key={i}>{p}</p>)}</div>
            <div className="sources-heading"><BookOpen size={16}/> Sources <span>{t.sources.length}</span></div>
            <div className="source-grid">{t.sources.map(s=><a className="source-card" href={s.url} target="_blank" rel="noreferrer" key={s.id}><div className="source-top"><span className={'source-favicon '+(s.provider==='Factpedia'?'fp':'wp')}>{s.provider==='Factpedia'?'F':'W'}</span><span>{s.provider}</span><span className="external">↗</span></div><b>{s.title}</b><p>{s.extract.slice(0,170)}{s.extract.length>170?'…':''}</p></a>)}</div>
            {!t.sources.length&&<p className="empty-source">No matching source was found. The Factpedia index may not be connected yet.</p>}
            <div className="answer-actions"><button onClick={()=>navigator.clipboard?.writeText(t.answer)}><BookOpen size={14}/> Copy answer</button><button onClick={()=>setQuery(t.question)}><Search size={14}/> Refine search</button></div>
          </>}
        </article>)}
        <SearchBox query={query} setQuery={setQuery} submit={submit} busy={busy} compact/>
      </section>}
    </main>
    <footer className="footer"><span>Factpedia AI Mode</span><span>Answers are generated from retrieved sources. Always verify important information.</span><button onClick={()=>setMenu(!menu)}><Clock3 size={14}/> Recent</button></footer>
    {menu&&<div className="history-pop"><div className="history-head">Recent searches <button onClick={()=>setMenu(false)}><X size={15}/></button></div>{history.length?history.map((h,i)=><button key={i} onClick={()=>{void ask(h);setMenu(false)}}><Clock3 size={14}/>{h}</button>):<p>No recent searches</p>}</div>}
  </div>;
}
function SearchBox({query,setQuery,submit,busy,compact=false}:{query:string;setQuery:(v:string)=>void;submit:(e:FormEvent)=>void;busy:boolean;compact?:boolean}) {
  return <form className={'search-box '+(compact?'compact':'')} onSubmit={submit}>
    <textarea value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();e.currentTarget.form?.requestSubmit();}}} placeholder="Ask anything… / काहीही विचारा" rows={compact?1:2}/>
    <div className="search-tools"><div><button type="button" className="tool-btn" title="Add context"><Plus size={17}/></button><button type="button" className="tool-btn web-toggle"><Globe2 size={15}/> Web & knowledge</button></div><div><button type="button" className="tool-btn" title="Voice input (coming soon)"><Mic size={17}/></button><button className="send-btn" type="submit" disabled={!query.trim()||busy} aria-label="Search"><ArrowUp size={19}/></button></div></div>
  </form>;
}
