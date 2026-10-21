(() => {
  const subjects = ['Core Mathematics','English Language','Chemistry','Biology','Additional Mathematics','Social Studies','Computer Science'];
  const $ = (selector, root=document) => root.querySelector(selector);
  const safe = value => typeof value === 'string' ? value : '';
  let interval = null, startedAt = 0, elapsed = 0, running = false, session = null;
  const format = seconds => String(Math.floor(seconds/60)).padStart(2,'0') + ':' + String(seconds%60).padStart(2,'0');

  function render() {
    const home = $('#view-home');
    const stats = home && $('.stats-grid', home);
    if (!stats || $('#focus-studio')) return;
    const card = document.createElement('section');
    card.id = 'focus-studio';
    card.className = 'focus-studio';
    card.innerHTML = `
      <div class="focus-intro"><span class="focus-kicker">STUDY SMARTER</span><h2>Focus studio</h2><p>Run a focused study session and save the time to your learning record.</p></div>
      <div class="focus-controls">
        <label>Subject<select id="focus-subject">${subjects.map(s=>'<option>'+s+'</option>').join('')}</select></label>
        <label>Topic<input id="focus-topic" maxlength="200" placeholder="e.g. Quadratic equations" required></label>
        <label>Session length<select id="focus-length"><option value="15">15 minutes</option><option value="25" selected>25 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select></label>
      </div>
      <div class="focus-bottom"><div class="focus-clock" id="focus-clock" aria-live="polite">25:00</div><div class="focus-buttons"><button class="button button-primary" id="focus-start">Start focus</button><button class="button button-light" id="focus-pause" disabled>Pause</button><button class="button button-light" id="focus-finish" disabled>Finish & save</button></div></div>
      <p class="focus-status" id="focus-status" role="status">Choose a topic, then start. Your session is saved only when you finish it.</p>`;
    stats.insertAdjacentElement('afterend', card);
    const goal = document.createElement('section');
    goal.id = 'weekly-goal';
    goal.className = 'weekly-goal';
    goal.innerHTML = `
      <div class="weekly-goal-heading"><div><span class="focus-kicker">YOUR WEEK, YOUR PACE</span><h2>Weekly study goal</h2><p>Progress is calculated from your saved learning records for the last 7 days.</p></div>
      <label>Weekly target<select id="weekly-goal-target"><option value="120">2 hours</option><option value="180" selected>3 hours</option><option value="300">5 hours</option><option value="420">7 hours</option></select></label></div>
      <div class="weekly-progress-track"><div id="weekly-progress-fill" class="weekly-progress-fill" style="width:0%"></div></div>
      <div class="weekly-progress-caption"><b id="weekly-progress-total">Sign in to load your saved study time</b><span id="weekly-progress-percent">—</span></div>
      <p id="weekly-progress-status" class="focus-status" role="status">Your progress will appear here when your account records are available.</p>`;
    card.insertAdjacentElement('afterend', goal);
    const target = $('#weekly-goal-target');
    try { const key=goalStorageKey(); const saved=localStorage.getItem(key); if(saved && ['120','180','300','420'].includes(saved)) target.value=saved; } catch {}
    target.addEventListener('change', () => { try { localStorage.setItem(goalStorageKey(),target.value); } catch {} refreshGoal(); });
    refreshGoal();
    $('#focus-length', card)?.addEventListener('change', () => { const length=$('#focus-length',card)?.value;const clock=$('#focus-clock',card);if (!session&&clock)clock.textContent=format(Number(length||25)*60); });
    $('#focus-start', card).addEventListener('click', start);
    $('#focus-pause', card).addEventListener('click', togglePause);
    $('#focus-finish', card).addEventListener('click', finish);
  }

  function goalStorageKey() { return 'getlearny_weekly_goal_'+((typeof state!=='undefined' && state.user && state.user.id) ? state.user.id : 'account'); }
  async function refreshGoal() {
    const totalEl=$('#weekly-progress-total'), percentEl=$('#weekly-progress-percent'), fill=$('#weekly-progress-fill'), status=$('#weekly-progress-status'), target=$('#weekly-goal-target');
    if (!totalEl || !percentEl || !fill || !status || !target) return;
    if (!(typeof state!=='undefined' && state.token)) { totalEl.textContent='Sign in to load your saved study time'; percentEl.textContent='—'; fill.style.width='0%'; status.textContent='Weekly progress uses your real learning records and becomes available after sign-in.'; return; }
    totalEl.textContent='Loading saved study time…'; status.textContent='Checking your learning records…';
    try {
      const result=await api('/learning-logs');
      const cutoff=Date.now()-7*24*60*60*1000;
      const logs=Array.isArray(result.logs)?result.logs:[];
      const minutes=logs.reduce((sum,log)=>{const date=Date.parse(log.created_at||'');return Number.isFinite(date)&&date>=cutoff?sum+Math.max(0,Number(log.minutes_spent)||0):sum;},0);
      const goalMinutes=Number(target.value)||180, percent=Math.min(100,Math.round(minutes/goalMinutes*100));
      totalEl.textContent=Math.floor(minutes/60)+'h '+(minutes%60)+'m of '+Math.floor(goalMinutes/60)+'h '+(goalMinutes%60?goalMinutes%60+'m':'');
      percentEl.textContent=percent+'%'; fill.style.width=percent+'%';
      status.textContent=minutes>=goalMinutes?'Weekly goal reached. Great work keeping a steady rhythm.':(goalMinutes-minutes)+' more minutes to reach this week’s target.';
    } catch(error) {
      totalEl.textContent='Study time unavailable'; percentEl.textContent='—'; fill.style.width='0%';
      status.textContent='Could not load your saved study records: '+(error?.message||'Connection error');
    }
  }
  function setStatus(message) { const el=$('#focus-status'); if(el) el.textContent=message; }
  function updateClock() {
    const length = session ? session.length*60 : Number($('#focus-length')?.value || 25)*60;
    const remaining = Math.max(0, length-elapsed);
    const clock=$('#focus-clock'); if(clock) clock.textContent=format(remaining);
    if (session && remaining===0) finish(true);
  }
  function start() {
    if (!(typeof state !== 'undefined' && state.token)) { setStatus('Sign in first so your focus session can be saved to your account.'); window.showView?.('profile'); return; }
    const topic = safe($('#focus-topic')?.value).trim();
    if (!topic) { setStatus('Enter the topic you are studying before starting.'); $('#focus-topic')?.focus(); return; }
    if (running) return;
    if (!session) { const subjectField=$('#focus-subject'),lengthField=$('#focus-length');if(!subjectField||!lengthField){alert('Focus controls are unavailable. Refresh the page and try again.');return;}session={subject:subjectField.value,topic,length:Number(lengthField.value)||25}; }
    startedAt=Date.now(); running=true;
    $('#focus-start').disabled=true; $('#focus-pause').disabled=false; $('#focus-pause').textContent='Pause'; $('#focus-finish').disabled=false;
    $('#focus-subject').disabled=true; $('#focus-topic').disabled=true; $('#focus-length').disabled=true;
    setStatus('Focus session running. Pause whenever you need a break.');
    interval=setInterval(()=>{elapsed+=1;updateClock();},1000);
  }
  function togglePause() {
    if (!session) return;
    if (running) {
      clearInterval(interval); interval=null; running=false;
      $('#focus-pause').textContent='Resume'; $('#focus-start').disabled=false;
      setStatus('Paused. Resume when you are ready.');
    } else start();
  }
  async function finish(completed=false) {
    if (!session || (!running && elapsed===0)) { setStatus('Start a session before saving it.'); return; }
    clearInterval(interval); interval=null; running=false;
    $('#focus-start').disabled=true; $('#focus-pause').disabled=true; $('#focus-finish').disabled=true;
    const minutes=Math.max(1,Math.round(elapsed/60));
    setStatus('Saving your focus session…');
    try {
      await api('/learning-logs',{method:'POST',body:JSON.stringify({
        subject:session.subject,topic:session.topic,minutes_spent:minutes,
        status:completed?'review':'started',
        notes:'Focus studio session'+(completed?' completed':' ended early')+'. Timer duration: '+session.length+' minutes.'
      })});
      setStatus((completed?'Session complete! ':'Session saved. ')+minutes+' minute'+(minutes===1?'':'s')+' added to your learning record.');
      if (typeof loadDashboard==='function') loadDashboard();
      refreshGoal();
    } catch (error) {
      setStatus('Could not save this session: '+(error?.message||'Connection error')+'. Your session is kept here; reconnect and tap Finish & save to retry.');
      $('#focus-finish').disabled=false;
      return;
    }
    if (completed) { if (typeof toast==='function') toast('Focus session completed and saved.'); }
    session=null; elapsed=0;
    $('#focus-start').disabled=false; $('#focus-pause').disabled=true; $('#focus-finish').disabled=true;
    $('#focus-subject').disabled=false; $('#focus-topic').disabled=false; $('#focus-length').disabled=false;
    $('#focus-start').textContent='Start another session';
    updateClock();
  }
  document.addEventListener('DOMContentLoaded', render);
  const observer = new MutationObserver(() => { if ($('#view-home.active')) render(); });
  observer.observe(document.documentElement,{attributes:true,subtree:true,attributeFilter:['class']});
  if (document.readyState!=='loading') render();
})();