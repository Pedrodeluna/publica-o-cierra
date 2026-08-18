const el = (id) => document.getElementById(id);
let view = null;
let ticker = null;

const fmt = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return (
    String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')
  );
};

function paint(cfg, v) {
  view = v;
  el('limitMin').value = cfg.limitMin;
  el('countRetweets').checked = cfg.countRetweets;
  el('notify').checked = cfg.notify;
  el('enabled').checked = cfg.enabled;

  clearInterval(ticker);

  if (!cfg.enabled) {
    el('clock').textContent = '--:--';
    el('status').textContent = 'Desactivada';
    return;
  }
  if (v.overlay) {
    el('clock').textContent = '00:00';
    el('status').textContent = 'Aviso en pantalla: publica o cierra';
    return;
  }

  const left = () => (v.running && v.deadline ? Math.max(0, v.deadline - Date.now()) : v.remainingMs);
  el('clock').textContent = fmt(left());
  el('status').textContent = v.running ? 'Contando mientras miras X' : 'En pausa: X no está delante';
  if (v.running) {
    ticker = setInterval(() => {
      el('clock').textContent = fmt(left());
    }, 1000);
  }
}

async function load() {
  const res = await chrome.runtime.sendMessage({ type: 'getState' });
  if (res) paint(res.cfg, res.view);
}

async function patch(p) {
  const res = await chrome.runtime.sendMessage({ type: 'setCfg', patch: p });
  if (res) paint(res.cfg, res.view);
}

el('limitMin').addEventListener('change', (e) => {
  const n = Math.min(120, Math.max(1, parseInt(e.target.value, 10) || 15));
  e.target.value = n;
  patch({ limitMin: n });
});
el('countRetweets').addEventListener('change', (e) => patch({ countRetweets: e.target.checked }));
el('notify').addEventListener('change', (e) => patch({ notify: e.target.checked }));
el('enabled').addEventListener('change', (e) => patch({ enabled: e.target.checked }));
el('reset').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'resetNow' });
  if (res) paint(res.cfg, res.view);
});

load();
