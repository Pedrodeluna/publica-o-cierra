/**
 * Mundo aislado. Hace tres cosas:
 *  1. Reenvía al service worker las publicaciones que detecta interceptor.js.
 *  2. Informa de si esta pestaña está delante (visible + con foco).
 *  3. Pinta la UI: contador flotante, aviso bloqueante y confirmación.
 *
 * Todo vive en un shadow root para que el CSS de X no lo toque (ni al revés).
 */
const TAG = 'PUBLICA_O_CIERRA';

let host = null;
let shadow = null;
let el = {};
let state = { running: false, deadline: null, remainingMs: null, overlay: false, limitMin: 15 };
let ticker = null;
let toastTimer = null;
let lastPresence = null;
let scrollLock = '';

/* ---------------------------------------------------------------- mensajes */

function send(msg) {
  try {
    const p = chrome.runtime.sendMessage(msg);
    if (p && p.catch) p.catch(() => {});
  } catch (_) {
    /* contexto de la extensión recargado: se arregla al recargar la pestaña */
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data[TAG] !== true || data.type !== 'publish') return;
  send({ type: 'publish', op: data.op });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === 'sync') {
    state = Object.assign(state, msg.state);
    render();
  } else if (msg.type === 'toast') {
    showToast(msg.text);
  }
});

/* ---------------------------------------------------------------- presencia */

const isPresent = () => document.visibilityState === 'visible' && document.hasFocus();

function reportPresence(force) {
  const present = isPresent();
  if (!force && present === lastPresence) return;
  lastPresence = present;
  send({ type: present ? 'present' : 'away' });
}

document.addEventListener('visibilitychange', () => reportPresence());
window.addEventListener('focus', () => reportPresence());
window.addEventListener('blur', () => reportPresence());
window.addEventListener('pageshow', () => reportPresence(true));

/* ----------------------------------------------------------------- interfaz */

const CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
.sans {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}

/* contador flotante */
.pill {
  position: fixed; right: 18px; bottom: 18px; z-index: 2147483646;
  display: none; align-items: center; gap: 9px;
  padding: 9px 14px; border-radius: 999px;
  background: rgba(20, 18, 28, 0.92);
  border: 1px solid rgba(242, 163, 60, 0.28);
  color: #EDEBF2; font-size: 13px; font-weight: 500; line-height: 1;
  letter-spacing: 0.02em;
  backdrop-filter: blur(8px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  user-select: none;
}
.pill[data-show="1"] { display: flex; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: #F2A33C; }
.pill[data-paused="1"] .dot { background: #8A83A3; }
.pill[data-paused="1"] { border-color: rgba(237, 235, 242, 0.14); color: #8A83A3; }
.pill[data-low="1"] { border-color: rgba(228, 87, 46, 0.5); }
.pill[data-low="1"] .dot { background: #E4572E; }

/* aviso bloqueante */
.overlay {
  position: fixed; inset: 0; z-index: 2147483647;
  display: none; place-items: center;
  padding: 24px;
  background: rgba(11, 9, 17, 0.74);
  backdrop-filter: blur(16px) saturate(0.55);
}
.overlay[data-show="1"] { display: grid; }
.card {
  width: min(440px, 100%);
  background: #14121C;
  border: 1px solid rgba(237, 235, 242, 0.1);
  border-radius: 20px;
  padding: 34px 32px 28px;
  color: #EDEBF2;
  box-shadow: 0 32px 90px rgba(0, 0, 0, 0.6);
}
.eyebrow {
  font-size: 11px; font-weight: 600; line-height: 1;
  letter-spacing: 0.2em; text-transform: uppercase; color: #8A83A3;
}
.clock {
  margin-top: 18px;
  font-size: clamp(50px, 11vw, 68px); font-weight: 600; line-height: 1;
  letter-spacing: -0.03em; color: #F2A33C;
}
.title {
  margin-top: 20px;
  font-size: 21px; font-weight: 700; line-height: 1.25; letter-spacing: -0.02em;
}
.body {
  margin-top: 9px; font-size: 14px; line-height: 1.55; color: #A9A2C0;
}
.actions { margin-top: 26px; display: flex; flex-direction: column; gap: 9px; }
.row { display: flex; gap: 9px; }
.row > button { flex: 1; }
button {
  appearance: none; cursor: pointer;
  padding: 12px 16px; border-radius: 12px; border: 1px solid transparent;
  font-family: inherit; font-size: 14px; font-weight: 600; line-height: 1;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.primary { background: #F2A33C; color: #14121C; }
.primary:hover { background: #FFB755; }
.ghost { background: transparent; color: #EDEBF2; border-color: rgba(237, 235, 242, 0.16); }
.ghost:hover { border-color: rgba(237, 235, 242, 0.34); }
button:focus-visible, .pill:focus-visible { outline: 2px solid #F2A33C; outline-offset: 3px; }

/* confirmación */
.toast {
  position: fixed; left: 50%; top: 18px; z-index: 2147483647;
  transform: translate(-50%, -14px);
  display: none; align-items: center; gap: 8px;
  padding: 10px 16px; border-radius: 999px;
  background: #14121C; border: 1px solid rgba(242, 163, 60, 0.35);
  color: #EDEBF2; font-size: 13px; font-weight: 500; line-height: 1;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  opacity: 0;
}
.toast[data-show="1"] { display: flex; opacity: 1; transform: translate(-50%, 0); }
@media (prefers-reduced-motion: no-preference) {
  .toast { transition: opacity 0.2s ease, transform 0.2s ease; }
  .card { animation: rise 0.22s cubic-bezier(0.2, 0.8, 0.3, 1); }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } }
}
`;

function ensureUI() {
  if (host && host.isConnected) return;
  host = document.createElement('div');
  host.id = 'publica-o-cierra';
  host.style.cssText = 'all: initial; position: static;';
  shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'sans';
  wrap.innerHTML = `
    <div class="pill mono" part="pill">
      <span class="dot"></span><span data-pill-time>15:00</span>
    </div>
    <div class="toast">
      <span class="dot"></span><span data-toast-text></span>
    </div>
    <div class="overlay" role="dialog" aria-modal="true" aria-label="Aviso de sesión">
      <div class="card">
        <div class="eyebrow">Publica o cierra</div>
        <div class="clock mono">00:00</div>
        <div class="title" data-title>15 minutos aquí. Nada publicado.</div>
        <p class="body">Entraste a publicar. El timeline vuelve en cuanto escribas un tuit o un comentario.</p>
        <div class="actions">
          <button class="primary" data-act="write">Escribir algo</button>
          <div class="row">
            <button class="ghost" data-act="snooze">5 minutos más</button>
            <button class="ghost" data-act="leave">Salir de X</button>
          </div>
        </div>
      </div>
    </div>
  `;
  shadow.appendChild(wrap);

  el = {
    pill: shadow.querySelector('.pill'),
    pillTime: shadow.querySelector('[data-pill-time]'),
    overlay: shadow.querySelector('.overlay'),
    title: shadow.querySelector('[data-title]'),
    toast: shadow.querySelector('.toast'),
    toastText: shadow.querySelector('[data-toast-text]')
  };

  shadow.addEventListener('click', (e) => {
    const act = e.target && e.target.dataset && e.target.dataset.act;
    if (!act) return;
    if (act === 'write') {
      send({ type: 'grace' });
      openComposer();
    } else if (act === 'snooze') {
      send({ type: 'snooze' });
    } else if (act === 'leave') {
      leaveX();
    }
  });

  (document.body || document.documentElement).appendChild(host);
}

function openComposer() {
  const btn =
    document.querySelector('[data-testid="SideNav_NewTweet_Button"]') ||
    document.querySelector('a[href="/compose/post"]');
  if (btn) btn.click();
  else window.location.href = 'https://x.com/compose/post';
}

function leaveX() {
  window.close();
  setTimeout(() => window.location.replace('about:blank'), 120);
}

const fmt = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
};

function remainingMs() {
  if (state.overlay) return 0;
  if (state.running && state.deadline) return Math.max(0, state.deadline - Date.now());
  return state.remainingMs == null ? state.limitMin * 60000 : state.remainingMs;
}

function render() {
  ensureUI();

  const showOverlay = !!state.overlay;
  el.overlay.dataset.show = showOverlay ? '1' : '0';
  if (showOverlay) {
    el.title.textContent = `${state.limitMin} minutos aquí. Nada publicado.`;
    if (!scrollLock) {
      scrollLock = document.documentElement.style.overflow || 'auto';
      document.documentElement.style.overflow = 'hidden';
    }
  } else if (scrollLock) {
    document.documentElement.style.overflow = scrollLock === 'auto' ? '' : scrollLock;
    scrollLock = '';
  }

  const rem = remainingMs();
  el.pill.dataset.show = !showOverlay && state.enabled !== false ? '1' : '0';
  el.pill.dataset.paused = state.running ? '0' : '1';
  el.pill.dataset.low = state.running && rem <= 120000 ? '1' : '0';
  el.pillTime.textContent = state.running ? fmt(rem) : 'en pausa';

  clearInterval(ticker);
  if (state.running && !showOverlay) {
    ticker = setInterval(() => {
      const left = remainingMs();
      el.pillTime.textContent = fmt(left);
      el.pill.dataset.low = left <= 120000 ? '1' : '0';
    }, 1000);
  }
}

function showToast(text) {
  ensureUI();
  el.toastText.textContent = text;
  el.toast.dataset.show = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.dataset.show = '0';
  }, 2600);
}

/* ------------------------------------------------------------------ arranque */

function boot() {
  ensureUI();
  reportPresence(true);
  send({ type: 'hello' });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
