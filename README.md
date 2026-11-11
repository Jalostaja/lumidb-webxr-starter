# LumiDB WebXR starter

Fly through a LumiDB point cloud on a Quest, a Vision Pro or a desktop browser. One page, no build step.

## Use it

1. **Paste a link.** In the LumiDB viewer, copy the 3D Tiles link (it looks like `https://api.lumidb.com/api/tables/3d_tileset?p=…`).
2. **Paste a key.** Create an API key in LumiDB and paste it in. It is stored in your browser only and sent only to the LumiDB host.
3. **Enter VR.** Press **Load**, wait for the points, then press **Enter VR** (it shows when a headset is available).
   No headset? The same page works on a desktop: drag to orbit, wheel to zoom, WASD + Q/E to fly, R to reset.

Quick test: `index.html#link=<link>&key=<key>`.

### Controls

| | Quest controllers | Vision Pro / hands | Desktop |
|---|---|---|---|
| Move | Left stick flies where you look (faster the higher you are); trigger boosts | Pinch and drag to pan | Orbit with the mouse; WASD + Q/E |
| Turn | Right stick X (snap, or smooth in the panel) | Two-hand pinch and twist | Orbit |
| Climb | Right stick Y | — | Q / E |
| Scale and rotate the world | Both grips: grab and pull apart/together | Two-hand pinch | Wheel to zoom |
| Reset to the overview | A / X | Double pinch | R |

The floating panel (VR) or overlay (desktop) shows the dataset, point count and scale (1:N), and toggles point size, colour mode
(RGB or height), turn style and the comfort vignette. Point at a button and pull the trigger or pinch.

## Run locally

```
python3 -m http.server 8080
```

Open http://localhost:8080/. Headsets need HTTPS (or `localhost` through port forwarding), so for a headset use the hosted version below.

## Host it (GitHub Pages)

WebXR on a headset needs HTTPS. GitHub Pages gives you that for free:

1. Push this folder to a GitHub repository.
2. **Settings → Pages → Deploy from a branch → `main` / root.**
3. Open `https://<you>.github.io/<repo>/` on the headset's browser. The LumiDB server allows requests from any origin.

Anyone with the page URL can use it, and each person enters their own key. Do not bake a key into the page.

## Test

```
npm install && npx playwright install chromium
LUMIDB_API_KEY=… LUMIDB_TILESET_LINK='…' npm test
```

Loads a tileset in an emulated Quest 3, enters VR, flies, scales, resets, and saves screenshots to `test/screenshots/`.

## Working on it with Claude Code

`CLAUDE.md` has the LumiDB API facts, the code layout and the conventions, so your Claude Code sessions start with context.
