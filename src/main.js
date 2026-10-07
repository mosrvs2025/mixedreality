import { Shell } from './platform/shell.js';
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const app = params.get('app'); // ?app=piano opens straight into an app

const shell = new Shell({
  onEnd: (summary) => {
    $('status').textContent = summary || '';
  },
});

async function init() {
  const enter = $('enter');
  const preview = $('preview');
  let ar = false;
  try {
    ar = !!(await navigator.xr?.isSessionSupported('immersive-ar'));
  } catch {
    ar = false;
  }
  if (ar) {
    enter.disabled = false;
    enter.addEventListener('click', async () => {
      try {
        await shell.startXR(app);
      } catch (e) {
        $('status').textContent = `Couldn't start mixed reality: ${e.message}`;
      }
    });
  } else {
    enter.disabled = true;
    enter.textContent = 'Open in Meta Quest Browser to play';
    $('status').textContent = 'This device can’t do mixed reality — try the desktop preview below.';
  }
  preview.addEventListener('click', () => shell.startSim(app));
  if (params.has('preview')) shell.startSim(app);
}
init();

// Handy for debugging and automated tests.
window.__THREE = THREE;
window.__roomspace = shell;
window.__fireflyNight = {
  get game() {
    return shell.app?.game ?? null;
  },
  get hands() {
    return shell.input.hands;
  },
  room: shell.room,
  camera: shell.camera,
};
