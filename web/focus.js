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
    $('#focus-length', card).addEventListener('change', () => { if (!session) $('#focus-clock').textContent = format(Number($('#focus-length').value)*60); });
    $('#focus-start', card).addEventListener('click', start);
    $('#focus-pause', card).addEventListener('click', togglePause);
    $('#focus-finish', card).addEventListener('click', finish);
  }

  function setStatus(message) { const el=$('#focus-status'); if(el) el.textContent=message; }
  function updateClock() {
    const length = session ? session.length*60 : Number($('#focus-length')?.value || 25)*60;
    const remaining = Math.max(0, length-elapsed);
    const clock=$('#focus-clock'); if(clock) clock.textContent=format(remaining);
    if (session && remaining===0) finish(true);
  }
  function start() {
    if (!window.state?.token) { setStatus('Sign in first so your focus session can be saved to your account.'); window.showView?.('profile'); return; }
    const topic = safe($('#focus-topic')?.value).trim();
    if (!topic) { setStatus('Enter the topic you are studying before starting.'); $('#focus-topic')?.focus(); return; }
    if (running) return;
    if (!session) session={subject:$('#focus-subject').value,topic,length:Number($('#focus-length').value)};
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
      await window.api('/learning-logs',{method:'POST',body:JSON.stringify({
        subject:session.subject,topic:session.topic,minutes_spent:minutes,
        status:completed?'completed':'started',
        notes:'Focus studio session'+(completed?' completed':' ended early')+'. Timer duration: '+session.length+' minutes.'
      })});
      setStatus((completed?'Session complete! ':'Session saved. ')+minutes+' minute'+(minutes===1?'':'s')+' added to your learning record.');
      if (typeof window.loadDashboard==='function') window.loadDashboard();
    } catch (error) {
      setStatus('Could not save this session: '+(error?.message||'Connection error')+'. Keep this page open and try again after reconnecting.');
      $('#focus-finish').disabled=false;
    }
    if (completed) window.toast?.('Focus session completed and saved.');
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