# LumiDB WebXR starter

One page (`index.html`, no build step) that streams a LumiDB point cloud into a browser and a VR headset.
Three.js + [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS), both pinned by exact version in the import map.
Keep it small, readable and dependency-light: prefer editing `index.html` over adding files or packages.

## Run and test

```
python3 -m http.server 8080          # then open http://localhost:8080/ (any static server works)
npm install && npx playwright install chromium     # once, for the smoke test only
LUMIDB_API_KEY=… LUMIDB_TILESET_LINK='https://…/tables/3d_tileset?p=…' npm test
#   or: LUMIDB_TABLE=… LUMIDB_BOUNDARY_PROJ=… instead of a link
```

- **Run `npm test` after every significant change.** It loads a tileset in an emulated Quest 3
  ([IWER](https://github.com/meta-quest/immersive-web-emulation-runtime), enabled by `?emulate=quest`), enters VR, flies with the
  left stick, scales with both grips, resets with A, clicks the VR panel, and saves screenshots to `test/screenshots/`.
  It fails on console errors, 401/403, CORS errors and failed requests. **Look at the screenshots**; passing is not proof it looks right.
- Quick manual testing: `index.html#link=<tileset link>&key=<api key>` (the hash is removed from the address bar after it is read).
  `?emulate=quest` works in any desktop browser and gives you a fake headset.
- Never commit an API key. The key lives in `localStorage` (per browser) or in your environment for tests. Software GL in the
  test gives ~10 fps; it says nothing about headset performance.

## LumiDB API facts (checked against api.lumidb.com, see also https://api.lumidb.com/api/openapi.json)

- Link from the LumiDB viewer: `GET <base>/tables/3d_tileset?p=<payload>`. `p` is standard base64 (padding optional) of UTF-8 JSON:
  `{ table_name | tables, boundary_proj (required), boundary?, output_proj?, classification_filter?, meta_filter?, error_multiplier? }`.
- `parseLink()` validates the path (`…/tables/3d_tileset`), decodes `p`, **drops `output_proj`** and re-encodes. Without `output_proj`,
  tileset regions are lon/lat/ellipsoidal height (EPSG:4979) and tile content is ECEF (EPSG:4978).
- Tiles: `<base>/tables/3d_tile?p=…&cp=…&o=…&b=…`, `.pnts`, `POSITION` as float32 (not quantized), `RGB` (sRGB bytes), `RTC_CENTER` in ECEF.
  Colour may be absent: the shader then uses the height ramp.
- **Child and nested URIs are relative and already carry their own `p`.** The plugin only appends `p` if one is missing.
- Refinement is `ADD`. `geometricError` runs from tens of metres at the root to ~0.08 at the leaves. Nested tilesets are
  `3d_tileset?node_path=…&p=…`; a 500 m scene had ~2,600 of them.
- **Auth:** `Authorization: ApiKey <key>` on every request to the LumiDB host (header only, no query-string auth).
  A `Bearer <jwt>` from `POST /create_token` also works: paste the JWT in the key field. The header is only sent to the pasted link's host.
- **CORS:** the server reflects any `Origin` and allows the `authorization` header (preflight verified for GitHub Pages, localhost and `null`).
- **Caching:** tilesets and tiles come with `Cache-Control: no-cache` + `ETag`, so the browser revalidates every request. Fine for a
  starter; a server-side `max-age` on tiles would cut a lot of round trips.
- **Region units are not what the brief said.** With `output_proj` omitted we measured **radians** in all 4,636 regions of a test tileset.
  The OpenAPI spec says regions use `output_proj` units, so a link that keeps a projected or degree `output_proj` is the case that breaks
  3d-tiles-renderer. The degree fix is therefore a shim (`CONFIG.REGION_DEGREES_FIX`, default `'auto'`: only converts when the values
  cannot be radians). Delete it, and `shimTileset`'s region block, once the server is fixed.
- **Tile volumes are loose octree cells.** The tight data bounds are the root's own `content.boundingVolume`; `shimTileset` uses that
  for the floor height, the overview framing and the recentering. Outlier points stretch it (the Hawke's Bay test set reports
  heights of -607 m to 14,443 m), so the floor can sit well below the terrain.
- **Hosts and payloads vary.** Links work on `app.lumidb.com/api` and `api.lumidb.com/api`. `p` may use `tables: [..]` instead of
  `table_name`. Datasets range from a 110 m street scan to a ~210 km regional survey (8,775 tiles, root `geometricError` ~17 km),
  so world scale must reach ~1:250,000 (`CONFIG.maxScale`).

## How the code is laid out (`index.html`, numbered sections)

0. `CONFIG`: speeds, snap angle, point size, LOD target. Change things here first.
1. Link parsing/normalizing (`parseLink`).
2. `LumiDBPlugin`: a 3d-tiles-renderer plugin (`preprocessURL`, `fetchData`). Adds the auth header, applies the two compat shims
   (regions; nested tileset URIs get a `.json` suffix so the library treats them as tilesets, removed again before fetching).
   **`fetchData` must return `null` synchronously for other hosts**: a returned Promise counts as handled.
3. Scene. `scene ─ rig ─ camera, controllers, VR panel`; the tileset never moves. The rig's position, yaw and uniform scale are
   the **one navigation model**: every input path (Quest sticks/grips, pinch/hands, desktop) just edits the rig. Scaling the rig by `s`
   makes you `s` times bigger, so the world looks 1:`s`. `ReorientationPlugin` puts the data at the origin with +Y up; lat/lon/height
   come from the root tileset so the floor is y = 0.
4. Point material: `PointsMaterial` patched in `onBeforeCompile` (round dots, min/max pixel size, sRGB→linear, height ramp).
   Size is in **data metres** and divided by the rig scale (`uInvScale`) so dots do not balloon when you shrink the world.
5. Dataset loading and point counters (`load-model`, `tile-visibility-change`, `dispose-model`).
6. Navigation functions: `overviewPose`, `turnRig`, `flyRig`, grabs (`beginGrab`/`applyGrabs`: each hand pins a data point to itself;
   two hands also scale and yaw).
7. Input (keyboard WASD/QE also flies in VR via the shared `keys` set): controllers (gamepad: left stick fly, right stick X turn / Y climb, trigger boost, grips grab, A/X reset), hands and Vision Pro
   (pinch = select: drag pans, two hands scale+rotate, double pinch resets), desktop (OrbitControls + WASD/QE/R).
8. HUD: DOM overlay and a canvas-texture panel in VR driven by the same `actions` array. VR clicks use a controller ray.
   The desktop-only "Copy headset link" button builds `<page>#link=…&key=…` (the hash is stripped from the address bar on read).
9. Main loop. Order matters: inputs → `rig.updateMatrixWorld` → `renderer.xr.updateCamera` → `tiles.update` → render.
10. Form, URL hash, `?emulate=quest`, and `window.__app` test hooks. **Browse my datasets** calls `GET <base>/tables` (no pagination; items
    have `name`, `table_proj`, `bounds_wgs84`, `content_aabb`) and builds a link `{ table_name, boundary_proj: table_proj }` for the clicked one.
    Hash params: `link`, `key`, `base`. With a saved link and key the page auto-loads; with only a key it opens the list.

## Conventions and gotchas

- Pin exact versions (at least two weeks old) in the import map. After changing one, run `npm test`.
- **Scaled rig + stereo = three's combined XR camera is wrong.** Its near plane is derived from the eye separation in world units
  (huge under a big rig scale) mixed with near/far in view units. Never use `camera.projectionMatrix` or the main camera's frustum in VR.
  Level of detail uses `lodCamera()` (head pose + one eye's projection); small objects under the rig (panel, rays) set
  `frustumCulled = false` for the same reason. Symptom of getting this wrong: points load but 0 draw after entering VR.
- Everything in the rig (panel, vignette) scales with the world, so apparent size stays constant.
- zsh: never use `path` as a loop variable in shell snippets (it is tied to `PATH`).
- Keep compat shims behind a flag and commented as deletable.

## Not verified on a real device

Quest controllers and everything else in VR were exercised only through IWER. **Not tested on hardware:** Quest hand tracking,
Vision Pro transient-pointer pinch/drag (the pose source is the grip space, falling back to the target ray), comfort vignette feel,
real FPS, point budget. Check those first.
