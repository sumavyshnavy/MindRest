// popup.js v5 - ensure DND and debug messages reliably reach background
document.addEventListener('DOMContentLoaded', async () => {
  const scoreEl = document.getElementById('score');
  const btnPreview = document.getElementById('btn-preview');
  const btnReset = document.getElementById('btn-reset');
  const sensBtns = Array.from(document.querySelectorAll('.sens'));
  const dnd10 = document.getElementById('dnd-10');
  const dnd30 = document.getElementById('dnd-30');
  const dnd60 = document.getElementById('dnd-60');
  const dnd240 = document.getElementById('dnd-240');
  const dnd480 = document.getElementById('dnd-480');
  const dndTomorrow = document.getElementById('dnd-tomorrow');
  const dndOff = document.getElementById('dnd-off');
  const autoTest = document.getElementById('auto-test');

  async function refresh() {
    const data = await chrome.storage.local.get(['mindrest_state', 'mindrest_settings', 'mindrest_dnd_until', 'mindrest_debug']);
    const st = data.mindrest_state || { lastF: 0 };
    scoreEl.textContent = (st.lastF || 0).toFixed(2);
    const s = data.mindrest_settings || {};
    const level = s.sensitivity || 'med';
    sensBtns.forEach(b => b.classList.toggle('active', b.dataset.level === level));
    const dbg = data.mindrest_debug || { autoTest:false };
    autoTest.checked = !!dbg.autoTest;
  }

  async function sendTriggerToActiveTab(payload) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0] || !tabs[0].id) {
      console.warn('MindRest popup: no active tab to send message to.');
      return;
    }
    const tabId = tabs[0].id;
    try { await chrome.tabs.sendMessage(tabId, { type: 'MINDREST_TRIGGER', payload }); return; } catch(err) { console.warn('sendMessage failed', err); }
    try {
      await chrome.scripting.executeScript({ target: { tabId }, func: (payload)=>{ if(window.MINDREST && window.MINDREST.showOverlay) { window.MINDREST.showOverlay(payload); return; } if(document.getElementById('mindrest-dark-overlay')) return; const overlay=document.createElement('div'); overlay.id='mindrest-dark-overlay'; overlay.style.position='fixed'; overlay.style.inset='0'; overlay.style.zIndex='2147483647'; overlay.style.background='rgba(0,0,0,0.62)'; overlay.style.display='flex'; overlay.style.alignItems='center'; overlay.style.justifyContent='center'; overlay.innerHTML='<div style="background: linear-gradient(180deg,#e6fffb,#f0fdfa); color:#023047; padding:22px; border-radius:14px; max-width:560px; width:88%; box-shadow: 0 16px 60px rgba(2,6,23,0.45); font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial;"><h2 style="margin:0 0 8px 0">MindRest</h2><p style="margin:0 0 12px 0">A short 30s reset may help you refocus.</p><div style="display:flex;gap:10px;"><button id="mr-reset" style="padding:9px 12px;border-radius:10px;border:none;background:linear-gradient(180deg,#00796b,#004d40);color:white;">Start 30s Reset</button><button id="mr-dismiss" style="padding:9px 12px;border-radius:10px;border:none;background:transparent;color:#05445E;">Dismiss</button></div><div id="mr-summary-area" style="display:none;margin-top:10px"></div></div>'; document.documentElement.appendChild(overlay); document.getElementById('mr-dismiss')?.addEventListener('click', ()=> overlay.remove()); document.getElementById('mr-reset')?.addEventListener('click', ()=>{ document.documentElement.style.filter='brightness(0.82)'; setTimeout(()=>{ document.documentElement.style.filter=''; overlay.remove(); },30000); }); }, args:[payload] });
    } catch(e){ console.error('scripting fallback failed', e); }
  }

  btnPreview.addEventListener('click', async ()=> { await sendTriggerToActiveTab({ F:0.9, Fcrit:0.6 }); });

  btnReset.addEventListener('click', async () => {
    await chrome.storage.local.set({ mindrest_state: { Fcrit: 0.65, lastF: 0, lastTriggerAt: 0, consecutiveHigh: 0 } });
    await chrome.storage.local.set({ mindrest_settings: { cooldownSeconds: 30, smoothingAlpha: 0.5, minConsecutive: 1, sensitivity: 'med' } });
    refresh();
  });

  sensBtns.forEach(b => b.addEventListener('click', async (e) => {
    const level = b.dataset.level;
    let settings = {};
    if (level === 'low') {
      settings = { cooldownSeconds: 120, smoothingAlpha: 0.8, weights: { tabSwitch:0.25, scrollVelocity:0.2, idleTime:0.15, revisits:0.1 }, minConsecutive: 3 };
    } else if (level === 'med') {
      settings = { cooldownSeconds: 30, smoothingAlpha: 0.5, weights: { tabSwitch:0.35, scrollVelocity:0.25, idleTime:0.15, revisits:0.15 }, minConsecutive: 2 };
    } else {
      settings = { cooldownSeconds: 10, smoothingAlpha: 0.35, weights: { tabSwitch:0.5, scrollVelocity:0.3, idleTime:0.2, revisits:0.2 }, minConsecutive: 1 };
    }
    await chrome.storage.local.set({ mindrest_settings: { ...settings, sensitivity: level } });
    const baseline = level === 'low' ? 0.75 : level === 'med' ? 0.65 : 0.5;
    await chrome.storage.local.set({ mindrest_state: { Fcrit: baseline, lastF:0, lastTriggerAt:0, consecutiveHigh:0 } });
    refresh();
  }));

  const setDnd = async (mins) => {
    const until = mins ? (Date.now() + mins*60*1000) : 0;
    await chrome.storage.local.set({ mindrest_dnd_until: until });
    // notify background as well
    chrome.runtime.sendMessage({ type: 'MINDREST_SET_DND', until });
    refresh();
  };

  dnd10.addEventListener('click', ()=> setDnd(10));
  dnd30.addEventListener('click', ()=> setDnd(30));
  dnd60.addEventListener('click', ()=> setDnd(60));
  dnd240.addEventListener('click', ()=> setDnd(240));
  dnd480.addEventListener('click', ()=> setDnd(480));
  dndTomorrow.addEventListener('click', ()=> {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate()+1);
    tomorrow.setHours(8,0,0,0);
    const mins = Math.max(1, Math.round((tomorrow.getTime() - Date.now())/60000));
    setDnd(mins);
  });
  dndOff.addEventListener('click', ()=> setDnd(0));

  autoTest.addEventListener('change', async () => {
    const dbg = { autoTest: autoTest.checked, autoInterval: 60000 };
    await chrome.storage.local.set({ mindrest_debug: dbg });
    chrome.runtime.sendMessage({ type: 'MINDREST_SET_DEBUG', debug: dbg });
    refresh();
  });

  refresh();
});
