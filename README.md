# Firefly Night

A three-minute mixed-reality game for Meta Quest, played in the browser.

Night falls inside your real room. Fireflies wake up on your table, your couch and your walls, and some hide behind them. Catch them gently before dawn. At sunrise the ones you kept settle on your walls, and they're still there the next time you play.

## Why the room matters

The game is built on your room's scanned geometry (WebXR `mesh-detection` / `plane-detection`, with a `hit-test` fallback):

- **Fireflies live on your real surfaces.** They spawn on area-weighted random points of your room mesh: on the table, under it, on the sofa arm, low on a wall. About a third are deliberately placed where your own furniture hides them from where you stand.
- **Your furniture occludes them.** The room mesh is drawn into the depth buffer, so a firefly behind your sofa really is hidden. You have to walk, crouch and lean around your own room.
- **Echolocation through your room.** Pinch, or pull the trigger, to send a chime. A sonar ripple rolls across your real walls and furniture as glowing contour lines. Each firefly it passes answers with a 3D-positioned chirp, and hidden ones glow through the objects in front of them for a moment.
- **Light lands on real things.** Fireflies and your glowing fingertips cast soft light pools onto your actual table and walls. Your real ceiling turns into a starry sky.
- **Gentleness is a mechanic.** Swipe fast and fireflies startle off to another surface. Reach slowly and they're yours.
- **Spatial persistence.** At dawn your fireflies fly to your walls and ceiling and are pinned there with a persistent anchor (`anchor.requestPersistentHandle()`). Next time, the opening ripple reveals last night's fireflies glowing in the same spots.

## The first 30 seconds

1. *"Shh… night is falling in your room."* Passthrough fades to a deep blue dusk and crickets start up.
2. A low boom: a ripple of light rolls out from your feet across your floor, furniture and walls. Stars appear on your real ceiling, and seeds of light drift up from every surface it touches.
3. A single firefly wakes on a surface in front of you, chirps, and floats over to hover at arm's length: *"reach out… gently."* If you're shy, after a while it lands on your hand by itself.
4. When you catch it you hear a bell and feel a haptic pulse, and six more fireflies answer from all around your room in 3D audio.

After that you have 2:40 of play. Golden fireflies (worth 5) never sit still. The sky warms toward dawn as the timer runs down, and the music gets denser with every firefly you keep.

## Play it

It needs to be served over **HTTPS** and opened in **Meta Quest Browser** (Quest 3 / 3S recommended; Quest 2/Pro fall back to planes or hit-test).

- Run **Space Setup** on the headset so your furniture is known, and allow *spatial data* when the browser asks.
- Controls: reach with your hands or controllers to catch. Pinch or trigger to chime. After dawn, pinch or trigger again for another night.

### Hosting on GitHub Pages

This repo is a static site with no build step (three.js is vendored in `vendor/`). The included workflow `.github/workflows/pages.yml` deploys the repo root on every push to the default branch:

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to the default branch (or run the workflow manually).
3. Open `https://<user>.github.io/<repo>/` in Quest Browser.

Any other static HTTPS host works too (Netlify, Vercel, Cloudflare Pages, `npx http-server` behind an HTTPS tunnel).

### Desktop preview

Without a headset, click **Desktop preview** (or open `index.html?preview`). It's a furnished stand-in room so you can try the loop: drag to look, WASD to walk, click a firefly to catch it, Space to chime, Esc to leave.

## Code map

| File | What it does |
| --- | --- |
| `src/main.js` | WebXR session, hands/controllers, hit-test fan, desktop preview |
| `src/room.js` | Real-room geometry: depth occluder, light/ripple/star shader, surface sampler, occlusion raycasts |
| `src/game.js` | Game director: intro choreography, spawning, catching, chime, dawn, results |
| `src/firefly.js` | Firefly entity: emerge, perch, hover, fly, orbit, rest; X-ray glow through real objects |
| `src/audio.js` | Synthesized HRTF-spatial audio: chirps, bells, sonar, crickets, adaptive music |
| `src/memory.js` | Persistent anchors and best score |
| `src/fx.js` | Particles, dusk/dawn sky, floating text |

All sound is synthesized at runtime, and the game uses no image or audio files.
