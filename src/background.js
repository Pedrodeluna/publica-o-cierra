/**
 * El reloj vive aquí, no en la página.
 *
 * En MV3 el service worker se apaga a los ~30 s de inactividad, así que un
 * setTimeout de 15 minutos nunca llegaría a dispararse. Se usa chrome.alarms
 * (sobrevive a los reinicios) + un deadline absoluto guardado en storage.
 */

const ALARM_DEADLINE = 'poc-deadline';
const ALARM_TICK = 'poc-tick';

const DEFAULTS = {
  enabled: true,
  limitMin: 15, // minutos sin publicar antes del aviso
  graceMin: 2, // margen tras pulsar "Escribir algo"
  snoozeMin: 5, // margen tras pulsar "5 minutos más"
  countRetweets: false, // un RT no es publicar
  notify: true // notificación del sistema además del aviso en pantalla
};

const EMPTY = {
  presentTabs: [],
  running: false,
  deadline: null,
  remainingMs: null,
  overlay: false,
  idle: false
};

/* --------------------------------------------------------------- almacenaje */

async function getCfg() {
  const { settings } = await chrome.storage.local.get('settings');
  return Object.assign({}, DEFAULTS, settings || {});
}

async function getSt() {
  const { state } = await chrome.storage.session.get('state');
  return Object.assign({}, EMPTY, state || {});
}

async function setSt(state) {
  await chrome.storage.session.set({ state });
}

/* ------------------------------------------------------------------- reloj */

function remainingOf(st, cfg) {
  if (st.overlay) return 0;
  if (st.running && st.deadline) return Math.max(0, st.deadline - Date.now());
  return st.remainingMs == null ? cfg.limitMin * 60000 : st.remainingMs;
}

async function recompute() {
  const cfg = await getCfg();
  const st = await getSt();

  const shouldRun = cfg.enabled && !st.overlay && !st.idle && st.presentTabs.length > 0;

  if (shouldRun && !st.running) {
    if (st.remainingMs == null) st.remainingMs = cfg.limitMin * 60000;
    st.deadline = Date.now() + st.remainingMs;
    st.running = true;
    await chrome.alarms.create(ALARM_DEADLINE, { when: st.deadline });
  } else if (!shouldRun && st.running) {
    st.remainingMs = st.deadline ? Math.max(0, st.deadline - Date.now()) : st.remainingMs;
    st.deadline = null;
    st.running = false;
    await chrome.alarms.clear(ALARM_DEADLINE);
  }

  await setSt(st);
  await broadcast(st, cfg);
  return st;
}

async function resetTimer(minutes) {
  const cfg = await getCfg();
  const st = await getSt();
  st.remainingMs = (minutes == null ? cfg.limitMin : minutes) * 60000;
  st.overlay = false;
  st.running = false;
  st.deadline = null;
  await chrome.alarms.clear(ALARM_DEADLINE);
  await setSt(st);
  for (const id of st.presentTabs) tell(id, { type: 'sync', state: viewOf(st, cfg) });
  await recompute();
}

async function fire() {
  const cfg = await getCfg();
  const st = await getSt();
  if (!cfg.enabled) return;

  st.overlay = true;
  st.running = false;
  st.deadline = null;
  st.remainingMs = 0;
  await setSt(st);

  if (cfg.notify) {
    chrome.notifications.create('poc-' + Date.now(), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: `${cfg.limitMin} minutos aquí. Nada publicado.`,
      message: 'Vuelve a X y escribe algo, o cierra la pestaña.',
      priority: 2
    });
  }

  await broadcast(st, cfg);
}

/* ------------------------------------------------------------ comunicación */

function viewOf(st, cfg) {
  return {
    running: st.running,
    deadline: st.deadline,
    remainingMs: remainingOf(st, cfg),
    overlay: st.overlay,
    limitMin: cfg.limitMin,
    enabled: cfg.enabled
  };
}

function tell(tabId, msg) {
  try {
    const p = chrome.tabs.sendMessage(tabId, msg);
    if (p && p.catch) p.catch(() => {});
  } catch (_) {}
}

async function broadcast(st, cfg) {
  const view = viewOf(st, cfg);
  for (const id of st.presentTabs) tell(id, { type: 'sync', state: view });
  await updateBadge(st, cfg);
}

async function updateBadge(st, cfg) {
  let text = '';
  let color = '#F2A33C';
  if (!cfg.enabled) {
    text = '';
  } else if (st.overlay) {
    text = '!';
    color = '#E4572E';
  } else if (st.running) {
    const min = Math.ceil(remainingOf(st, cfg) / 60000);
    text = String(min);
    if (min <= 2) color = '#E4572E';
  }
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
  } catch (_) {}
}

/* ---------------------------------------------------------------- eventos */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const cfg = await getCfg();
    const st = await getSt();
    const tabId = sender.tab && sender.tab.id;

    switch (msg && msg.type) {
      case 'hello':
      case 'present': {
        if (tabId != null && !st.presentTabs.includes(tabId)) {
          st.presentTabs.push(tabId);
          await setSt(st);
        }
        await recompute();
        const fresh = await getSt();
        if (tabId != null) tell(tabId, { type: 'sync', state: viewOf(fresh, cfg) });
        break;
      }

      case 'away': {
        if (tabId != null) {
          st.presentTabs = st.presentTabs.filter((id) => id !== tabId);
          await setSt(st);
        }
        await recompute();
        break;
      }

      case 'publish': {
        if (msg.op === 'CreateRetweet' && !cfg.countRetweets) break;
        await resetTimer(null);
        const label = msg.op === 'CreateRetweet' ? 'Retuit' : 'Publicado';
        const mm = String(cfg.limitMin).padStart(2, '0');
        const after = await getSt();
        for (const id of after.presentTabs) {
          tell(id, { type: 'toast', text: `${label}. Reloj a ${mm}:00.` });
        }
        break;
      }

      case 'grace':
        await resetTimer(cfg.graceMin);
        break;

      case 'snooze':
        await resetTimer(cfg.snoozeMin);
        break;

      case 'getState':
        sendResponse({ cfg, view: viewOf(st, cfg) });
        return;

      case 'setCfg': {
        await chrome.storage.local.set({ settings: Object.assign({}, cfg, msg.patch) });
        const next = await getCfg();
        if (msg.patch && msg.patch.limitMin != null) {
          await resetTimer(next.limitMin);
        } else {
          await recompute();
        }
        const after = await getSt();
        sendResponse({ cfg: next, view: viewOf(after, next) });
        return;
      }

      case 'resetNow': {
        await resetTimer(null);
        const after = await getSt();
        sendResponse({ cfg, view: viewOf(after, cfg) });
        return;
      }
    }
    sendResponse({ ok: true });
  })();
  return true; // respuesta asíncrona
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_DEADLINE) {
    await fire();
  } else if (alarm.name === ALARM_TICK) {
    const cfg = await getCfg();
    const st = await getSt();
    await updateBadge(st, cfg);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const st = await getSt();
  if (!st.presentTabs.includes(tabId)) return;
  st.presentTabs = st.presentTabs.filter((id) => id !== tabId);
  await setSt(st);
  await recompute();
});

// Si te levantas de la silla, el reloj se para: nada de avisos al volver del café.
chrome.idle.onStateChanged.addListener(async (newState) => {
  const st = await getSt();
  st.idle = newState !== 'active';
  await setSt(st);
  await recompute();
});

async function init() {
  chrome.idle.setDetectionInterval(120);
  await chrome.alarms.create(ALARM_TICK, { periodInMinutes: 1 });
  await setSt(Object.assign({}, EMPTY));
  const cfg = await getCfg();
  await updateBadge(EMPTY, cfg);
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
