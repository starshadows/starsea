// Original soundtrack: 星落成诗. Independent of the scene render loop.
const audio = document.querySelector('#background-music');
const buttons = [...document.querySelectorAll('[data-music-toggle]')];
const status = document.querySelector('#music-status');
const preferenceKey = 'starsea.music.enabled.v1';

let enabled = true;
try { enabled = localStorage.getItem(preferenceKey) !== 'off'; } catch {}
let pending = false;
let awaitingGesture = false;
let failed = false;
let requestId = 0;
audio.volume = .42;

function render() {
  const playing = enabled && !audio.paused && !document.hidden;
  const state = !enabled ? 'muted' : failed ? 'error' : playing ? 'playing' : pending ? 'loading' : 'waiting';
  const label = playing || (enabled && pending)
    ? '关闭配乐《星落成诗》'
    : failed ? '重新播放配乐《星落成诗》' : '播放配乐《星落成诗》';
  for (const button of buttons) {
    button.dataset.state = state;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(playing));
    button.title = label;
  }
  status.hidden = !enabled || playing || document.hidden || (!awaitingGesture && !failed);
  status.textContent = failed ? '音乐暂未响起 · 轻触音乐按钮重试' : '轻触聆听 · 星落成诗';
}

function remember() {
  try { localStorage.setItem(preferenceKey, enabled ? 'on' : 'off'); } catch {}
}

async function start() {
  if (!enabled || document.hidden || pending) return;
  const id = ++requestId;
  pending = true;
  awaitingGesture = false;
  failed = false;
  render();
  try {
    if (audio.error) audio.load();
    // Called directly in a user gesture on fallback: no fetch/await before play.
    // On arrival this also tries audible autoplay when browser policy permits it.
    await audio.play();
    if (id !== requestId) {
      if (!enabled || document.hidden) audio.pause();
      return;
    }
    pending = false;
  } catch (error) {
    if (id !== requestId) return;
    pending = false;
    awaitingGesture = error.name === 'NotAllowedError';
    failed = !awaitingGesture;
  }
  render();
}

function stop() {
  ++requestId;
  pending = false;
  awaitingGesture = false;
  audio.pause();
  render();
}

for (const button of buttons) {
  button.addEventListener('click', () => {
    if (enabled && !awaitingGesture && !failed && (pending || !audio.paused)) {
      enabled = false;
      remember();
      stop();
    } else {
      enabled = true;
      remember();
      start();
    }
  });
}

function unlock(event) {
  if (event.target.closest?.('[data-music-toggle]')) return;
  if (event.type === 'keydown' && (event.ctrlKey || event.metaKey || event.altKey || ['Shift', 'Control', 'Alt', 'Meta', 'Escape'].includes(event.key))) return;
  if (enabled && awaitingGesture && !pending) start();
}
document.addEventListener('pointerup', unlock, { passive: true });
document.addEventListener('keydown', unlock);

audio.addEventListener('playing', () => {
  if (!enabled || document.hidden) { audio.pause(); return; }
  awaitingGesture = false;
  failed = false;
  render();
});
audio.addEventListener('pause', () => {
  if (enabled && !document.hidden && !pending) awaitingGesture = true;
  render();
});
audio.addEventListener('error', () => {
  if (enabled) { failed = true; pending = false; awaitingGesture = false; }
  render();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
  else if (enabled) start();
});
window.addEventListener('pagehide', stop);
window.addEventListener('pageshow', () => { if (enabled) start(); });
render();
if (enabled) start();
