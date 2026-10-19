(() => {
  const $ = (s, root=document) => root.querySelector(s);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateOf = item => {
    const raw = item?.created_at || item?.taken_at || item?.date || item?.createdAt;
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const dayKey = date => date.getFullYear()+'-'+date.getMonth()+'-'+date.getDate();
  function studyStreak(logs) {
    const days = new Set(logs.map(dateOf).filter(Boolean).map(dayKey));
    const today = new Date();
    const cursor = new Date(today.getFullYear(),today.getMonth(),today.getDate());
    if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate()-1);
    let count=0;
    while(days.has(dayKey(cursor)) && count<365) { count++; cursor.setDate(cursor.getDate()-1); }
    return count;
  }
  function renderRevisionInsights() {
    const stats = $('.stats-grid', $('#view-home') || document);
    if (!stats) return;
    let panel = $('#revision-insights');
    if (!panel) {
      panel=document.createElement('section');
      panel.id='revision-insights';
      panel.className='revision-insights';
      stats.insertAdjacentElement('afterend',panel);
    }
    const signedIn = typeof state !== 'undefined' && Boolean(state.token);
    if (!signedIn) {
      panel.innerHTML='<div class="revision-heading"><div><span class="revision-kicker">PERSONALISED REVISION</span><h2>Your revision plan</h2><p>Sign in to use your saved test results and study history.</p></div><button type="button" class="button button-primary" data-revision-signin>Sign in →</button></div>';
      $('[data-revision-signin]',panel).onclick=()=>showView('profile');
      return;
    }
    const tests=Array.isArray(state.tests)?state.tests:[];
    const logs=Array.isArray(state.logs)?state.logs:[];
    const streak=studyStreak(logs);
    const grouped=new Map();
    tests.forEach(test=>{
      const subject=String(test.subject||'').trim();
      const score=Number(test.score), max=Number(test.max_score);
      if(!subject || !Number.isFinite(score) || !Number.isFinite(max) || max<=0 || score<0 || score>max) return;
      const list=grouped.get(subject)||[];
      list.push({pct:score/max*100,date:dateOf(test)});
      grouped.set(subject,list);
    });
    const priorities=[...grouped.entries()].map(([subject,results])=>{
      results.sort((a,b)=>(b.date?.getTime()||0)-(a.date?.getTime()||0));
      const recent=results.slice(0,3);
      return {subject,pct:Math.round(recent.reduce((sum,r)=>sum+r.pct,0)/recent.length),attempts:recent.length};
    }).sort((a,b)=>a.pct-b.pct).slice(0,3);
    const studyText=streak===1?'1 day':streak+' days';
    const priorityMarkup=priorities.length?'<div class="revision-priorities">'+priorities.map(item=>{
      const label=item.pct<50?'Needs attention':item.pct<70?'Worth revising':'Keep practising';
      return '<article class="revision-priority"><div class="revision-priority-top"><b>'+esc(item.subject)+'</b><span class="revision-score">'+item.pct+'%</span></div><div class="revision-track"><span style="width:'+item.pct+'%"></span></div><div class="revision-priority-bottom"><small>'+label+' · latest '+item.attempts+' test'+(item.attempts===1?'':'s')+'</small><button type="button" data-revision-practice="'+esc(item.subject)+'">Practise →</button></div></article>';
    }).join('')+'</div>':'<div class="revision-empty"><b>No test results to analyse yet</b><p>Record a class test or practice score in Test Tracker. Your revision priorities will be based on those saved results, not guessed scores.</p><button type="button" class="button button-light" data-revision-tests>Open Test Tracker →</button></div>';
    panel.innerHTML='<div class="revision-heading"><div><span class="revision-kicker">BUILT FROM YOUR SAVED RECORDS</span><h2>Smart revision planner</h2><p>Use recent test results to decide what to practise next.</p></div><div class="revision-streak"><span>STUDY STREAK</span><b>'+streak+'</b><small>'+studyText+'</small></div></div>'+priorityMarkup+'<div class="revision-footnote">'+logs.length+' saved learning record'+(logs.length===1?'':'s')+' · '+tests.length+' saved test result'+(tests.length===1?'':'s')+'</div>';
    $('[data-revision-tests]',panel)?.addEventListener('click',()=>showView('tests'));
    panel.querySelectorAll('[data-revision-practice]').forEach(button=>button.addEventListener('click',()=>{
      state.quizSubject=button.dataset.revisionPractice;
      state.quizQuestions=[];state.quizDone=false;state.quizAnswers=[];state.quizFeedback='';state.quizGrading=false;
      showView('practice');renderQuiz();
    }));
  }
  window.renderRevisionInsights=renderRevisionInsights;
  document.addEventListener('DOMContentLoaded',renderRevisionInsights);
  const observer=new MutationObserver(()=>{if($('#view-home.active'))renderRevisionInsights()});
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  if(document.readyState!=='loading')renderRevisionInsights();
})();