# Roomspace

A hub of mixed-reality apps for Meta Quest that live in your real room. Pick an app from an arc of cards floating at arm's length and touch it to open it. Everything is plain WebXR and runs from a hosted URL in Meta Quest Browser.

| App | What it does |
| --- | --- |
| 🎹 **Piano** | A holographic keyboard you set on a real table (or float in the air) and play with all ten fingers. Remembers where you put it. Learn songs as notes fall onto the keys. |
| ✦ **Firefly Night** | A three-minute game: fireflies wake on your furniture, hide behind it, and answer a sonar chime that ripples across your walls. |

Both use your room as a core mechanic rather than a backdrop (see "How the room is used" below).

## Play it

It needs **HTTPS** and **Meta Quest Browser** (Quest 3 / 3S recommended; Quest 2/Pro fall back to planes or hit-test).

- Run **Space Setup** on the headset so your furniture is known, and allow *spatial data* when the browser asks.
- Open the page and tap **Enter your room**.
- **Touch, don't pinch.** Buttons are pressed by poking with a fingertip or controller tip. Pinching with the palm toward your face is Meta's system-menu gesture, so bare-hand pinches are ignored.
- **Home:** touch and hold the glass button on the back of your left wrist (or above a controller) for about a second to return to the hub from any app.
- Deep-link straight into an app with `?app=piano` or `?app=firefly`. Add `?debug` for an in-headset diagnostics panel.

### Hosting

This is a static site with no build step (three.js is vendored in `vendor/`). The included workflow `.github/workflows/pages.yml` deploys the repo root to GitHub Pages on every push to the default branch (Settings → Pages → Source: *GitHub Actions*). Any static HTTPS host works too.

### Desktop preview

Click **Desktop preview** (or open `?preview`) for a furnished stand-in room: drag to look, WASD to walk, click cards and buttons, Esc for the hub. Each app shows its own controls at the bottom of the screen.

## Piano

- **Place it.** Look at a real table and the ghost keyboard snaps onto its surface (a raycast against your scanned room mesh); with controllers, point at it. Otherwise it floats at a comfortable height. Make a fist, pull the trigger, or touch **Place here** to set it down. Playing on a real table gives your fingertips something to land on.
- **Ten fingers.** Every fingertip is a player. A tip presses a key when it moves down onto it from above, with loudness from how fast it moved, and lets go when it lifts clear. A hand resting or sliding in low over a table never sounds a note. Controller tips work as single fingers; squeezing a grip is the sustain pedal.
- **It remembers.** The keyboard is pinned with a WebXR *persistent anchor* (and your settings are stored locally), so next session it is back on the same table. **Move** puts it somewhere else.
- **Sound from the keys.** Four instruments synthesised live (no samples): Grand Piano, Electric Piano, Music Box and Glow Pad, with velocity, a sustain pedal, and 24 voices. All voices share one HRTF-spatialised bus placed at the keyboard, with a send into a room reverb.
- **Light in the room.** Pressed keys glow in the colour of their note, cast light on the real surfaces around them, and send a coloured ripple rolling across your real walls and furniture.
- **Learn mode.** Pick a song (Twinkle Twinkle, Ode to Joy, Happy Birthday, Für Elise) and notes fall onto the keys. The song's clock **waits for you**: it stops at each note until you play it, so you can't fall behind.
- **Controls panel** (above and behind the keys): instrument, octave shift, size, song, pedal, move, home.

## Firefly Night

- **Fireflies live on your real surfaces** and perch only where your hand can reach from inside your Quest boundary (read from the `bounded-floor` reference space).
- **Your furniture hides them** (the room mesh and, on Quest 3, sensed depth occlude them), so you have to walk, crouch and lean.
- **Echolocation.** Make a fist or pull the trigger to chime: a sonar ripple rolls across the room, and fireflies answer in 3D audio and glow through the objects hiding them.
- Catch gently with an open palm (it draws fireflies in; a fist holds them). Swipe too fast and they startle. Golden fireflies never sit still. In the last minute gloom moths hunt perched fireflies. At dawn the fireflies you kept settle on your walls and are pinned with persistent anchors for next time.

## How the room is used

| Source | How |
| --- | --- |
| `mesh-detection` / `plane-detection` | The room mesh is an invisible depth occluder, a surface to place and sample on, and a canvas for light (ripples, glows, a starry ceiling, dawn through your window). |
| `hit-test` | Learns real surfaces wherever you look when no scan is available. |
| `anchors` (persistent) | Pins the piano and your fireflies to the room across sessions. |
| `depth-sensing` | Real hands, people and pets occlude virtual content. |
| `bounded-floor` | Keeps things within reach from inside your boundary. |
| `hand-tracking` | Ten fingertips, a true palm centre and palm normal, fist detection. |

## Adding an app

Apps are small modules. Create `src/apps/<name>/index.js` that default-exports:

```js
export default {
  id: 'myapp', name: 'My App', tagline: 'short line', kind: 'mr', color: '#7fb8ff',
  paint(ctx, w, h) { /* draw the launcher card art on a 2D canvas */ },
  create(shell) {
    return {
      root: new THREE.Group(),            // added to the scene for you, disposed on exit
      mount(now) {},                      // set up
      update(dt, now) {},                 // every frame
      unmount() {},                       // stop sounds, clear timers
      onSelect(pos, now, source) {},      // trigger / palm-away pinch / Space
      // desktop preview: onKey(code, down), simHands(ray, clicked, keys, dt)
    };
  },
};
```

then add it to `src/platform/apps.js`. The `shell` gives you the room (`shell.room`: raycast, lights, ripples), audio (`shell.audio`), particles, `shell.input` (head, hands, every fingertip in `tips`, poke points in `pokers`), `shell.bounds`, `shell.session` / `frame` / `refSpace`, and helpers: `Panel` / `Button` pokable UI (`platform/ui.js`), `PersistedPose` (anchors, `platform/persist.js`) and `shell.goHome()`. `kind: 'vr'` is reserved for fully virtual apps that draw an opaque environment over passthrough.

## Code map

| Path | What it does |
| --- | --- |
| `src/main.js` | Boot: landing page, enter/preview |
| `src/platform/shell.js` | Session, room services, app lifecycle, per-frame loop, debug panel |
| `src/platform/input.js` | Head, hands, every fingertip, controllers, poke points |
| `src/platform/launcher.js`, `home.js` | The card arc, and the wrist home button |
| `src/platform/ui.js` | Pokable 3D buttons and panels |
| `src/platform/persist.js` | Persistent anchors and settings |
| `src/platform/sim.js` | Desktop preview room, mouse and keyboard |
| `src/core/` | `room.js` (scan, occluder, light/ripple shader, raycast), `audio.js`, `fx.js`, `hands.js` |
| `src/apps/piano/` | `index.js` app, `keyboard.js` geometry, `synth.js` instruments, `learn.js` + `songs.js` |
| `src/apps/firefly/` | `game.js` director, `firefly.js`, `moth.js`, `area.js`, `memory.js` |

All sound is synthesised at runtime; the project uses no image or audio files.
