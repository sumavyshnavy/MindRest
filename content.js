// content.js - robust listener, responds to PING and handles triggers
(function(){
  const METRIC_WINDOW_MS = 3000;
  let lastScrollY = window.scrollY;
  let lastScrollTs = performance.now();
  let scrollVelocity = 0;
  let tabSwitchCount = 0;
  let lastInteractionTs = Date.now();
  let revisitCount = 0;
  let lastVisitedUrl = window.location.href;
  let overlay = null;
  let overlayShownAt = 0;
  const OVERLAY_MIN_MS = 25000;

  function log(...args){ try{ console.debug('MindRest(content):',...args);}catch(e){}}

  function onUserInteraction(){ lastInteractionTs = Date.now(); }
  ['mousemove','keydown','mousedown','touchstart','scroll'].forEach(evt=>window.addEventListener(evt,onUserInteraction,{passive:true}));

  window.addEventListener('scroll', () => {
    const now = performance.now();
    const dy = Math.abs(window.scrollY - lastScrollY);
    const dt = Math.max(16, now - lastScrollTs);
    const v = dy/dt;
    scrollVelocity = (scrollVelocity*0.8) + (v*0.2);
    lastScrollY = window.scrollY; lastScrollTs = now;
  }, {passive:true});

  chrome.runtime.onMessage.addListener((msg,sender,sendResp)=>{
    if(!msg || !msg.type) return;
    if(msg.type === 'MINDREST_TRIGGER'){ log('Received TRIGGER', msg.payload); try{ showOverlay(msg.payload);}catch(e){console.error(e);} }
    if(msg.type === 'MINDREST_EVENT' && msg.event === 'tab_activated'){ tabSwitchCount = Math.min(1, tabSwitchCount+1); }
    if(msg.type === 'MINDREST_PING'){ sendResp({ ok: true }); }
  });

  function normalizeTabSwitch(count){ return Math.min(1, count/4); }
  function normalizeScrollVelocity(v){ return Math.min(1, v/0.28); }
  function normalizeIdleTime(idleMs){ return Math.min(1, idleMs/90000); }
  function normalizeRevisits(rev){ return Math.min(1, rev/2); }

  setInterval(()=>{
    const now = Date.now();
    const idleMs = now - lastInteractionTs;
    if(window.location.href !== lastVisitedUrl){ revisitCount +=1; lastVisitedUrl = window.location.href; }
    const payload = { tabSwitch: normalizeTabSwitch(tabSwitchCount), scrollVelocity: normalizeScrollVelocity(scrollVelocity), idleTime: normalizeIdleTime(idleMs), revisits: normalizeRevisits(revisitCount) };
    tabSwitchCount = 0; revisitCount = 0;
    try{ chrome.runtime.sendMessage({ type: 'MINDREST_METRICS', payload }); }catch(e){ console.warn('MindRest: sendMessage failed', e); }
    log('Sent metrics', payload);
  }, METRIC_WINDOW_MS);

  function createOverlay(){
    if(document.getElementById('mindrest-dark-overlay')) return;
    overlay = document.createElement('div'); overlay.id='mindrest-dark-overlay';
    overlay.innerHTML = '<div id="mindrest-card" role="dialog" aria-modal="true"><h2 id="mr-title">MindRest</h2><p id="mr-text">We detected signs of mental overload. A short 30-second reset can help refocus.</p><div id="mr-actions"><button id="mr-reset" class="mr-btn primary">Start 30s Reset</button><button id="mr-summary" class="mr-btn secondary">Quick Summary</button><button id="mr-dismiss" class="mr-btn ghost">Dismiss</button></div><div id="mr-summary-area" style="display:none;margin-top:10px"></div></div>';
    document.documentElement.appendChild(overlay);
    overlay.querySelector('#mr-reset').addEventListener('click', startFocusReset);
    overlay.querySelector('#mr-summary').addEventListener('click', showQuickSummary);
    overlay.querySelector('#mr-dismiss').addEventListener('click', hideOverlay);
    overlay.addEventListener('click',(e)=>{ if(e.target===overlay) hideOverlay(); });
  }

  function injectStyle(){
    if(document.getElementById('mindrest-style')) return;
    const s = document.createElement('style'); s.id='mindrest-style';
    s.textContent = `
      #mindrest-dark-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.62);display:flex;align-items:center;justify-content:center;}
      #mindrest-card{background: linear-gradient(180deg,#e6fffb,#f0fdfa); color:#023047; padding:22px; border-radius:14px; max-width:560px; width:88%; box-shadow: 0 16px 60px rgba(2,6,23,0.45); font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial;}
      .mr-btn{padding:9px 12px;border-radius:10px;border:none;cursor:pointer;}
      .mr-btn.primary{background:linear-gradient(180deg,#00796b,#004d40);color:white;}
      .mr-btn.secondary{background:#e8f6f4;color:#00796b;}
      .mr-btn.ghost{background:transparent;color:#05445E;}
    `;
    document.head.appendChild(s);
  }

  function showOverlay(payload){
    injectStyle(); createOverlay();
    const title = document.getElementById('mr-title'); const text = document.getElementById('mr-text');
    if(payload && payload.F){ title.textContent='You look overloaded'; text.textContent=`Recent activity shows elevated cognitive load (score ${payload.F.toFixed(2)}). Try a short reset.`; }
    else { title.textContent='Take a short break'; text.textContent='A 30-second reset may help you refocus.'; }
    const el = document.getElementById('mindrest-dark-overlay'); if(el) el.style.display='flex';
    overlayShownAt = Date.now();
  }

  function hideOverlay(){ const el=document.getElementById('mindrest-dark-overlay'); if(el) el.style.display='none'; }

  let resetInterval = null;
  function startFocusReset(){
    document.documentElement.style.transition='filter 0.3s ease'; document.documentElement.style.filter='brightness(0.82) saturate(0.95)';
    const area = document.getElementById('mr-summary-area'); if(!area) return; area.style.display='block';
    let t=30; area.textContent='Reset: '+t+'s';
    if(resetInterval) clearInterval(resetInterval);
    resetInterval = setInterval(()=>{ t-=1; area.textContent='Reset: '+t+'s'; if(t<=0){ clearInterval(resetInterval); document.documentElement.style.filter=''; area.style.display='none'; hideOverlay(); } },1000);
  }

  function showQuickSummary(){
    const area = document.getElementById('mr-summary-area'); if(!area) return;
    const title = document.title || ''; let text=''; const paras = Array.from(document.querySelectorAll('p'));
    for(const p of paras){ const t=p.innerText.trim(); if(t.length>60){ text=t; break; } }
    if(!text){ const meta=document.querySelector('meta[name="description"]')||document.querySelector('meta[property="og:description"]'); if(meta) text=meta.content||''; }
    if(!text) text='No clear summary available.';
    area.style.display='block'; area.innerHTML = '<strong>'+escapeHtml(title)+'</strong><p style="margin-top:8px">'+escapeHtml(text)+'</p>';
  }

  function escapeHtml(s){ return s.replace(/[&<>'""]/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  setInterval(()=>{ const el=document.getElementById('mindrest-dark-overlay'); if(!el) return; if(overlayShownAt && Date.now()-overlayShownAt>OVERLAY_MIN_MS) hideOverlay(); },5000);

  window.MINDREST = { showOverlay, hideOverlay };
  try{ console.debug('MindRest(content): initialized on', location.href); }catch(e){}
})();
