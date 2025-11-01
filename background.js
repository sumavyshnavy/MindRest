// background.js v5 - ensure content script present before sendMessage; robust fallback
const SETTINGS_KEY = 'mindrest_settings';
const STATE_KEY = 'mindrest_state';
const DND_KEY = 'mindrest_dnd_until';
const DEBUG_KEY = 'mindrest_debug';
const DEFAULT = {
  weights: { tabSwitch: 0.35, scrollVelocity: 0.25, idleTime: 0.15, revisits: 0.15 },
  smoothingAlpha: 0.5,
  triggerThreshold: 0.6,
  cooldownSeconds: 30,
  minConsecutive: 1
};
let modelWeights = null;

async function loadModel() {
  if (modelWeights) return modelWeights;
  try {
    const url = chrome.runtime.getURL('tf_model/fatigue_model.json');
    const res = await fetch(url);
    modelWeights = await res.json();
    console.log('MindRest: loaded model', modelWeights);
    return modelWeights;
  } catch (e) {
    console.warn('MindRest: failed to load model, using DEFAULT weights', e);
    modelWeights = { weights: DEFAULT.weights, alpha: DEFAULT.smoothingAlpha };
    return modelWeights;
  }
}

async function getSettings() {
  const data = await chrome.storage.local.get([SETTINGS_KEY, STATE_KEY, DND_KEY, DEBUG_KEY]);
  const s = data[SETTINGS_KEY] || DEFAULT;
  const st = data[STATE_KEY] || { Fcrit: 0.65, lastF: 0, lastTriggerAt: 0, consecutiveHigh: 0 };
  const dnd = data[DND_KEY] || 0;
  const dbg = data[DEBUG_KEY] || { autoTest:false, autoInterval:60000 };
  return { settings: s, state: st, dndUntil: dnd, debug: dbg };
}
async function saveState(state) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

function clamp(x){ return Math.max(0, Math.min(1, x)); }
function updateFcrit(prevFcrit, observedF, alpha) {
  return alpha * observedF + (1 - alpha) * prevFcrit;
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'MINDREST_METRICS') {
    handleMetrics(msg.payload, sender);
  }
  if (msg.type === 'MINDREST_SET_DND') {
    chrome.storage.local.set({ [DND_KEY]: msg.until || 0 });
    console.log('MindRest: DND set until', new Date(msg.until));
  }
  if (msg.type === 'MINDREST_SET_DEBUG') {
    chrome.storage.local.set({ [DEBUG_KEY]: msg.debug || {autoTest:false} });
    console.log('MindRest: debug settings updated', msg.debug);
    startAutoTestTimer(); // restart
  }
  if (msg.type === 'MINDREST_PING') {
    chrome.runtime.sendMessage({ type: 'MINDREST_PONG', payload: { ok: true } });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (changes['mindrest_dnd_until']) {
    console.log('MindRest: DND updated', changes['mindrest_dnd_until'].newValue);
  }
  if (changes['mindrest_settings']) {
    console.log('MindRest: settings updated', changes['mindrest_settings'].newValue);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    await chrome.scripting.executeScript({ target: { tabId: activeInfo.tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(activeInfo.tabId, { type: 'MINDREST_EVENT', event: 'tab_activated' });
  } catch (e) { /* ignore */ }
});

async function injectContentScriptIfNeeded(tabId) {
  try {
    // try to ping the content script first
    const res = await chrome.tabs.sendMessage(tabId, { type: 'MINDREST_PING' }).catch(()=>null);
    if (res && res.ok) return true;
  } catch(e){}
  try {
    // inject content.js to ensure listener exists
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    console.log('MindRest: injected content.js into tab', tabId);
    return true;
  } catch (e) {
    console.warn('MindRest: failed to inject content script into tab', tabId, e);
    return false;
  }
}

async function sendTriggerToTab(tabId, payload) {
  // ensure content script present
  const injected = await injectContentScriptIfNeeded(tabId);
  if (injected) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'MINDREST_TRIGGER', payload });
      return true;
    } catch (e) {
      console.warn('MindRest: sendMessage failed, will fallback to direct inject', e);
    }
  }
  // fallback: directly execute overlay creation script in page
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (payload) => {
        try {
          if (window.MINDREST && typeof window.MINDREST.showOverlay === 'function') { window.MINDREST.showOverlay(payload); return; }
        } catch(e){}
        if (document.getElementById('mindrest-dark-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'mindrest-dark-overlay';
        overlay.style.position='fixed'; overlay.style.inset='0'; overlay.style.zIndex='2147483647';
        overlay.style.background='rgba(0,0,0,0.62)'; overlay.style.display='flex'; overlay.style.alignItems='center'; overlay.style.justifyContent='center';
        overlay.innerHTML = '<div style="background: linear-gradient(180deg,#e6fffb,#f0fdfa); color:#023047; padding:22px; border-radius:14px; max-width:560px; width:88%; box-shadow: 0 16px 60px rgba(2,6,23,0.45); font-family: system-ui, -apple-system, \"Segoe UI\", Roboto, Arial;"><h2 style="margin:0 0 8px 0">MindRest</h2><p style="margin:0 0 12px 0">A short 30s reset may help you refocus.</p><div style="display:flex;gap:10px;"><button id="mr-reset" style="padding:9px 12px;border-radius:10px;border:none;background: linear-gradient(180deg,#00796b,#004d40);color:white;cursor:pointer;">Start 30s Reset</button><button id="mr-dismiss" style="padding:9px 12px;border-radius:10px;border:none;background:transparent;color:#05445E;cursor:pointer;">Dismiss</button></div><div id="mr-summary-area" style="display:none;margin-top:10px"></div></div>';
        document.documentElement.appendChild(overlay);
        document.getElementById('mr-dismiss')?.addEventListener('click', ()=> overlay.remove());
        document.getElementById('mr-reset')?.addEventListener('click', ()=> {
          document.documentElement.style.filter='brightness(0.82)'; setTimeout(()=>{ document.documentElement.style.filter=''; overlay.remove(); },30000);
        });
      },
      args: [payload]
    });
    return true;
  } catch (e) {
    console.error('MindRest: fallback executeScript failed', e);
    return false;
  }
}

async function handleMetrics(metrics, sender) {
  const model = await loadModel();
  const { settings, state, dndUntil, debug } = await getSettings();
  const w = model.weights || settings.weights || DEFAULT.weights;

  // DND check
  if (Date.now() < (dndUntil || 0)) {
    const nextState = { ...state, consecutiveHigh: 0 };
    await saveState(nextState);
    console.log('MindRest: DND active, skipping metrics');
    return;
  }

  const v_tab = clamp(metrics.tabSwitch || 0);
  const v_scroll = clamp(metrics.scrollVelocity || 0);
  const v_idle = clamp(metrics.idleTime || 0);
  const v_revisit = clamp(metrics.revisits || 0);

  const F = clamp(
    (w.tabSwitch || 0)*v_tab +
    (w.scrollVelocity || 0)*v_scroll +
    (w.idleTime || 0)*v_idle +
    (w.revisits || 0)*v_revisit
  );

  const alpha = model.alpha || settings.smoothingAlpha || DEFAULT.smoothingAlpha;
  const newFcrit = updateFcrit(state.Fcrit ?? 0.65, F, alpha);

  const now = Date.now();
  const cooldown = (settings.cooldownSeconds || DEFAULT.cooldownSeconds) * 1000;
  const minConsecutive = (settings.minConsecutive != null) ? settings.minConsecutive : DEFAULT.minConsecutive;

  const consecutive = state.consecutiveHigh || 0;
  let newConsecutive = (F > newFcrit) ? consecutive + 1 : 0;

  const canTrigger = (now - (state.lastTriggerAt || 0)) > cooldown;

  console.log('MindRest: metrics', { metrics, F: F.toFixed(3), Fcrit: newFcrit.toFixed(3), consecutive: newConsecutive, minConsecutive, canTrigger });

  const nextState = { ...state, Fcrit: newFcrit, lastF: F, consecutiveHigh: newConsecutive };

  if (newConsecutive >= minConsecutive && F > newFcrit && canTrigger) {
    // determine target tabs (prefer sender.tab)
    let targetTabs = [];
    if (sender && sender.tab && sender.tab.id) targetTabs.push(sender.tab.id);
    else {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      for (const t of tabs) targetTabs.push(t.id);
    }
    for (const tabId of targetTabs) {
      try {
        const ok = await sendTriggerToTab(tabId, { F, Fcrit: newFcrit });
        if (ok) {
          nextState.lastTriggerAt = now;
          console.log('MindRest: triggered overlay for tab', tabId);
        } else {
          console.warn('MindRest: failed to trigger overlay for tab', tabId);
        }
      } catch (e) {
        console.error('MindRest: error triggering tab', tabId, e);
      }
    }
  }

  await saveState(nextState);

  // persist history
  try {
    const histKey = 'mindrest_history';
    const histObj = await chrome.storage.local.get(histKey);
    const hist = histObj[histKey] || [];
    hist.push({ t: now, F });
    if (hist.length > 500) hist.shift();
    await chrome.storage.local.set({ [histKey]: hist });
  } catch (e) {}
}

// auto-test
async function startAutoTestTimer() {
  const { debug } = await getSettings();
  if (debug && debug.autoTest) {
    const interval = debug.autoInterval || 60000;
    if (startAutoTestTimer._timer) clearInterval(startAutoTestTimer._timer);
    startAutoTestTimer._timer = setInterval(() => {
      console.log('MindRest: debug autoTest sending metrics');
      chrome.runtime.sendMessage({ type: 'MINDREST_METRICS', payload: { tabSwitch:1, scrollVelocity:0.9, idleTime:0.2, revisits:0.2 } });
    }, interval);
  } else {
    if (startAutoTestTimer._timer) { clearInterval(startAutoTestTimer._timer); startAutoTestTimer._timer = null; }
  }
}
chrome.storage.onChanged.addListener((changes)=>{ if (changes['mindrest_debug']) startAutoTestTimer(); });
startAutoTestTimer();
