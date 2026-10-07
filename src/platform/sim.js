// Desktop preview: a furnished stand-in room, a mouse for a hand, WASD to walk.
// The headset version uses your real room instead.
import * as THREE from 'three';

export class Sim {
  constructor(shell) {
    this.shell = shell;
    this.visuals = null;
    this.mouse = { x: 0, y: 0, down: false, dragged: false, clicked: false, sx: 0, sy: 0 };
    this.keys = new Set();
    this.raycaster = new THREE.Raycaster();
    this._bind();
  }

  get active() {
    return this.shell.mode === 'sim';
  }

  buildRoom() {
    const { scene, room } = this.shell;
    this.visuals = new THREE.Group();
    scene.add(this.visuals);
    this.visuals.add(new THREE.HemisphereLight('#c8d4ff', '#4a3a2a', 1.4));
    const lamp = new THREE.PointLight('#ffd9a0', 6, 8);
    lamp.position.set(1.6, 2.2, -1.2);
    this.visuals.add(lamp);
    const add = (key, w, h, d, x, y, z, color, inside = false) => {
      const g = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Matrix4().makeTranslation(x, y, z);
      const mesh = new THREE.Mesh(
        g,
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.9,
          side: inside ? THREE.BackSide : THREE.FrontSide,
          // sit just behind the light layer, as real surfaces do in passthrough
          polygonOffset: true,
          polygonOffsetFactor: 4,
          polygonOffsetUnits: 8,
        }),
      );
      mesh.applyMatrix4(m);
      this.visuals.add(mesh);
      room.addStatic(key, g.clone(), m, key);
    };
    add('room', 5, 2.6, 4.6, 0, 1.3, 0, '#8d8579', true);
    add('table', 1.2, 0.05, 0.7, 0.9, 0.73, -0.9, '#6b4b33');
    for (const [lx, lz] of [[0.35, 0.3], [-0.35, 0.3], [0.35, -0.3], [-0.35, -0.3]]) add(`leg${lx}${lz}`, 0.05, 0.7, 0.05, 0.9 + lx * 1.5, 0.35, -0.9 + lz, '#5a3e2a');
    add('couch', 2.0, 0.45, 0.9, -1.2, 0.225, -1.7, '#4a5f7a');
    add('couch-back', 2.0, 0.5, 0.2, -1.2, 0.7, -2.1, '#4a5f7a');
    add('shelf', 0.4, 1.8, 1.0, 2.25, 0.9, 0.9, '#5d4a3a');
    add('armchair', 0.8, 0.5, 0.8, -1.8, 0.25, 1.0, '#7a4a4a');
    add('plant-pot', 0.35, 0.4, 0.35, 1.9, 0.2, -1.9, '#3f6b45');
  }

  start() {
    if (!this.visuals) this.buildRoom();
    this.visuals.visible = true;
    const { camera } = this.shell;
    camera.position.set(0, 1.6, 1.4);
    camera.rotation.set(0, 0, 0);
  }

  stop() {
    if (this.visuals) this.visuals.visible = false;
    this.shell.room.clearAll();
    // drop the stand-in room so the next start rebuilds it with fresh geometry
    if (this.visuals) {
      this.visuals.removeFromParent();
      this.visuals.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
      this.visuals = null;
    }
  }

  // Per-frame: walk, look, and turn the mouse into a ray.
  read(dt) {
    const { shell, keys, mouse } = this;
    const { camera, input } = shell;
    const k = (c) => (keys.has(c) ? 1 : 0);
    const speed = 1.6 * dt;
    const f = new THREE.Vector3(-Math.sin(camera.rotation.y), 0, -Math.cos(camera.rotation.y));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    // (W/S/A/D walk; the piano's QWERTY keys use other letters)
    if (!shell.app?.capturesKeys) {
      camera.position.addScaledVector(f, (k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown')) * speed);
      camera.position.addScaledVector(r, (k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft')) * speed);
    } else {
      camera.position.addScaledVector(f, (k('ArrowUp') - k('ArrowDown')) * speed);
      camera.position.addScaledVector(r, (k('ArrowRight') - k('ArrowLeft')) * speed);
    }
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -2.3, 2.3);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -2.1, 2.1);
    camera.updateMatrixWorld();
    input.head.copy(camera.position);
    input.headQ.copy(camera.quaternion);
    input.fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    input.up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    this.raycaster.setFromCamera(new THREE.Vector2(mouse.x, mouse.y), camera);
    const ray = this.raycaster.ray.clone();
    shell.pointer = { ray, clicked: mouse.clicked, down: mouse.down && !mouse.dragged, homeHeld: keys.has('Backquote') };
    input.tips = [];
    input.pokers = [];
    input.hands = shell.app?.simHands
      ? shell.app.simHands(ray, mouse.clicked, keys, dt)
      : [input.track('mouse', ray.at(0.7, new THREE.Vector3()), dt, { radius: 0.1, kind: 'mouse', lantern: false })];
  }

  endFrame() {
    this.mouse.clicked = false;
  }

  _bind() {
    const { shell, mouse, keys } = this;
    const el = shell.renderer.domElement;
    const headChime = () => shell.select(shell.input.head.clone().add(new THREE.Vector3(0, -0.3, 0)), null);
    el.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      shell.audio.resume();
      if (e.button === 2) {
        headChime();
        return;
      }
      mouse.down = true;
      mouse.dragged = false;
      mouse.sx = e.clientX;
      mouse.sy = e.clientY;
    });
    window.addEventListener('pointermove', (e) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      if (this.active && mouse.down) {
        if (Math.hypot(e.clientX - mouse.sx, e.clientY - mouse.sy) > 4) mouse.dragged = true;
        shell.camera.rotation.y -= e.movementX * 0.004;
        shell.camera.rotation.x = THREE.MathUtils.clamp(shell.camera.rotation.x - e.movementY * 0.004, -1.3, 1.3);
      }
    });
    window.addEventListener('pointerup', () => {
      if (this.active && mouse.down && !mouse.dragged) mouse.clicked = true;
      mouse.down = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      keys.add(e.code);
      if (!this.active) return;
      shell.audio.resume();
      if (e.code === 'Escape') {
        if (shell.app) shell.goHome();
        else shell.exit();
        return;
      }
      if (e.code === 'Space' && !shell.app?.capturesSpace) {
        e.preventDefault();
        headChime();
        return;
      }
      if (shell.app?.onKey?.(e.code, true, e)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      keys.delete(e.code);
      if (this.active) shell.app?.onKey?.(e.code, false, e);
    });
  }
}
