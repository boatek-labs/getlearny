(()=> {
  const $ = (selector, root=document) => root.querySelector(selector);
  const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
  const menu=$('#menu-toggle'), nav=$('#site-nav');
  if(menu&&nav){
    menu.addEventListener('click',()=>{
      const open=menu.getAttribute('aria-expanded')!=='true';
      menu.setAttribute('aria-expanded',String(open));
      nav.classList.toggle('open',open);
    });
    $$('a',nav).forEach(a=>a.addEventListener('click',()=>{
      menu.setAttribute('aria-expanded','false');
      nav.classList.remove('open');
    }));
    document.addEventListener('click',e=>{
      if(!nav.contains(e.target)&&!menu.contains(e.target)){
        menu.setAttribute('aria-expanded','false');
        nav.classList.remove('open');
      }
    });
  }
  const year=$('#year');
  if(year) year.textContent=new Date().getFullYear();

  // Keep visitors on the public homepage. Signed-in learners get a clear dashboard route.
  let signedIn=false;
  try { signedIn=Boolean(localStorage.getItem('gl_token')); } catch(e) {}
  if(signedIn){
    $$('[data-auth-login]').forEach(a=>{a.href='/app.html';a.textContent='Dashboard';a.classList.add('nav-dashboard');});
    $('a[href*="auth=signup"]').forEach(a=>{
      a.href='/app.html';
      const span=$('span',a);
      const label=a.classList.contains('nav-signup')?'Open dashboard':'Go to dashboard';
      a.textContent=label+' ';
      if(span){a.appendChild(span);span.textContent='→';}
      else a.insertAdjacentHTML('beforeend','<span>→</span>');
    });
    const proof=$('.hero-proof p');
    if(proof){proof.innerHTML='<b>Welcome back to your learning space.</b><small>Your next step is waiting in the dashboard.</small>';}
    const eyebrow=$('.hero-content .eyebrow');
    if(eyebrow) eyebrow.innerHTML='<span class="eyebrow-dot"></span> WELCOME BACK, LEARNER';
  }

  if('IntersectionObserver' in window&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
      if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target);}
    }),{threshold:.12,rootMargin:'0px 0px -30px 0px'});
    $$('.reveal').forEach(el=>observer.observe(el));
  }else $$('.reveal').forEach(el=>el.classList.add('is-visible'));
})();