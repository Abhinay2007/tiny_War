// ../auto-battler/src/render/chunkedMap.js
function createChunkedMap(pixi, host, config) {
  const { Application, Assets, Sprite, Container, Texture, Rectangle, RenderTexture } = pixi;
  const TILE9 = config.tile ?? 8;
  const CHUNK6 = config.chunk ?? 32;
  const CHUNKPX = CHUNK6 * TILE9;
  const BG = config.background ?? "#69636f";
  const Z_DEFAULT = config.zoomDefault ?? 1;
  const Z_MIN = config.zoomMin ?? 1 / 32;
  const Z_MAX = config.zoomMax ?? 6;
  const Z_STEP = config.zoomStep ?? 1.15;
  const Z_DETAIL = config.zDetail ?? 0.9;
  const Z_MACRO = config.zMacro ?? 0.5;
  const MCHUNK = config.macroChunkTexels ?? 32;
  const MACRO_TEXEL_PX = config.macroTexelPx ?? 2.5;
  const MACRO_LEVEL_MAX = config.macroLevelMax ?? 6;
  const DETAIL_BUDGET = config.detailBudget ?? 1;
  const MACRO_BUDGET = config.macroBudget ?? 8;
  const bounds = config.bounds ? {
    x0: config.bounds.x0 * TILE9,
    y0: config.bounds.y0 * TILE9,
    x1: config.bounds.x1 * TILE9,
    y1: config.bounds.y1 * TILE9,
    tx0: config.bounds.x0,
    ty0: config.bounds.y0,
    tx1: config.bounds.x1,
    ty1: config.bounds.y1
  } : null;
  let app = null, root = null, genRoot = null, macroRoot = null, shadowLayer = null, propLayer = null;
  let ctx = null;
  let alive = true;
  let enabled = true;
  let seed = config.seed ?? 1;
  let zoom = Z_DEFAULT;
  let cameraDirty = true, genPending = false, lastEmitTile = null;
  let flyAnim = null;
  const camera = { x: config.initialCamera?.x ?? CHUNKPX / 2, y: config.initialCamera?.y ?? CHUNKPX / 2 };
  const chunks = /* @__PURE__ */ new Map();
  const macroChunks = /* @__PURE__ */ new Map();
  const fading = /* @__PURE__ */ new Set();
  const keys = /* @__PURE__ */ new Set();
  const texCache = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  const tickHooks = /* @__PURE__ */ new Set();
  const drag = { on: false, px: 0, py: 0 };
  const pointers = /* @__PURE__ */ new Map();
  const pinch = { on: false, dist: 0 };
  const handlers = {};
  const emit = () => listeners.forEach((fn) => fn(getSnapshot()));
  const getSnapshot = () => ({ seed, zoom, cx: Math.round(camera.x / TILE9), cy: Math.round(camera.y / TILE9), chunks: chunks.size });
  function tex(source, c, r) {
    const k = source.uid + ":" + c + "," + r;
    let t = texCache.get(k);
    if (!t) {
      t = new Texture({ source, frame: new Rectangle(c * TILE9, r * TILE9, TILE9, TILE9) });
      texCache.set(k, t);
    }
    return t;
  }
  function texFrame(source, x, y, w, h) {
    const k = source.uid + ":f" + x + "," + y + "," + w + "," + h;
    let t = texCache.get(k);
    if (!t) {
      t = new Texture({ source, frame: new Rectangle(x, y, w, h) });
      texCache.set(k, t);
    }
    return t;
  }
  function makeChunk(cx, cy) {
    const x0 = cx * CHUNK6, y0 = cy * CHUNK6;
    const tmp = new Container();
    const add = (source, c, r, tx, ty) => {
      const sp = new Sprite(tex(source, c, r));
      sp.x = tx * TILE9;
      sp.y = ty * TILE9;
      tmp.addChild(sp);
      return sp;
    };
    const res = config.bake({ cx, cy, x0, y0, seed, chunk: CHUNK6, tile: TILE9, ctx, tmp, app, Sprite, Container, Texture, Rectangle, tex, texFrame, add }) || {};
    const rt = RenderTexture.create({ width: CHUNKPX, height: CHUNKPX, autoGenerateMipmaps: true, scaleMode: "nearest" });
    rt.source.minFilter = "linear";
    rt.source.mipmapFilter = "linear";
    app.renderer.render({ container: tmp, target: rt });
    rt.source.updateMipmaps();
    tmp.destroy({ children: true });
    const sprite = new Sprite(rt);
    sprite.x = x0 * TILE9;
    sprite.y = y0 * TILE9;
    return { sprite, rt, meta: res.meta ?? null, live: res.live ?? null };
  }
  function chooseMacroLevel(z) {
    return Math.max(0, Math.min(MACRO_LEVEL_MAX, Math.round(Math.log2(MACRO_TEXEL_PX / (TILE9 * z)))));
  }
  function makeMacroChunk(L, mcx, mcy) {
    const step2 = 1 << L, t0x = mcx * MCHUNK * step2, t0y = mcy * MCHUNK * step2;
    const cv = document.createElement("canvas");
    cv.width = MCHUNK;
    cv.height = MCHUNK;
    const g = cv.getContext("2d");
    const img = g.createImageData(MCHUNK, MCHUNK), d = img.data;
    for (let j = 0; j < MCHUNK; j++) for (let i = 0; i < MCHUNK; i++) {
      const [r, gg, b] = config.macroColor(seed, t0x + i * step2 + (step2 >> 1), t0y + j * step2 + (step2 >> 1));
      const o = (j * MCHUNK + i) * 4;
      d[o] = r;
      d[o + 1] = gg;
      d[o + 2] = b;
      d[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = Texture.from(cv);
    t.source.scaleMode = "linear";
    const sprite = new Sprite(t);
    sprite.x = t0x * TILE9;
    sprite.y = t0y * TILE9;
    sprite.width = sprite.height = MCHUNK * step2 * TILE9;
    return { sprite, tex: t };
  }
  function coverZoom() {
    if (!bounds || !app) return Z_MIN;
    return Math.max(app.screen.width / (bounds.x1 - bounds.x0), app.screen.height / (bounds.y1 - bounds.y0));
  }
  function clampCamera() {
    if (!bounds || !app) return;
    const hw = app.screen.width / 2 / zoom, hh = app.screen.height / 2 / zoom;
    const loX = bounds.x0 + hw, hiX = bounds.x1 - hw, loY = bounds.y0 + hh, hiY = bounds.y1 - hh;
    camera.x = loX <= hiX ? Math.min(hiX, Math.max(loX, camera.x)) : (bounds.x0 + bounds.x1) / 2;
    camera.y = loY <= hiY ? Math.min(hiY, Math.max(loY, camera.y)) : (bounds.y0 + bounds.y1) / 2;
  }
  function reconcile() {
    if (!genRoot || !ctx || !app) return;
    if (bounds) zoom = Math.max(zoom, coverZoom());
    clampCamera();
    const sx = Math.round(app.screen.width / 2 - camera.x * zoom);
    const sy = Math.round(app.screen.height / 2 - camera.y * zoom);
    for (const L of [macroRoot, genRoot, shadowLayer, propLayer]) {
      L.scale.set(zoom);
      L.x = sx;
      L.y = sy;
    }
    const detailActive = zoom > Z_MACRO;
    const t = Math.max(0, Math.min(1, (zoom - Z_MACRO) / (Z_DETAIL - Z_MACRO)));
    genRoot.visible = shadowLayer.visible = propLayer.visible = detailActive;
    genRoot.alpha = shadowLayer.alpha = propLayer.alpha = t;
    macroRoot.visible = true;
    macroRoot.alpha = 1;
    let pending = false;
    if (detailActive) pending = reconcileDetail() || pending;
    else clearChunks();
    pending = reconcileMacro(chooseMacroLevel(zoom)) || pending;
    genPending = pending;
  }
  function evictChunk(key, ch) {
    fading.delete(ch.sprite);
    genRoot.removeChild(ch.sprite);
    ch.sprite.destroy();
    ch.rt.destroy(true);
    if (ch.live) for (const l of ch.live) {
      propLayer.removeChild(l.sprite);
      l.sprite.destroy();
      if (l.shadow) {
        shadowLayer.removeChild(l.shadow);
        l.shadow.destroy();
      }
    }
    chunks.delete(key);
  }
  function reconcileDetail() {
    const halfW = app.screen.width / 2 / zoom, halfH = app.screen.height / 2 / zoom;
    let c0 = Math.floor((camera.x - halfW) / CHUNKPX) - 1, c1 = Math.floor((camera.x + halfW) / CHUNKPX) + 1;
    let r0 = Math.floor((camera.y - halfH) / CHUNKPX) - 1, r1 = Math.floor((camera.y + halfH) / CHUNKPX) + 1;
    if (bounds) {
      c0 = Math.max(c0, Math.floor(bounds.tx0 / CHUNK6));
      c1 = Math.min(c1, Math.floor((bounds.tx1 - 1) / CHUNK6));
      r0 = Math.max(r0, Math.floor(bounds.ty0 / CHUNK6));
      r1 = Math.min(r1, Math.floor((bounds.ty1 - 1) / CHUNK6));
    }
    for (const [key, ch] of chunks) {
      const [cx, cy] = key.split(",").map(Number);
      if (cx < c0 - 1 || cx > c1 + 1 || cy < r0 - 1 || cy > r1 + 1) evictChunk(key, ch);
    }
    const ccx = camera.x / CHUNKPX, ccy = camera.y / CHUNKPX, missing = [];
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const key = cx + "," + cy;
      if (!chunks.has(key)) missing.push({ cx, cy, key, d: (cx + 0.5 - ccx) ** 2 + (cy + 0.5 - ccy) ** 2 });
    }
    missing.sort((a, b) => a.d - b.d);
    for (let i = 0; i < missing.length && i < DETAIL_BUDGET; i++) {
      const { cx, cy, key } = missing[i];
      const ch = makeChunk(cx, cy);
      chunks.set(key, ch);
      genRoot.addChild(ch.sprite);
      ch.sprite.alpha = 0;
      fading.add(ch.sprite);
      if (ch.live) for (const l of ch.live) {
        if (l.shadow) shadowLayer.addChild(l.shadow);
        propLayer.addChild(l.sprite);
      }
    }
    return missing.length > DETAIL_BUDGET;
  }
  function reconcileMacro(L) {
    const px = MCHUNK * (1 << L) * TILE9;
    const halfW = app.screen.width / 2 / zoom, halfH = app.screen.height / 2 / zoom;
    let c0 = Math.floor((camera.x - halfW) / px) - 1, c1 = Math.floor((camera.x + halfW) / px) + 1;
    let r0 = Math.floor((camera.y - halfH) / px) - 1, r1 = Math.floor((camera.y + halfH) / px) + 1;
    if (bounds) {
      const mt = MCHUNK * (1 << L);
      c0 = Math.max(c0, Math.floor(bounds.tx0 / mt));
      c1 = Math.min(c1, Math.floor((bounds.tx1 - 1) / mt));
      r0 = Math.max(r0, Math.floor(bounds.ty0 / mt));
      r1 = Math.min(r1, Math.floor((bounds.ty1 - 1) / mt));
    }
    for (const [key, mc] of macroChunks) {
      const [ml, mx, my] = key.split(",").map(Number);
      if (ml !== L || mx < c0 - 1 || mx > c1 + 1 || my < r0 - 1 || my > r1 + 1) {
        macroRoot.removeChild(mc.sprite);
        mc.sprite.destroy();
        mc.tex.destroy(true);
        macroChunks.delete(key);
      }
    }
    const ccx = camera.x / px, ccy = camera.y / px, missing = [];
    for (let my = r0; my <= r1; my++) for (let mx = c0; mx <= c1; mx++) {
      const key = L + "," + mx + "," + my;
      if (!macroChunks.has(key)) missing.push({ mx, my, key, d: (mx + 0.5 - ccx) ** 2 + (my + 0.5 - ccy) ** 2 });
    }
    missing.sort((a, b) => a.d - b.d);
    for (let i = 0; i < missing.length && i < MACRO_BUDGET; i++) {
      const { mx, my, key } = missing[i];
      const mc = makeMacroChunk(L, mx, my);
      macroChunks.set(key, mc);
      macroRoot.addChild(mc.sprite);
    }
    return missing.length > MACRO_BUDGET;
  }
  function clearChunks() {
    for (const [key, ch] of chunks) evictChunk(key, ch);
  }
  function clearMacro() {
    for (const [, mc] of macroChunks) {
      macroRoot?.removeChild(mc.sprite);
      mc.sprite.destroy();
      mc.tex.destroy(true);
    }
    macroChunks.clear();
  }
  function zoomAt(factor, lx, ly) {
    if (!app) return;
    const nz = Math.min(Z_MAX, Math.max(bounds ? coverZoom() : Z_MIN, zoom * factor));
    if (nz === zoom) return;
    const sw = app.screen.width, sh = app.screen.height;
    const wx = camera.x + (lx - sw / 2) / zoom, wy = camera.y + (ly - sh / 2) / zoom;
    zoom = nz;
    camera.x = wx - (lx - sw / 2) / zoom;
    camera.y = wy - (ly - sh / 2) / zoom;
    cameraDirty = true;
  }
  function zoomBy(factor) {
    if (app) zoomAt(factor, app.screen.width / 2, app.screen.height / 2);
  }
  function flyTo(wx, wy, z, ms = 800) {
    return new Promise((resolve) => {
      if (!app) {
        resolve();
        return;
      }
      if (flyAnim) {
        const r = flyAnim.resolve;
        flyAnim = null;
        r && r();
      }
      const toZ = Math.min(Z_MAX, Math.max(bounds ? coverZoom() : Z_MIN, z));
      flyAnim = { fromX: camera.x, fromY: camera.y, fromZ: zoom, toX: wx, toY: wy, toZ, t: 0, dur: Math.max(1, ms), resolve };
    });
  }
  function panTo(wx, wy) {
    if (flyAnim) {
      const r = flyAnim.resolve;
      flyAnim = null;
      r && r();
    }
    camera.x = wx;
    camera.y = wy;
    clampCamera();
    cameraDirty = true;
  }
  function bindInput() {
    const canvas = app.canvas;
    const local = (cx, cy) => {
      const r = canvas.getBoundingClientRect();
      return [cx - r.left, cy - r.top];
    };
    const two = () => {
      const it = pointers.values();
      return [it.next().value, it.next().value];
    };
    handlers.down = (e) => {
      if (!enabled || flyAnim) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture?.(e.pointerId);
      if (pointers.size === 1) {
        drag.on = true;
        drag.px = e.clientX;
        drag.py = e.clientY;
      } else if (pointers.size === 2) {
        const [a, b] = two();
        pinch.on = true;
        pinch.dist = Math.hypot(a.x - b.x, a.y - b.y);
        drag.on = false;
      }
    };
    handlers.move = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.on && pointers.size >= 2) {
        const [a, b] = two(), d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.dist > 0) zoomAt(d / pinch.dist, ...local((a.x + b.x) / 2, (a.y + b.y) / 2));
        pinch.dist = d;
      } else if (drag.on) {
        camera.x -= (e.clientX - drag.px) / zoom;
        camera.y -= (e.clientY - drag.py) / zoom;
        drag.px = e.clientX;
        drag.py = e.clientY;
        cameraDirty = true;
      }
    };
    handlers.up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch.on = false;
      if (pointers.size === 1) {
        const p = pointers.values().next().value;
        drag.on = true;
        drag.px = p.x;
        drag.py = p.y;
      } else if (pointers.size === 0) drag.on = false;
    };
    handlers.wheel = (e) => {
      if (!enabled || flyAnim) return;
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? Z_STEP : 1 / Z_STEP, ...local(e.clientX, e.clientY));
    };
    handlers.key = (down) => (e) => {
      if (!enabled) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) || "wasd".includes(e.key.toLowerCase())) {
        e.preventDefault();
        if (down) keys.add(e.key);
        else keys.delete(e.key);
      }
    };
    handlers.keydown = handlers.key(true);
    handlers.keyup = handlers.key(false);
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", handlers.down);
    canvas.addEventListener("pointermove", handlers.move);
    window.addEventListener("pointerup", handlers.up);
    canvas.addEventListener("wheel", handlers.wheel, { passive: false });
    if (config.keyboardPan !== false) {
      window.addEventListener("keydown", handlers.keydown);
      window.addEventListener("keyup", handlers.keyup);
    }
  }
  function unbindInput() {
    const canvas = app?.canvas;
    canvas?.removeEventListener("pointerdown", handlers.down);
    canvas?.removeEventListener("pointermove", handlers.move);
    window.removeEventListener("pointerup", handlers.up);
    canvas?.removeEventListener("wheel", handlers.wheel);
    window.removeEventListener("keydown", handlers.keydown);
    window.removeEventListener("keyup", handlers.keyup);
  }
  const PAN_SPEED = 6;
  function tick(ticker) {
    for (const fn of tickHooks) fn(ticker);
    if (flyAnim) {
      flyAnim.t += ticker.deltaMS;
      const p = Math.min(1, flyAnim.t / flyAnim.dur);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      camera.x = flyAnim.fromX + (flyAnim.toX - flyAnim.fromX) * e;
      camera.y = flyAnim.fromY + (flyAnim.toY - flyAnim.fromY) * e;
      zoom = flyAnim.fromZ + (flyAnim.toZ - flyAnim.fromZ) * e;
      cameraDirty = true;
      if (p >= 1) {
        const r = flyAnim.resolve;
        flyAnim = null;
        r && r();
      }
      reconcile();
      cameraDirty = false;
      return;
    }
    if (!enabled) return;
    let dx = 0, dy = 0;
    for (const k of keys) {
      if (k === "ArrowLeft" || k === "a" || k === "A") dx -= 1;
      else if (k === "ArrowRight" || k === "d" || k === "D") dx += 1;
      else if (k === "ArrowUp" || k === "w" || k === "W") dy -= 1;
      else if (k === "ArrowDown" || k === "s" || k === "S") dy += 1;
    }
    if (dx || dy) {
      const sp = PAN_SPEED * ticker.deltaTime / zoom;
      camera.x += dx * sp;
      camera.y += dy * sp;
      cameraDirty = true;
    }
    if (fading.size) {
      const step2 = 0.12 * ticker.deltaTime;
      for (const sp of fading) {
        sp.alpha = Math.min(1, sp.alpha + step2);
        if (sp.alpha >= 1) fading.delete(sp);
      }
    }
    if (cameraDirty || genPending) {
      reconcile();
      cameraDirty = false;
      const tk2 = Math.round(camera.x / TILE9) + "," + Math.round(camera.y / TILE9) + "," + zoom.toFixed(3);
      if (tk2 !== lastEmitTile) {
        lastEmitTile = tk2;
        emit();
      }
    }
  }
  const ready = (async () => {
    const a = new Application();
    await a.init({ background: BG, antialias: false, resizeTo: host });
    if (!alive) {
      a.destroy(true);
      return;
    }
    app = a;
    host.appendChild(app.canvas);
    root = new Container();
    app.stage.addChild(root);
    macroRoot = new Container();
    root.addChild(macroRoot);
    genRoot = new Container();
    root.addChild(genRoot);
    shadowLayer = new Container();
    root.addChild(shadowLayer);
    propLayer = new Container();
    propLayer.sortableChildren = true;
    root.addChild(propLayer);
    ctx = await config.load({ Assets, Texture, Rectangle });
    if (!alive) return;
    bindInput();
    app.ticker.add(tick);
    app.renderer.on("resize", () => {
      cameraDirty = true;
    });
    cameraDirty = true;
    reconcile();
    emit();
  })();
  function getCamera() {
    return { x: camera.x, y: camera.y, zoom };
  }
  function onTick(fn) {
    tickHooks.add(fn);
    return () => tickHooks.delete(fn);
  }
  function getEntityLayer() {
    return propLayer;
  }
  function getApp() {
    return app;
  }
  function screenToWorld(sx, sy) {
    if (!app) return { x: 0, y: 0 };
    return { x: camera.x + (sx - app.screen.width / 2) / zoom, y: camera.y + (sy - app.screen.height / 2) / zoom };
  }
  function worldToScreen(wx, wy) {
    if (!app) return { x: 0, y: 0 };
    return { x: app.screen.width / 2 + (wx - camera.x) * zoom, y: app.screen.height / 2 + (wy - camera.y) * zoom };
  }
  function tileIndexAt(wx, wy) {
    if (!config.tileIndexAt) return null;
    const cx = Math.floor(wx / CHUNK6), cy = Math.floor(wy / CHUNK6);
    const ch = chunks.get(cx + "," + cy);
    if (!ch) return null;
    return config.tileIndexAt(wx, wy, ch.meta);
  }
  function biomeAt2(wx, wy) {
    return config.biomeAt ? config.biomeAt(seed, wx, wy) : null;
  }
  function getBounds() {
    return bounds ? { x0: bounds.x0, y0: bounds.y0, x1: bounds.x1, y1: bounds.y1 } : null;
  }
  function setEnabled(v) {
    enabled = v;
    if (v) cameraDirty = true;
  }
  function regenerate(nextSeed) {
    seed = nextSeed >>> 0;
    clearChunks();
    clearMacro();
    cameraDirty = true;
    reconcile();
    emit();
  }
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function destroy() {
    alive = false;
    try {
      unbindInput();
    } catch {
    }
    try {
      app?.ticker.remove(tick);
    } catch {
    }
    try {
      clearChunks();
      clearMacro();
    } catch {
    }
    try {
      app?.canvas?.remove();
    } catch {
    }
    try {
      app?.destroy();
    } catch {
    }
    app = null;
    root = null;
    genRoot = null;
    macroRoot = null;
    shadowLayer = null;
    propLayer = null;
    ctx = null;
    texCache.clear();
  }
  return { ready, regenerate, destroy, onChange, getSnapshot, getCamera, tileIndexAt, biomeAt: biomeAt2, getBounds, zoomBy, flyTo, panTo, setEnabled, onTick, getEntityLayer, getApp, screenToWorld, worldToScreen, tile: TILE9 };
}

// ../auto-battler/src/render/tileAutotile.js
var rect = (c, r, w, h) => {
  const a = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) a.push([c + i, r + j]);
  return a;
};
var offset = (t, col) => [t[0] + col, t[1]];
var rhash = (x, y, salt, seed) => Math.imul(x * 73856093 ^ y * 19349663 ^ seed + (salt | 0), 2654435761) >>> 0;
function hashU32(a, b, c) {
  let h = Math.imul((a | 0) ^ 2654435769, 2654435761);
  h = Math.imul(h ^ (b | 0) ^ 2246822507, 2246822519);
  h = Math.imul(h ^ (c | 0) ^ 3266489909, 3266489917);
  h ^= h >>> 15;
  return h >>> 0;
}
var sparse = (base, vars, x, y, salt, rate, seed) => {
  if (!vars.length) return base;
  const h = rhash(x, y, salt, seed);
  return h % rate === 0 ? vars[(h >>> 5) % vars.length] : base;
};
var lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function autotile(set, N, E, S, W, NW, NE, SW, SE) {
  const card = N + E + S + W;
  if (card === 1) return N ? set.N : S ? set.S : E ? set.E : set.W;
  if (card === 2) {
    if (N && W) return set.vNW;
    if (N && E) return set.vNE;
    if (S && W) return set.vSW;
    if (S && E) return set.vSE;
    return N ? set.N : set.E;
  }
  if (card >= 3) return N ? set.N : S ? set.S : E ? set.E : set.W;
  const diag = NW + NE + SW + SE;
  if (diag === 0) return null;
  if (diag === 1) return NW ? set.cNW : NE ? set.cNE : SW ? set.cSW : set.cSE;
  if (NW && SE && !NE && !SW) return set.dNWSE;
  if (NE && SW && !NW && !SE) return set.dSWNE;
  return null;
}
function cleanField(raw, M, SZ) {
  const idx = (i, j) => j * SZ + i;
  let cur = new Uint8Array(SZ * SZ);
  for (let j = 0; j < SZ; j++) for (let i = 0; i < SZ; i++) cur[idx(i, j)] = raw(i - M, j - M) ? 1 : 0;
  let nxt = new Uint8Array(SZ * SZ);
  for (let j = 1; j < SZ - 1; j++) for (let i = 1; i < SZ - 1; i++) {
    let c = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) c += cur[idx(i + di, j + dj)];
    nxt[idx(i, j)] = c >= 5 ? 1 : 0;
  }
  cur = nxt;
  for (let p = 0; p < 2; p++) {
    nxt = new Uint8Array(SZ * SZ);
    for (let j = 1; j < SZ - 1; j++) for (let i = 1; i < SZ - 1; i++) {
      const card = cur[idx(i, j - 1)] + cur[idx(i + 1, j)] + cur[idx(i, j + 1)] + cur[idx(i - 1, j)];
      nxt[idx(i, j)] = cur[idx(i, j)] ? card >= 2 ? 1 : 0 : card >= 3 ? 1 : 0;
    }
    cur = nxt;
  }
  return cur;
}
function blockTile([c0, r0], N, E, S, W) {
  const cx = W && !E ? 0 : E && !W ? 2 : 1;
  const cy = N && !S ? 0 : S && !N ? 2 : 1;
  return [c0 + cx, r0 + cy];
}
function centerTile([c0, r0], dNW, dNE, dSW, dSE) {
  if (!dNW && !dNE && !dSW && !dSE) return [c0 + 1, r0 + 1];
  if (dNW && dSE && !dNE && !dSW) return [c0 + 2, r0 + 3];
  if (dNE && dSW && !dNW && !dSE) return [c0 + 2, r0 + 4];
  if (dNW) return [c0, r0 + 3];
  if (dNE) return [c0 + 1, r0 + 3];
  if (dSW) return [c0, r0 + 4];
  return [c0 + 1, r0 + 4];
}
function bakeCliffs(cfg, { chunk, x0, y0, seed, raised, place, accept = () => true, stairAt = null, stairAtV = null }) {
  const ST = cfg.STAIR && (stairAt || stairAtV) ? cfg.STAIR : null;
  const useNS = ST && stairAt, useWE = ST && stairAtV;
  const isWide = (ax, ay, room) => room && rhash(ax, ay, ST.WIDE_SALT, seed) % 2 === 0;
  const sAnchor = (x, y) => raised(x, y) && !raised(x, y + 1) && raised(x - 1, y) && raised(x + 1, y) && stairAt(x, y);
  const nAnchor = (x, y) => raised(x, y) && !raised(x, y - 1) && raised(x - 1, y) && raised(x + 1, y) && stairAt(x, y);
  const wAnchor = (x, y) => raised(x, y) && !raised(x - 1, y) && raised(x + 1, y) && raised(x, y - 1) && raised(x, y + 1) && !raised(x - 1, y + 1) && stairAtV(x, y);
  const eAnchor = (x, y) => raised(x, y) && !raised(x + 1, y) && raised(x - 1, y) && raised(x, y - 1) && raised(x, y + 1) && !raised(x + 1, y + 1) && stairAtV(x, y);
  const sRoom = (x, y) => !raised(x + 1, y + 1) && raised(x + 2, y) && !raised(x + 2, y + 1) && raised(x + 3, y);
  const nRoom = (x, y) => !raised(x + 1, y - 1) && raised(x + 2, y) && !raised(x + 2, y - 1) && raised(x + 3, y);
  const wRoom = (x, y) => raised(x, y + 2) && !raised(x - 1, y + 2);
  const eRoom = (x, y) => raised(x, y + 2) && !raised(x + 1, y + 2);
  const W_OFF = [[0, 0], [0, 1], [-1, 0], [-1, 1], [-1, 2]];
  const E_OFF = [[0, 0], [0, 1], [1, 0], [1, 1], [1, 2]];
  const sDepth = useNS ? Math.max(ST.S.NARROW.length, ST.S.WIDE.length) : 0;
  function stairTileAt(wx, wy) {
    if (useNS) {
      for (let drow = 0; drow < sDepth; drow++) for (let dcol = 0; dcol <= 2; dcol++) {
        const ax = wx - dcol, ay = wy - drow;
        if (!sAnchor(ax, ay)) continue;
        if (isWide(ax, ay, sRoom(ax, ay))) {
          if (drow < ST.S.WIDE.length) return ST.S.WIDE[drow][dcol];
        } else if (dcol === 0 && drow < ST.S.NARROW.length) return ST.S.NARROW[drow];
      }
      for (let dcol = 0; dcol <= 2; dcol++) {
        if (nAnchor(wx - dcol, wy)) {
          if (isWide(wx - dcol, wy, nRoom(wx - dcol, wy))) return ST.N.WIDE.LIP[dcol];
          if (dcol === 0) return ST.N.NARROW.LIP;
        }
        if (nAnchor(wx - dcol, wy + 1)) {
          if (isWide(wx - dcol, wy + 1, nRoom(wx - dcol, wy + 1))) return ST.N.WIDE.CAP[dcol];
          if (dcol === 0) return ST.N.NARROW.CAP;
        }
      }
    }
    if (useWE) {
      for (const [dx, dy] of W_OFF) {
        const ax = wx - dx, ay = wy - dy;
        if (!wAnchor(ax, ay)) continue;
        const e = (isWide(ax, ay, wRoom(ax, ay)) ? ST.W.WIDE : ST.W.NARROW).find((o) => o.dx === dx && o.dy === dy);
        if (e) return e.t;
      }
      for (const [dx, dy] of E_OFF) {
        const ax = wx - dx, ay = wy - dy;
        if (!eAnchor(ax, ay)) continue;
        const e = (isWide(ax, ay, eRoom(ax, ay)) ? ST.E.WIDE : ST.E.NARROW).find((o) => o.dx === dx && o.dy === dy);
        if (e) return e.t;
      }
    }
    return null;
  }
  for (let ty = 0; ty < chunk; ty++) for (let tx = 0; tx < chunk; tx++) {
    if (!accept(tx, ty)) continue;
    const wx = x0 + tx, wy = y0 + ty;
    if (ST) {
      const st = stairTileAt(wx, wy);
      if (st) {
        place(st, tx, ty);
        continue;
      }
    }
    if (raised(wx, wy)) {
      const bN = !raised(wx, wy - 1), bE = !raised(wx + 1, wy), bS = !raised(wx, wy + 1), bW = !raised(wx - 1, wy);
      if (bN && bW) place(cfg.LIP_TL, tx, ty);
      else if (bN && bE) place(cfg.LIP_TR, tx, ty);
      else if (bS && bW) place(cfg.LIP_SW, tx, ty);
      else if (bS && bE) place(cfg.LIP_SE, tx, ty);
      else if (bN) place(sparse(cfg.LIP_T, cfg.LIP_T_VAR, wx, wy, 1, cfg.RATE, seed), tx, ty);
      else if (bS) place(sparse(cfg.LIP_S, cfg.LIP_S_VAR, wx, wy, 2, cfg.RATE, seed), tx, ty);
      else if (bW) place(sparse(cfg.WALL_L, cfg.WALL_L_VAR, wx, wy, 3, cfg.RATE, seed), tx, ty);
      else if (bE) place(sparse(cfg.WALL_R, cfg.WALL_R_VAR, wx, wy, 4, cfg.RATE, seed), tx, ty);
      else if (cfg.FILL) place(sparse(cfg.FILL, cfg.FILL_VAR || [], wx, wy, 9, cfg.RATE, seed), tx, ty);
    } else {
      for (let k = 1; k <= cfg.FACE_H; k++) {
        if (raised(wx, wy - k)) {
          const leftEnd = !raised(wx - 1, wy - k), rightEnd = !raised(wx + 1, wy - k);
          place(leftEnd ? cfg.FACE_L[k - 1] : rightEnd ? cfg.FACE_R[k - 1] : sparse(cfg.FACE[k - 1], cfg.FACE_VAR[k - 1], wx, wy, 5 + k, cfg.RATE, seed), tx, ty);
          break;
        }
      }
    }
  }
}

// ../auto-battler/src/engine/rng.js
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ../auto-battler/src/engine/worldgen.js
function hash2(seed, x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2654435761);
  h = Math.imul(h ^ h >>> 13, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
var smooth = (t) => t * t * (3 - 2 * t);
var lerp = (a, b, t) => a + (b - a) * t;
function valueNoise(seed, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const v00 = hash2(seed, xi, yi), v10 = hash2(seed, xi + 1, yi);
  const v01 = hash2(seed, xi, yi + 1), v11 = hash2(seed, xi + 1, yi + 1);
  const u = smooth(xf), v = smooth(yf);
  return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
}
function fbm(seed, x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(seed + o * 1013, x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// ../auto-battler/src/engine/transitionStencils.js
var TILE = 8;
var MID = 3.5;
var BAND = 2.6;
var WAVE_AMP = 1.35;
var WAVE_FREQ = 0.45;
var R_OUTER = 4.6;
var R_CONCAVE = 2.3;
var R_TIP = 2.6;
var BAYER4 = [
  0.5 / 16,
  8.5 / 16,
  2.5 / 16,
  10.5 / 16,
  12.5 / 16,
  4.5 / 16,
  14.5 / 16,
  6.5 / 16,
  3.5 / 16,
  11.5 / 16,
  1.5 / 16,
  9.5 / 16,
  15.5 / 16,
  7.5 / 16,
  13.5 / 16,
  5.5 / 16
];
var bayer = (x, y) => BAYER4[(y & 3) * 4 + (x & 3)];
function wave1d(t, salt) {
  const i = Math.floor(t * WAVE_FREQ), f = t * WAVE_FREQ - i;
  const a = hash2(salt, i, 0), b = hash2(salt, i + 1, 0);
  const u = f * f * (3 - 2 * f);
  return (a + (b - a) * u) * 2 - 1;
}
var CASES = {
  // cardinal edges — wavy line; fg on the side away from the foreign neighbour.
  N: (x, y, s) => y - (MID + WAVE_AMP * wave1d(x, s)),
  S: (x, y, s) => MID + WAVE_AMP * wave1d(x, s) - y,
  E: (x, y, s) => MID + WAVE_AMP * wave1d(y, s) - x,
  W: (x, y, s) => x - (MID + WAVE_AMP * wave1d(y, s)),
  // outer corners — bg is a quarter-disc in the corner (2 adjacent foreign cardinals).
  oNE: (x, y, s) => dist(x, y, 7, 0) - (R_OUTER + WAVE_AMP * wave1d(x + y, s)),
  oNW: (x, y, s) => dist(x, y, 0, 0) - (R_OUTER + WAVE_AMP * wave1d(x + y, s)),
  oSE: (x, y, s) => dist(x, y, 7, 7) - (R_OUTER + WAVE_AMP * wave1d(x + y, s)),
  oSW: (x, y, s) => dist(x, y, 0, 7) - (R_OUTER + WAVE_AMP * wave1d(x + y, s)),
  // concave corners — small bg notch in the corner (1 foreign diagonal only).
  cNE: (x, y, s) => dist(x, y, 7, 0) - (R_CONCAVE + 0.6 * wave1d(x + y, s)),
  cNW: (x, y, s) => dist(x, y, 0, 0) - (R_CONCAVE + 0.6 * wave1d(x + y, s)),
  cSE: (x, y, s) => dist(x, y, 7, 7) - (R_CONCAVE + 0.6 * wave1d(x + y, s)),
  cSW: (x, y, s) => dist(x, y, 0, 7) - (R_CONCAVE + 0.6 * wave1d(x + y, s)),
  // peninsula — fg is a small blob on the one open side (3 foreign cardinals).
  tipN: (x, y, s) => R_TIP + 0.6 * wave1d(x, s) - dist(x, y, 3.5, 0),
  tipS: (x, y, s) => R_TIP + 0.6 * wave1d(x, s) - dist(x, y, 3.5, 7),
  tipE: (x, y, s) => R_TIP + 0.6 * wave1d(y, s) - dist(x, y, 7, 3.5),
  tipW: (x, y, s) => R_TIP + 0.6 * wave1d(y, s) - dist(x, y, 0, 3.5),
  // island — fg is a small blob in the centre (foreign on all 4 cardinals).
  island: (x, y, s) => R_TIP + 0.6 * wave1d(x - y, s) - dist(x, y, 3.5, 3.5)
};
function dist(x, y, cx, cy) {
  const dx = x - cx, dy = y - cy;
  return Math.sqrt(dx * dx + dy * dy);
}
var STENCIL_CASES = Object.keys(CASES);
function boundaryCase(N, E, S, W, NW, NE, SW, SE) {
  const card = N + E + S + W;
  if (card === 0) {
    const diag = NW + NE + SW + SE;
    if (diag === 0) return null;
    if (NW) return "cNW";
    if (NE) return "cNE";
    if (SW) return "cSW";
    return "cSE";
  }
  if (card === 1) return N ? "N" : E ? "E" : S ? "S" : "W";
  if (card === 2) {
    if (N && E) return "oNE";
    if (N && W) return "oNW";
    if (S && E) return "oSE";
    if (S && W) return "oSW";
    return N ? "N" : "E";
  }
  if (card === 3) return !N ? "tipN" : !E ? "tipE" : !S ? "tipS" : "tipW";
  return "island";
}
function makeStencil(caseKey, variant = 0) {
  const sd = CASES[caseKey];
  if (!sd) throw new Error(`unknown stencil case "${caseKey}"`);
  const salt = (hashStr(caseKey) ^ variant * 40503) >>> 0;
  const mask = new Uint8Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const d = sd(x, y, salt);
    let fg;
    if (d > BAND / 2) fg = 1;
    else if (d < -BAND / 2) fg = 0;
    else fg = (d + BAND / 2) / BAND > bayer(x, y) ? 1 : 0;
    mask[y * TILE + x] = fg;
  }
  return mask;
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ../auto-battler/src/render/transitionAtlas.js
var VARIANTS = 3;
function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
function tilePixels(img, c, r) {
  const cv = document.createElement("canvas");
  cv.width = TILE;
  cv.height = TILE;
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  g.drawImage(img, c * TILE, r * TILE, TILE, TILE, 0, 0, TILE, TILE);
  return g.getImageData(0, 0, TILE, TILE).data;
}
async function buildTransitionAtlas({ grounds, ids }) {
  const imgCache = /* @__PURE__ */ new Map(), pxCache = /* @__PURE__ */ new Map();
  const getPx = async (url, tile) => {
    const k = url + "|" + tile[0] + "," + tile[1];
    if (pxCache.has(k)) return pxCache.get(k);
    let img = imgCache.get(url);
    if (!img) {
      img = await loadImg(url);
      imgCache.set(url, img);
    }
    const p = tilePixels(img, tile[0], tile[1]);
    pxCache.set(k, p);
    return p;
  };
  const combos = [];
  for (const A of ids) for (const B of ids) {
    if (A === B) continue;
    for (const fa of grounds[A].fills) for (const fb of grounds[B].fills) combos.push({ A, B, fa, fb });
  }
  for (const c of combos) {
    c.fp = await getPx(c.fa.url, c.fa.tile);
    c.bp = await getPx(c.fb.url, c.fb.tile);
  }
  const rowOf = /* @__PURE__ */ new Map();
  combos.forEach((c, i) => rowOf.set(c.A + "|" + c.fa.key + "|" + c.B + "|" + c.fb.key, i));
  const caseCol = /* @__PURE__ */ new Map();
  STENCIL_CASES.forEach((k, i) => caseCol.set(k, i));
  const canvas = document.createElement("canvas");
  canvas.width = STENCIL_CASES.length * VARIANTS * TILE;
  canvas.height = combos.length * TILE;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  for (let r = 0; r < combos.length; r++) {
    const { fp, bp } = combos[r];
    for (let ci = 0; ci < STENCIL_CASES.length; ci++) {
      for (let v = 0; v < VARIANTS; v++) {
        const mask = makeStencil(STENCIL_CASES[ci], v);
        const img = ctx.createImageData(TILE, TILE);
        for (let p = 0; p < TILE * TILE; p++) {
          const src = mask[p] ? fp : bp, o = p * 4;
          img.data[o] = src[o];
          img.data[o + 1] = src[o + 1];
          img.data[o + 2] = src[o + 2];
          img.data[o + 3] = src[o + 3];
        }
        ctx.putImageData(img, (ci * VARIANTS + v) * TILE, r * TILE);
      }
    }
  }
  const tileAt = (fgId, fgKey, bgId, bgKey, caseKey, variant) => {
    const row = rowOf.get(fgId + "|" + fgKey + "|" + bgId + "|" + bgKey);
    const ci = caseCol.get(caseKey);
    if (row === void 0 || ci === void 0) return null;
    return [ci * VARIANTS + (variant % VARIANTS + VARIANTS) % VARIANTS, row];
  };
  return { canvas, tileAt, variants: VARIANTS };
}

// ../auto-battler/src/render/medievalCity.js
var MC = "/assets/minifantasy/Minifantasy_Medieval_City_v1.1/Minifantasy_Medieval_City_Assets";
var MC_TILES_URL = `${MC}/Tileset/Tileset.png`;
var MC_TILES_SHADOWS_URL = `${MC}/Tileset/Shadows.png`;
var MC_PROPS_URL = `${MC}/Props/Props.png`;
var MC_PROPS_SHADOWS_URL = `${MC}/Props/Shadows.png`;
var MC_MOCKUP_URL = `${MC}/Mockup_Exterior_1.png`;
var MC_PREMADE_DIR = `${MC}/Premade/Premade_Exterior/Separate_Layers`;
var TILE2 = 8;
var DIRT_BASE = [4, 132];
var DIRT_VARS = [[6, 132], [8, 132], [10, 132], [6, 134], [8, 134], [10, 134], [6, 136], [8, 136]];
var MC_ROOF = {
  colours: { red: 0, green: 38, purple: 76 },
  // a roof FIELD = three column kinds × three row kinds (top ridge · body · eave drip). The L/R edge
  // columns carry the dark rake border — using body across the whole width is what made roofs "not align".
  edgeL: { top: [1, 13], body: [1, 14], eave: [1, 16] },
  body: { top: [2, 13], body: [10, 7], eave: [2, 40] },
  edgeR: { top: [5, 13], body: [5, 14], eave: [5, 16] },
  // central cross-gable DORMER, decoded cell-for-cell relative to the door's left column (relCol 0) and
  // the roof's top row (roofRow 0); finial sits at roofRow −1. Roof cells are colour-offset; the window
  // block (relCol 0-1, rows 2-3) comes from the wall and is laid by assembleHouse.
  dormer: [
    [0, -1, 10, 12],
    [1, -1, 11, 12],
    [0, 0, 10, 13],
    [1, 0, 11, 13],
    [2, 0, 4, 20],
    [0, 1, 6, 59],
    [1, 1, 24, 59],
    [2, 1, 15, 54],
    [-1, 2, 2, 21],
    [0, 2, 7, 58],
    [1, 2, 8, 58],
    [2, 2, 4, 14],
    [-1, 3, 11, 60],
    [0, 3, 7, 59],
    [1, 3, 8, 59],
    [2, 3, 15, 60]
  ],
  dormerWin: { win: [34, 35], r0: 99 }
  // 2-wide window in the dormer face (relCol 0-1, rows 2-3)
};
var ROOF_H = 4;
var MC_WALL = {
  stone: { r0: 98, L: 41, R: 53, fill: 50, win: [64, 65], door: [58, 59] }
  // grey ashlar (walls_1)
};
var MC_CHIMNEY = { cap: [3, 43], body: [3, 44] };
var MC_TOWER = {
  coneColours: { red: 0, green: 38, purple: 76 },
  cone: { c0: 15, r0: 13, w: 5, h: 6 },
  // cone cap + flare (colour-offset); overhangs the drum 1 each side
  drumTop: [16, 19],
  // 3-wide cap-to-drum joint row (cols 16,17,18)
  drum: { L: [21, 20], M: [17, 20], R: [23, 20] },
  // one cylinder row, repeated for height
  base: [16, 21]
  // 3-wide rounded foot (cols 16,17,18)
};
var FLOOR_H = 2;
var Z_WALLS1 = 0;
var Z_WALLS2 = 2;
var Z_ROOF = 4;
var Z_TURRETS = 5;
var Z_CHIMNEYS = 6;
function planWallRow(W) {
  const inner = W - 2;
  const segs = new Array(inner).fill("fill");
  const dL = Math.floor((inner - 2) / 2);
  segs[dL] = "door";
  segs[dL + 1] = "door";
  const doorX = dL + 1;
  for (let x = 0; x + 1 < dL; x += 2) segs[x] = segs[x + 1] = "win";
  for (let x = inner - 2; x >= dL + 2; x -= 2) segs[x] = segs[x + 1] = "win";
  return { segs, doorX };
}
function assembleHouse(api, bx, by, house = {}) {
  const { Sprite, Container, tex, texFrame, source } = api;
  const { w = 8, colour = "red", material = "stone", floors = 1, dormer = true, chimney = 1, towers = [] } = house;
  const wall = MC_WALL[material] || MC_WALL.stone;
  const off = MC_ROOF.colours[colour] || 0;
  const wallY0 = ROOF_H;
  const H = wallY0 + floors * FLOOR_H;
  const cont = new Container();
  cont.sortableChildren = true;
  cont.x = bx * TILE2;
  cont.y = (by - H + 1) * TILE2;
  cont.zIndex = (by + 1) * TILE2;
  const tile = (c, r, x, y, z) => {
    const sp = new Sprite(tex(source, c, r));
    sp.x = x * TILE2;
    sp.y = y * TILE2;
    sp.zIndex = z;
    cont.addChild(sp);
    return sp;
  };
  const frame = (c, r, fw, fh, x, y, z) => {
    const sp = new Sprite(texFrame(source, c * TILE2, r * TILE2, fw * TILE2, fh * TILE2));
    sp.x = x * TILE2;
    sp.y = y * TILE2;
    sp.zIndex = z;
    cont.addChild(sp);
    return sp;
  };
  const block2 = (cols, r0, x, y, z) => {
    tile(cols[0], r0, x, y, z);
    tile(cols[1], r0, x + 1, y, z);
    tile(cols[0], r0 + 1, x, y + 1, z);
    tile(cols[1], r0 + 1, x + 1, y + 1, z);
  };
  for (let f = 0; f < floors; f++) {
    const wy = wallY0 + f * FLOOR_H, z = f === 0 ? Z_WALLS1 : Z_WALLS2;
    const { segs } = planWallRow(w);
    tile(wall.L, wall.r0, 0, wy, z);
    tile(wall.L, wall.r0 + 1, 0, wy + 1, z);
    tile(wall.R, wall.r0, w - 1, wy, z);
    tile(wall.R, wall.r0 + 1, w - 1, wy + 1, z);
    for (let i = 0; i < segs.length; ) {
      const x = i + 1, s = segs[i];
      if (s === "win") {
        block2(wall.win, wall.r0, x, wy, z);
        i += 2;
      } else if (s === "door") {
        block2(f === 0 ? wall.door : wall.win, wall.r0, x, wy, z);
        i += 2;
      } else {
        tile(wall.fill, wall.r0, x, wy, z);
        tile(wall.fill, wall.r0 + 1, x, wy + 1, z);
        i += 1;
      }
    }
  }
  for (let x = -1; x <= w; x++) {
    const col = x === -1 ? MC_ROOF.edgeL : x === w ? MC_ROOF.edgeR : MC_ROOF.body;
    tile(col.top[0] + off, col.top[1], x, 0, Z_ROOF);
    for (let y = 1; y < ROOF_H - 1; y++) tile(col.body[0] + off, col.body[1], x, y, Z_ROOF);
    tile(col.eave[0] + off, col.eave[1], x, ROOF_H - 1, Z_ROOF);
  }
  if (dormer) {
    const { doorX } = planWallRow(w);
    block2(MC_ROOF.dormerWin.win, MC_ROOF.dormerWin.r0, doorX, 2, Z_ROOF + 1);
    for (const [dc, dr, c, r] of MC_ROOF.dormer) tile(c + off, r, doorX + dc, dr, Z_ROOF + 2);
  }
  const TW = MC_TOWER;
  for (const tw of towers) {
    const toff = TW.coneColours[tw.colour || colour] || 0;
    const dx = tw.side === "L" ? 0 : w - 3;
    const coneTop = 1 - TW.cone.h - (tw.extra ?? 0);
    const drumTopY = coneTop + TW.cone.h;
    const dt = TW.drumTop;
    for (let i = 0; i < 3; i++) tile(dt[0] + i, dt[1], dx + i, drumTopY, Z_TURRETS);
    for (let y = drumTopY + 1; y < H - 1; y++) {
      tile(TW.drum.L[0], TW.drum.L[1], dx, y, Z_TURRETS);
      tile(TW.drum.M[0], TW.drum.M[1], dx + 1, y, Z_TURRETS);
      tile(TW.drum.R[0], TW.drum.R[1], dx + 2, y, Z_TURRETS);
    }
    for (let i = 0; i < 3; i++) tile(TW.base[0] + i, TW.base[1], dx + i, H - 1, Z_TURRETS);
    frame(TW.cone.c0 + toff, TW.cone.r0, TW.cone.w, TW.cone.h, dx - 1, coneTop, Z_TURRETS);
  }
  for (let k = 0; k < (chimney | 0); k++) {
    const cx = k === 0 ? w - 2 : 1, capY = -1;
    tile(MC_CHIMNEY.cap[0], MC_CHIMNEY.cap[1], cx, capY, Z_CHIMNEYS);
    for (let yy = capY + 1; yy < 2; yy++) tile(MC_CHIMNEY.body[0], MC_CHIMNEY.body[1], cx, yy, Z_CHIMNEYS);
  }
  return { sprite: cont, shadow: null };
}
function planHouse(seed, lc, lr) {
  const h = hashU32(seed ^ 264030, lc, lr);
  const bit = (n) => h >> n & 1;
  const pick = (n, arr) => arr[(h >> n) % arr.length];
  const colour = pick(10, ["red", "green", "purple"]);
  const floors = bit(4) ? 2 : 1;
  const towers = [];
  if ((h >> 16) % 6 === 0) towers.push({ side: bit(17) ? "L" : "R", extra: 1 + (h >> 18) % 3, colour });
  return {
    w: pick(0, [6, 8, 8]),
    // even widths (door/window centre cleanly)
    material: "stone",
    floors,
    colour,
    dormer: true,
    chimney: (h >> 26) % 3 === 0 ? 1 : 0,
    towers
  };
}
var MC_TILE_CATALOG = [
  // ── Ground (band at rows ~130-141) ──────────────────────────────────────────────────────────
  {
    name: "Outdoor floor (dirt base + speckle)",
    frame: [4, 140, 8, 9],
    tiles: [DIRT_BASE, ...DIRT_VARS],
    used: true,
    note: "dirt base [4,132] (100% plain) + speckle variants on the even col/row grid (cols 4-11), via sparse(). Laid by the Generated ground"
  },
  {
    name: "Cobble road (tan)",
    frame: [14, 142, 3, 11],
    tiles: [[14, 132]],
    used: false,
    note: "tan cobblestone road \u2014 FP-format autotile block; a grass-on-dirt block sits just below it"
  },
  { name: "Flagstone road (grey)", frame: [18, 142, 3, 13], tiles: [[18, 130]], used: false, note: "grey stone-slab road \u2014 autotile block" },
  { name: "Brick road (red)", frame: [22, 142, 3, 13], tiles: [[22, 130]], used: false, note: "red brick road \u2014 autotile block" },
  { name: "Smooth pavement", frame: [26, 136, 3, 5], tiles: [[26, 132]], used: false, note: "flat tan paving (plaza/courtyard)" },
  { name: "Garden / planting bed", frame: [30, 136, 3, 7], tiles: [[30, 130]], used: false, note: "grass patch + tilled-earth bed" },
  { name: "Hedge fence (green)", frame: [38, 137, 5, 7], tiles: [[38, 131]], used: false, note: "9-slice green hedge enclosure" },
  { name: "Picket fence", frame: [45, 140, 5, 11], tiles: [[45, 130]], used: false, note: "light picket fence \u2014 9-slice + gate" },
  { name: "Wooden fence / gate", frame: [52, 138, 5, 8], tiles: [[52, 131]], used: false, note: "wooden fence/gate frame" },
  // ── Grates / arches (rows ~120-127) ─────────────────────────────────────────────────────────
  { name: "Stone arch (gate/bridge)", frame: [12, 122, 5, 3], tiles: [[12, 120]], used: false, note: "open stone archway" },
  { name: "Iron grate / portcullis", frame: [12, 126, 5, 3], tiles: [[12, 124]], used: false, note: "barred iron gate (sewer/gate)" },
  // ── HOUSE COMPONENTS — the modular pieces a house is tiled from (see docs/design/medieval-city-house-kit.md
  //    + the house breakdown). All 3 ROOF colours: the cells below are the RED set; green = +38 cols,
  //    purple = +76 cols. (Inspector-verify each before the assembler relies on it.)
  // Roof — FIXED-WIDTH gable sprites (no autotile in this pack): each style ships at widths ~2-5
  // across the band (cols 6/11 = w4/w5, 17 = w4, 22 = w3, 26 = w2). The `w5` representative is listed;
  // green = +38 cols, purple = +76 cols. Eave + ridge strips are the horizontal connectors that extend
  // a roof's field between gable ends. (See docs/design/medieval-city-house-kit.md.)
  { name: "Roof \u2014 shallow gable (w5, red)", frame: [11, 40, 5, 4], tiles: [[11, 37]], used: true, note: 'low-pitch gable face; widths 2-5 across the band. assembleHouse roof.style="shallow"' },
  { name: "Roof \u2014 steep gable (w5, red)", frame: [11, 46, 5, 5], tiles: [[11, 42]], used: true, note: 'high-pitch gable face \u2014 cottage roof; widths 2-5. assembleHouse roof.style="steep" (also the dormer at w2)' },
  { name: "Roof \u2014 M double-gable (w5, red)", frame: [11, 60, 5, 7], tiles: [[11, 54]], used: true, note: 'two gables \u2192 an M with a central valley; widths 2-5. assembleHouse roof.style="double"' },
  { name: "Roof \u2014 eave overhang strip (connector)", frame: [11, 49, 5, 2], tiles: [[11, 48]], used: false, note: "roof bottom edge \u2014 extends the roof field horizontally between gable ends (wider-than-5 roofs, TODO)" },
  { name: "Roof \u2014 ridge / shingle row (connector)", frame: [11, 51, 5, 1], tiles: [[11, 51]], used: false, note: "ridge cap / repeatable shingle row for the roof field (wider-than-5 roofs, TODO)" },
  { name: "Roof \u2014 flat / crenellated top (red)", frame: [1, 40, 5, 3], tiles: [[1, 38]], used: false, note: "low/flat roof or annex top" },
  // Walls + openings — assembleHouse tiles these (MC_HOUSE / MC_TOWER). Two materials share one layout.
  { name: "House wall A \u2014 plaster (9-slice)", frame: [22, 81, 7, 11], tiles: [[24, 81]], used: true, note: "plaster wall: nw[22,71] n[23,71] ne[28,71] \xB7 w[22,72] c[24,81] e[28,72]. Dark plank outline on top/left/right; plain fill centre" },
  { name: "House wall B \u2014 grey stone (9-slice)", frame: [22, 108, 7, 11], tiles: [[24, 108]], used: true, note: 'second material, SAME layout +27 rows: nw[22,98] \u2026 c[24,108] \u2026 (rows 98-108). assembleHouse material="stone"' },
  { name: "House \u2014 stone base course", frame: [22, 112, 1, 1], tiles: [[22, 112]], used: true, note: "1-wide stone foundation tile laid along the house foot (also the chimney body)" },
  { name: "Window \u2014 arched glass", frame: [34, 73, 2, 2], tiles: [[34, 72]], used: true, note: "blue stained-glass arched window (2\xD72); stamped per storey + as the dormer face" },
  { name: "Door \u2014 wooden", frame: [31, 73, 2, 2], tiles: [[31, 72]], used: true, note: 'plank door in plaster frame. assembleHouse door="wood"' },
  { name: "Door \u2014 open archway", frame: [31, 76, 2, 2], tiles: [[31, 75]], used: true, note: 'dark arched doorway. assembleHouse door="arch"' },
  { name: "Door \u2014 wide / double (stone frame)", frame: [30, 100, 2, 3], tiles: [[30, 98]], used: true, note: 'wide wooden double-door. assembleHouse door="wide" (window-door variant at [33,98])' },
  { name: "Arch \u2014 arcade / undercroft", frame: [30, 108, 3, 2], tiles: [[30, 107]], used: true, note: 'wide open ground-floor arch. assembleHouse ground="arcade" (narrow open arch at [30,102])' },
  { name: "Jetty support (beam + corbel posts)", frame: [22, 110, 7, 1], tiles: [[22, 110]], used: true, note: "cantilevered upper-floor support under a 2-storey jetty" },
  // Annexes — the conical corner tower, decomposed for parametric height (MC_TOWER)
  { name: "Tower \u2014 cone cap", frame: [20, 19, 5, 8], tiles: [[20, 12]], used: true, note: "red cone with eave flares; green +38c / purple +76c. Caps the drum" },
  { name: "Tower \u2014 cylinder body row", frame: [21, 20, 3, 1], tiles: [[21, 20]], used: true, note: 'one cream cylinder-stave row, repeated for tower height (the "stories above the roof")' },
  { name: "Tower \u2014 rounded base", frame: [21, 21, 3, 1], tiles: [[21, 21]], used: true, note: "foreshortened cylinder foot" },
  {
    name: "Building facades (drop-in, \xD73 colours)",
    frame: [1, 32, 37, 30],
    tiles: [[1, 3]],
    used: false,
    note: "PRE-assembled whole houses & towers \u2014 SUPERSEDED by assembleHouse (kept as reference). Red 1-37, green 39-75, purple 77-113"
  }
  // TODO: chimney + pennant flag live in the f-chimneys / b-pennant_flags PREMADE layers (not this
  // tileset) — decode when wiring those passes. Verify the roof/wall/door cells above in the inspector.
];

// ../auto-battler/src/render/settlement.js
var clampT = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
  const t = clampT(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function planVillage(seed, site) {
  const cx = Math.round(site.x), cy = Math.round(site.y);
  const h0 = hashU32(seed ^ 465518, cx, cy);
  const R = 16 + h0 % 8;
  const streets = [];
  const nStreets = 2 + h0 % 3;
  for (let i = 0; i < nStreets; i++) {
    const hh = hashU32(seed ^ 332346, cx + i * 131, cy + i * 71);
    const ang = i / nStreets * Math.PI * 2 + (hh % 1e3 / 1e3 - 0.5) * 0.9;
    const len = Math.round(R * (0.7 + (hh >>> 9) % 100 / 300));
    streets.push([cx, cy, cx + Math.round(Math.cos(ang) * len), cy + Math.round(Math.sin(ang) * len)]);
  }
  const streetDist = (x, y) => {
    let m = Infinity;
    for (const s of streets) {
      const d = segDist(x, y, s[0], s[1], s[2], s[3]);
      if (d < m) m = d;
    }
    return m;
  };
  const SETBACK = 3, PLAZA = site.r + 1;
  const houses = [], blocked = /* @__PURE__ */ new Set();
  const houseSeed = (seed ^ h0 + 40503) >>> 0;
  const clash = (bx, by, w) => {
    for (let yy = by - 1; yy <= by; yy++) for (let xx = bx; xx < bx + w; xx++) if (blocked.has(xx + "," + yy)) return true;
    return false;
  };
  const mark = (bx, by, w) => {
    for (let yy = by - 1; yy <= by; yy++) for (let xx = bx; xx < bx + w; xx++) blocked.add(xx + "," + yy);
  };
  for (let si = 0; si < streets.length; si++) {
    const [ax, ay, ex, ey] = streets[si];
    const dx = ex - ax, dy = ey - ay, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    let t = PLAZA + 1;
    while (t < L - 1) {
      const hh = hashU32(seed ^ 386939, cx + si * 97, Math.round(t) * 13);
      let stepW = 6;
      for (const side of [-1, 1]) {
        if ((hh >> (side > 0 ? 8 : 0)) % 5 === 0) continue;
        const plan = planHouse(houseSeed, si * 211 + Math.round(t), side);
        stepW = Math.max(stepW, plan.w);
        const px = ax + ux * t + nx * side * SETBACK, py = ay + uy * t + ny * side * SETBACK;
        const fx = ax + ux * t, fy = ay + uy * t;
        const bx = Math.round(px) - (plan.w >> 1), by = Math.round(py);
        const dc = Math.hypot(fx - cx, fy - cy);
        if (dc < PLAZA || dc > R + 2 || clash(bx, by, plan.w)) continue;
        mark(bx, by, plan.w);
        houses.push({ bx, by, plan });
      }
      t += stepW + 1 + hh % 3;
    }
  }
  return { site, cx, cy, R, streets, streetDist, houses, blockedAt: (wx, wy) => blocked.has(wx + "," + wy) };
}

// ../auto-battler/src/render/cityKinds.js
var CITY_KINDS = {
  medieval: {
    label: "Medieval City",
    assets: [MC_TILES_URL],
    // tilesheet(s) the world's load() must fetch (house sprites cut from it)
    sheet: "mcCity",
    // ctx key the world fills with the loaded TextureSource (passed to assemble)
    planVillage,
    // (seed, site) → { streets, streetDist, houses, blockedAt, … }
    assemble: assembleHouse
    // (api, bx, by, plan) → { sprite, shadow }
  }
};
var cityKindAssets = (kinds) => [...new Set(kinds.flatMap((k) => CITY_KINDS[k]?.assets || []))];

// ../auto-battler/src/engine/fpGen.js
var sub = (seed, salt) => (Math.imul(seed | 0, 2654435761) ^ (salt | 0)) >>> 0;
var DIRT_SCALE = 0.04;
var DIRT_THRESHOLD = 0.56;
function isDirt(seed, x, y) {
  return fbm(sub(seed, 53543), x * DIRT_SCALE, y * DIRT_SCALE) > DIRT_THRESHOLD;
}
var STONE_SCALE = 0.085;
var STONE_THRESHOLD = 0.66;
function isStone(seed, x, y) {
  return fbm(sub(seed, 22286), x * STONE_SCALE, y * STONE_SCALE) > STONE_THRESHOLD;
}
var FOREST_SCALE = 0.05;
function forestField(seed, x, y) {
  return fbm(sub(seed, 15740503), x * FOREST_SCALE, y * FOREST_SCALE);
}
var STONE_CLUMP_SCALE = 0.11;
function stoneClumpField(seed, x, y) {
  return fbm(sub(seed, 5702849), x * STONE_CLUMP_SCALE, y * STONE_CLUMP_SCALE);
}
var ELEV_SCALE = 0.025;
var ELEV_THRESHOLD = 0.6;
function isRaised(seed, x, y) {
  return fbm(sub(seed, 57836), x * ELEV_SCALE, y * ELEV_SCALE) > ELEV_THRESHOLD;
}
var RIVER_SCALE = 0.022;
var RIVER_WIDTH = 0.035;
var WARP_SCALE = 0.03;
var WARP_AMP = 22;
function isRiver(seed, x, y) {
  const wx = x + WARP_AMP * (fbm(sub(seed, 1297), x * WARP_SCALE, y * WARP_SCALE) - 0.5);
  const wy = y + WARP_AMP * (fbm(sub(seed, 1298), x * WARP_SCALE, y * WARP_SCALE) - 0.5);
  return Math.abs(fbm(sub(seed, 8654), wx * RIVER_SCALE, wy * RIVER_SCALE) - 0.5) < RIVER_WIDTH;
}

// ../auto-battler/src/render/biomes.js
var FP = "/assets/minifantasy/Minifantasy_ForgottenPlains_v3.6_Commercial_Version/Minifantasy_ForgottenPlains_Assets";
var ORC = "/assets/minifantasy/Minifantasy_Orc_Kingdom_v1.0/Minifantasy_Orc_Kingdom_Assets";
var NECRO = "/assets/minifantasy/Minifantasy_Necropolis_v1.0/Minifantasy_Necropolis_Assets";
var DESERT = "/assets/minifantasy/Minifantasy_DesolateDesert_v2.0/Minifantasy_DesolateDesert_Assets";
var JUNGLE = "/assets/minifantasy/Minifantasy_Lost_Jungle_v1.0/Minifantasy_Lost_Jungle_Assets";
var COL_GRASS = [97, 150, 55];
var COL_DIRT = [118, 80, 38];
var COL_STONE = [120, 120, 122];
var COL_ORC = [150, 128, 95];
var COL_NECRO = [130, 119, 136];
var COL_SAND = [216, 146, 60];
var COL_JUNGLE = [87, 116, 86];
var GAME_BIOMES = {
  forgottenPlains: {
    id: "forgottenPlains",
    sheet: "fp",
    url: `${FP}/Tileset/Minifantasy_ForgottenPlainsTiles.png`,
    ground: { base: [37, 11], vars: [...rect(1, 1, 4, 1), ...rect(2, 3, 3, 5)], rate: 9 },
    path: { base: [8, 4], vars: [[7, 1], [8, 1], [9, 1]], rate: 6 },
    // FP dirt (exact — same tiles the road used)
    macro: (seed, x, y) => isStone(seed, x, y) && !isDirt(seed, x, y) ? COL_STONE : isDirt(seed, x, y) ? COL_DIRT : COL_GRASS
  },
  orc: {
    id: "orc",
    sheet: "orc",
    url: `${ORC}/Tileset/Tiles.png`,
    ground: { base: [7, 51], vars: rect(13, 51, 2, 6), rate: 4 },
    path: { base: [13, 51], vars: [[14, 51], [13, 52], [14, 52]], rate: 5 },
    // darker packed dirt (approx — verify in inspector)
    macro: COL_ORC
  },
  necropolis: {
    id: "necropolis",
    sheet: "necro",
    url: `${NECRO}/Tileset/Biome/CorruptedBiome.png`,
    ground: { base: [1, 1], vars: [[1, 2], [2, 2], [1, 3], [2, 3], [1, 4], [2, 4], [1, 5], [2, 5]], rate: 10 },
    path: { base: [1, 3], vars: [[2, 3], [1, 4], [2, 4]], rate: 6 },
    // darker corruption (approx — verify in inspector)
    macro: COL_NECRO
  },
  // Desolate Desert (legacy-format sheet, decoded by eye): plain sand base + speckle variants
  // (sheet row 3, cols 1–5). Has ForgottenPlainsLinkDirt/Shore_Transitions tiles for seamless
  // FP borders — not used yet (the base layer dithers like the others); a future link-tile pass
  // can swap the FP↔desert seam to those.
  desolateDesert: {
    id: "desolateDesert",
    sheet: "desert",
    url: `${DESERT}/Tileset/Minifantasy_DesolateDesertTiles.png`,
    ground: { base: [1, 3], vars: [[2, 3], [3, 3], [4, 3], [5, 3]], rate: 7 },
    path: { base: [3, 3], vars: [[4, 3], [5, 3]], rate: 6 },
    // packed/worn sand (approx — verify in inspector)
    macro: COL_SAND
  },
  // Lost Jungle: mossy floor (band-3 fill [7,19] + speckle variants, plain-green [7,11] mixed in).
  // The rich clearing/plateau/pillar layers live in the standalone sandbox config (lostJungle.js).
  lostJungle: {
    id: "lostJungle",
    sheet: "jungle",
    url: `${JUNGLE}/Tileset/Tileset.png`,
    ground: { base: [7, 19], vars: [[1, 19], [3, 19], [4, 19], [5, 19], [3, 20], [4, 20], [5, 20], [7, 20], [7, 11]], rate: 4 },
    macro: COL_JUNGLE
  }
};
var GAME_BIOME_URLS = Object.values(GAME_BIOMES).map((b) => b.url);
function biomeGroundTile(desc, wx, wy, seed) {
  const g = desc.ground;
  return sparse(g.base, g.vars, wx, wy, 0, g.rate, seed);
}
function biomePathTile(desc, wx, wy, seed) {
  const p = desc.path || desc.ground;
  return sparse(p.base, p.vars || [], wx, wy, 3, p.rate || 6, seed);
}
var biomePathId = (id) => id + "$path";

// ../auto-battler/src/render/regionMap.js
function makeRegions(W, H, bands, cuts, opts = {}) {
  const { warpScale = 0.014, warpT = 0.035, edgeT = 0.022, ditherSalt = 122 } = opts;
  const sub4 = (seed, salt) => (Math.imul(seed | 0, 2654435761) ^ (salt | 0)) >>> 0;
  function regionAt2(seed, x, y) {
    const warp = warpT * (fbm(sub4(seed, 1441), x * warpScale, y * warpScale) - 0.5) * 2;
    const t = x / W + (H - y) / H + warp;
    let i = 0;
    while (i < cuts.length && t >= cuts[i]) i++;
    let j, d;
    if (i === 0) {
      j = 1;
      d = cuts[0] - t;
    } else if (i === bands.length - 1) {
      j = i - 1;
      d = t - cuts[i - 1];
    } else {
      const dl = t - cuts[i - 1], dr = cuts[i] - t;
      if (dl < dr) {
        j = i - 1;
        d = dl;
      } else {
        j = i + 1;
        d = dr;
      }
    }
    return { id: bands[i], id2: bands[j], edge: Math.max(0, Math.min(1, d / edgeT)) };
  }
  function biomeAt2(seed, x, y) {
    const reg = regionAt2(seed, x, y);
    if (reg.edge < 1 && reg.id !== reg.id2 && rhash(x, y, ditherSalt, seed) / 4294967296 < 0.5 - 0.5 * reg.edge) return reg.id2;
    return reg.id;
  }
  return { regionAt: regionAt2, biomeAt: biomeAt2 };
}

// ../auto-battler/src/render/roadNet.js
var MinHeap = class {
  constructor() {
    this.a = [];
  }
  get size() {
    return this.a.length;
  }
  push(f, c) {
    const a = this.a;
    a.push([f, c]);
    let i = a.length - 1;
    while (i > 0) {
      const p = i - 1 >> 1;
      if (a[p][0] <= a[i][0]) break;
      const t = a[p];
      a[p] = a[i];
      a[i] = t;
      i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (; ; ) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < a.length && a[l][0] < a[s][0]) s = l;
        if (r < a.length && a[r][0] < a[s][0]) s = r;
        if (s === i) break;
        const t = a[s];
        a[s] = a[i];
        a[i] = t;
        i = s;
      }
    }
    return top;
  }
};
function aStar(cost, W, H, start, goal) {
  const N = W * H;
  const g = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const gx = goal % W, gy = goal / W | 0;
  const heur = (c) => Math.abs(c % W - gx) + Math.abs((c / W | 0) - gy);
  g[start] = 0;
  const open = new MinHeap();
  open.push(heur(start), start);
  while (open.size) {
    const cur = open.pop()[1];
    if (cur === goal) {
      const path = [];
      let c = cur;
      while (c !== -1) {
        path.push(c);
        c = came[c];
      }
      return path.reverse();
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % W, cy = cur / W | 0;
    for (let d = 0; d < 4; d++) {
      const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (closed[ni]) continue;
      const ng = g[cur] + cost[ni];
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = cur;
        open.push(ng + heur(ni), ni);
      }
    }
  }
  return null;
}
function aStarWalk(walk, W, H, start, goal, cap = 2e4) {
  const g = /* @__PURE__ */ new Map([[start, 0]]), came = /* @__PURE__ */ new Map(), closed = /* @__PURE__ */ new Set();
  const gx = goal % W, gy = goal / W | 0;
  const heur = (c) => Math.abs(c % W - gx) + Math.abs((c / W | 0) - gy);
  const open = new MinHeap();
  open.push(heur(start), start);
  let n = 0;
  while (open.size && n < cap) {
    const cur = open.pop()[1];
    if (cur === goal) {
      const p = [];
      let c = cur;
      while (c !== void 0) {
        p.push(c);
        c = came.get(c);
      }
      return p.reverse();
    }
    if (closed.has(cur)) continue;
    closed.add(cur);
    n++;
    const cx = cur % W, cy = cur / W | 0;
    for (let d = 0; d < 4; d++) {
      const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !walk(nx, ny)) continue;
      const ni = ny * W + nx;
      if (closed.has(ni)) continue;
      const ng = g.get(cur) + 1;
      if (ng < (g.get(ni) ?? Infinity)) {
        g.set(ni, ng);
        came.set(ni, cur);
        open.push(ng + heur(ni), ni);
      }
    }
  }
  return null;
}
function buildRoadNet(cost, W, H, nodeCells, edges) {
  const work = Uint16Array.from(cost);
  const cells = /* @__PURE__ */ new Set();
  const add = (i) => {
    cells.add(i);
    const x = i % W, y = i / W | 0;
    if (x + 1 < W) cells.add(i + 1);
    if (y + 1 < H) cells.add(i + W);
  };
  for (const [a, b] of edges) {
    const sa = nodeCells[a], sb = nodeCells[b];
    if (sa == null || sb == null) continue;
    const path = aStar(work, W, H, sa, sb);
    if (!path) continue;
    for (const i of path) {
      work[i] = 1;
      add(i);
    }
  }
  return { cells, has: (x, y) => x >= 0 && y >= 0 && x < W && y < H && cells.has(y * W + x) };
}

// ../auto-battler/src/engine/necropolisGen.js
var sub2 = (seed, salt) => (Math.imul(seed | 0, 2654435761) ^ (salt | 0)) >>> 0;
var RIVER_SCALE2 = 0.045;
var RIVER_WIDTH2 = 0.05;
var WARP_SCALE2 = 0.03;
var WARP_AMP2 = 16;
var DARK_SCALE = 0.06;
var DARK_THRESHOLD = 0.6;
function isDark(seed, x, y) {
  return fbm(sub2(seed, 55852), x * DARK_SCALE, y * DARK_SCALE) > DARK_THRESHOLD;
}
var ELEV_SCALE2 = 0.025;
var ELEV_THRESHOLD2 = 0.6;
function isRaised2(seed, x, y) {
  return fbm(sub2(seed, 57836), x * ELEV_SCALE2, y * ELEV_SCALE2) > ELEV_THRESHOLD2;
}
var BONE_SCALE = 0.055;
var BONE_THRESHOLD = 0.62;
function isBone(seed, x, y) {
  return fbm(sub2(seed, 45134), x * BONE_SCALE, y * BONE_SCALE) > BONE_THRESHOLD;
}
var FOREST_SCALE2 = 0.05;
function forestField2(seed, x, y) {
  return fbm(sub2(seed, 15740503), x * FOREST_SCALE2, y * FOREST_SCALE2);
}
function isRiver2(seed, x, y) {
  const wx = x + WARP_AMP2 * (fbm(sub2(seed, 1297), x * WARP_SCALE2, y * WARP_SCALE2) - 0.5);
  const wy = y + WARP_AMP2 * (fbm(sub2(seed, 1298), x * WARP_SCALE2, y * WARP_SCALE2) - 0.5);
  return Math.abs(fbm(sub2(seed, 8654), wx * RIVER_SCALE2, wy * RIVER_SCALE2) - 0.5) < RIVER_WIDTH2;
}

// ../auto-battler/src/sim/walkable.js
function nearestWalkable(walkable, wx, wy, maxR = 24) {
  if (walkable(wx, wy)) return { x: wx, y: wy };
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = wx + dx, y = wy + dy;
        if (walkable(x, y)) return { x, y };
      }
    }
  }
  return { x: wx, y: wy };
}

// ../auto-battler/src/render/forgottenPlains.js
var FP2 = "/assets/minifantasy/Minifantasy_ForgottenPlains_v3.6_Commercial_Version/Minifantasy_ForgottenPlains_Assets";
var TILES = `${FP2}/Tileset/Minifantasy_ForgottenPlainsTiles.png`;
var SHADOW = `${FP2}/Tileset/Minifantasy_ForgottenPlainsTilesShadows.png`;
var PROPS = `${FP2}/props/Minifantasy_ForgottenPlainsProps.png`;
var PROP_SHADOW = `${FP2}/props/Minifantasy_ForgottenPlainsPropsShadows.png`;
var FP_MOCKUP_URL = `${FP2}/Minifantasy_ForgottenPlainsMockup.png`;
var FP_MAP_ASSETS = [TILES, SHADOW, PROPS, PROP_SHADOW];
var TILE3 = 8;
var CHUNK = 32;
var GRASS_BASE = [37, 11];
var GRASS_VARS = [...rect(1, 1, 4, 1), ...rect(2, 3, 3, 5)];
var GRASS_RATE = 9;
var DIRT_BLOCK = [7, 3];
var DIRT_FILL = [8, 4];
var DIRT_VARS2 = [[7, 1], [8, 1], [9, 1]];
var STONE_BLOCK = [12, 3];
var STONE_FILL = [13, 4];
var STONE_VARS = [[12, 1], [13, 1], [14, 1]];
var WATER_BLOCK = [25, 3];
var WATER_FILL = [26, 4];
var WATER_VARS = [[26, 4]];
var FILL_RATE = 6;
var FP_CLIFF = {
  LIP_T: [25, 16],
  LIP_T_VAR: [],
  LIP_TL: [24, 16],
  LIP_TR: [26, 16],
  WALL_L: [24, 17],
  WALL_L_VAR: [],
  WALL_R: [26, 17],
  WALL_R_VAR: [],
  LIP_S: [25, 18],
  LIP_S_VAR: [],
  LIP_SW: [24, 18],
  LIP_SE: [26, 18],
  FILL: [25, 17],
  FILL_VAR: [],
  // flat grass-top tile painted on fully-interior plateau cells
  FACE_H: 2,
  FACE: [[25, 19], [25, 20]],
  FACE_VAR: [[], []],
  FACE_L: [[24, 19], [24, 20]],
  FACE_R: [[26, 19], [26, 20]],
  RATE: 4,
  // Stair exits cut into straight cliff edges. Two sheet variants, one tile wide (cross at cols 2–6)
  // and two tiles wide (cross at cols 8–14); bakeCliffs picks per-exit by hash. Every tile below is
  // a real non-empty sheet cell — the crosses have transparent corners, so placing those would bleed
  // the grass base through (the bug the NARROW arms used to hit). Layout per direction:
  //   • S — NARROW: one column, [lip, step, step, step(onto ground)]. WIDE: 3 columns × those 4 rows.
  //   • N — LIP on the raised back edge (grass+steps) + CAP one tile north on the ground; ×3 cols wide.
  //   • W/E — a descent off the side wall. Each tile carries its {dx,dy} cell-offset from the wall
  //     anchor. NARROW: 3-tile L. WIDE: 2-tall entry on the wall + a 3-tall stone descent beside it.
  STAIR: {
    WIDE_SALT: 359697,
    // hash salt deciding narrow-vs-wide at each exit (~50/50)
    S: {
      NARROW: [[4, 18], [4, 19], [4, 20], [4, 20]],
      WIDE: [
        [[10, 19], [11, 19], [12, 19]],
        [[10, 20], [11, 20], [12, 20]],
        [[10, 21], [11, 21], [12, 21]],
        [[10, 21], [11, 21], [12, 21]]
      ]
    },
    N: {
      NARROW: { LIP: [4, 16], CAP: [4, 15] },
      WIDE: { LIP: [[10, 16], [11, 16], [12, 16]], CAP: [[10, 15], [11, 15], [12, 15]] }
    },
    W: {
      NARROW: [{ dx: 0, dy: 0, t: [3, 17] }, { dx: -1, dy: 0, t: [2, 17] }, { dx: -1, dy: 1, t: [2, 18] }],
      WIDE: [
        { dx: 0, dy: 0, t: [9, 17] },
        { dx: 0, dy: 1, t: [9, 18] },
        { dx: -1, dy: 0, t: [8, 17] },
        { dx: -1, dy: 1, t: [8, 18] },
        { dx: -1, dy: 2, t: [8, 19] }
      ]
    },
    E: {
      NARROW: [{ dx: 0, dy: 0, t: [5, 17] }, { dx: 1, dy: 0, t: [6, 17] }, { dx: 1, dy: 1, t: [6, 18] }],
      WIDE: [
        { dx: 0, dy: 0, t: [13, 17] },
        { dx: 0, dy: 1, t: [13, 18] },
        { dx: 1, dy: 0, t: [14, 17] },
        { dx: 1, dy: 1, t: [14, 18] },
        { dx: 1, dy: 2, t: [14, 19] }
      ]
    }
  }
};
var STAIR_SPACING = 14;
var COL_CLIFF = [150, 138, 112];
var FOLIAGE = [
  { weight: 5, tiles: [[9, 6], [10, 6], [11, 6]] },
  // grass tufts
  { weight: 3, tiles: [[12, 6], [13, 6]] },
  // small reeds
  { weight: 3, tiles: [[9, 9], [10, 9], [11, 9], [12, 9], [13, 9]] },
  // flowers (red/purple/daisy) + small grass
  { weight: 1, sprite: { c: 14, r: 6, w: 1, h: 3 } },
  // tall reed 1×3
  { weight: 1, sprite: { c: 15, r: 6, w: 2, h: 3 } },
  // wide reed 2×3
  { weight: 1, sprite: { c: 17, r: 6, w: 2, h: 3 } },
  // wide reed 2×3
  { weight: 1, sprite: { c: 14, r: 9, w: 1, h: 2 } }
  // cattail 1×2
];
var FOLIAGE_WEIGHT = FOLIAGE.reduce((s, g) => s + g.weight, 0);
var FOLIAGE_RATE = 11;
var WATER_FOLIAGE = { c: 15, r: 9, w: 1, h: 2 };
var WATER_FOLIAGE_RATE = 16;
var TREES = [
  { frame: [155, 3, 21, 25], ax: 0.48, ay: 0.96 },
  // tree 1 (plain)
  { frame: [155, 35, 21, 25], ax: 0.48, ay: 0.96 },
  // tree 2 (fruited)
  { frame: [152, 32, 24, 32], ax: 0.5, ay: 0.94 }
  // tree 3 — full 3×4 fruited (19,4)
];
var TREE_SCALE_BASE = 1;
var TREE_SCALE_JITTER = 0.14;
var TREE_FLIP_RATE = 0.5;
var TREE_JITTER = 2;
var FOREST_BLOCK_X = 3;
var FOREST_BLOCK_Y = 2;
var FOREST_THRESHOLD = 0.6;
var FOREST_MIN_NB = 2;
var FOREST_FILL = 0.5;
var STONES = [
  { c: 8, r: 3, w: 2, h: 2, weight: 3 },
  // small rock
  { c: 10, r: 3, w: 2, h: 2, weight: 3 },
  // small rock
  { c: 12, r: 3, w: 2, h: 2, weight: 3 },
  // small flat rock
  { c: 14, r: 3, w: 2, h: 2, weight: 3 },
  // small rock
  { c: 16, r: 3, w: 2, h: 2, weight: 3 },
  // small rock
  { c: 6, r: 3, w: 2, h: 3, weight: 2 },
  // medium boulder
  { c: 0, r: 3, w: 2, h: 4, weight: 1 },
  // big boulder
  { c: 2, r: 3, w: 2, h: 4, weight: 1 },
  // big boulder
  { c: 4, r: 3, w: 2, h: 4, weight: 1 }
  // big knobbly boulder
];
var STONE_WEIGHT = STONES.reduce((s, g) => s + g.weight, 0);
var STONE_BLOCK_X = 2;
var STONE_BLOCK_Y = 2;
var STONE_CLUMP_THRESHOLD = 0.7;
var STONE_CLUMP_MIN_NB = 3;
var STONE_CLUMP_FILL = 0.7;
var COL_GRASS2 = [97, 150, 55];
var COL_DIRT2 = [118, 80, 38];
var COL_STONE2 = [120, 120, 122];
var COL_WATER = [74, 116, 196];
function loadImg2(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
async function buildShadowMask(url) {
  const img = await loadImg2(url);
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const cols = img.naturalWidth / TILE3 | 0, rows = img.naturalHeight / TILE3 | 0, set = /* @__PURE__ */ new Set();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const d = g.getImageData(c * TILE3, r * TILE3, TILE3, TILE3).data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 8) {
        set.add(c + "," + r);
        break;
      }
    }
  }
  return set;
}
function chunkFields(seed, x0, y0) {
  const WATER_BUFFER = 2;
  const M = WATER_BUFFER + 4, SZ = CHUNK + 2 * M;
  const idx = (i, j) => j * SZ + i;
  const clean = (pred) => {
    let cur = new Uint8Array(SZ * SZ);
    for (let j = 0; j < SZ; j++) for (let i = 0; i < SZ; i++) cur[idx(i, j)] = pred(x0 + i - M, y0 + j - M) ? 1 : 0;
    let nxt = new Uint8Array(SZ * SZ);
    for (let j = 1; j < SZ - 1; j++) for (let i = 1; i < SZ - 1; i++) {
      let c = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) c += cur[idx(i + di, j + dj)];
      nxt[idx(i, j)] = c >= 5 ? 1 : 0;
    }
    cur = nxt;
    for (let p = 0; p < 2; p++) {
      nxt = new Uint8Array(SZ * SZ);
      for (let j = 1; j < SZ - 1; j++) for (let i = 1; i < SZ - 1; i++) {
        const card = cur[idx(i, j - 1)] + cur[idx(i + 1, j)] + cur[idx(i, j + 1)] + cur[idx(i - 1, j)];
        nxt[idx(i, j)] = cur[idx(i, j)] ? card >= 2 ? 1 : 0 : card >= 3 ? 1 : 0;
      }
      cur = nxt;
    }
    return cur;
  };
  const waterF = clean((x, y) => isRiver(seed, x, y));
  const raisedField = clean((x, y) => isRaised(seed, x, y));
  for (let k = 0; k < waterF.length; k++) if (raisedField[k]) waterF[k] = 0;
  const dirtRaw = clean((x, y) => isDirt(seed, x, y));
  const stoneRaw = clean((x, y) => isStone(seed, x, y));
  const fraw = new Uint8Array(SZ * SZ);
  for (let j = 0; j < SZ; j++) for (let i = 0; i < SZ; i++) fraw[idx(i, j)] = forestField(seed, x0 + i - M, y0 + j - M) > FOREST_THRESHOLD ? 1 : 0;
  const forestRegion = new Uint8Array(SZ * SZ);
  for (let j = 1; j < SZ - 1; j++) for (let i = 1; i < SZ - 1; i++) {
    if (!fraw[idx(i, j)]) continue;
    let c = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && fraw[idx(i + di, j + dj)]) c++;
    forestRegion[idx(i, j)] = c >= FOREST_MIN_NB ? 1 : 0;
  }
  const sraw = new Uint8Array(SZ * SZ);
  for (let j = 0; j < SZ; j++) for (let i = 0; i < SZ; i++) sraw[idx(i, j)] = stoneClumpField(seed, x0 + i - M, y0 + j - M) > STONE_CLUMP_THRESHOLD ? 1 : 0;
  const stoneClumpRegion = new Uint8Array(SZ * SZ);
  for (let j = 1; j < SZ - 1; j++) for (let i = 1; i < SZ - 1; i++) {
    if (!sraw[idx(i, j)]) continue;
    let c = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && sraw[idx(i + di, j + dj)]) c++;
    stoneClumpRegion[idx(i, j)] = c >= STONE_CLUMP_MIN_NB ? 1 : 0;
  }
  const dirt = new Uint8Array(SZ * SZ), stone = new Uint8Array(SZ * SZ);
  for (let j = WATER_BUFFER; j < SZ - WATER_BUFFER; j++) for (let i = WATER_BUFFER; i < SZ - WATER_BUFFER; i++) {
    let nearW = 0;
    for (let dj = -WATER_BUFFER; dj <= WATER_BUFFER && !nearW; dj++) for (let di = -WATER_BUFFER; di <= WATER_BUFFER; di++) if (waterF[idx(i + di, j + dj)]) {
      nearW = 1;
      break;
    }
    const rais = raisedField[idx(i, j)];
    dirt[idx(i, j)] = dirtRaw[idx(i, j)] && !nearW && !rais ? 1 : 0;
    stone[idx(i, j)] = stoneRaw[idx(i, j)] && !dirtRaw[idx(i, j)] && !nearW && !rais ? 1 : 0;
  }
  return { waterF, dirt, stone, raisedField, forestRegion, stoneClumpRegion, M, SZ, x0, y0 };
}
var FP_GROUND_FILLS = [
  { key: "grass", url: TILES, tile: GRASS_BASE },
  { key: "dirt", url: TILES, tile: DIRT_FILL },
  { key: "stone", url: TILES, tile: STONE_FILL }
];
function fpGroundFillKey(seed, x, y) {
  if (isStone(seed, x, y) && !isDirt(seed, x, y)) return "stone";
  if (isDirt(seed, x, y)) return "dirt";
  return "grass";
}
var fpConfig = (seed, opts = {}) => ({
  seed,
  tile: TILE3,
  chunk: CHUNK,
  background: "#5a7b3a",
  async load({ Assets }) {
    const ctx = { tiles: null, shadow: null, shadowSet: null, props: null, propShadow: null };
    const t = await Assets.load(TILES);
    t.source.scaleMode = "nearest";
    ctx.tiles = t.source;
    try {
      const s = await Assets.load(SHADOW);
      s.source.scaleMode = "nearest";
      ctx.shadow = s.source;
    } catch {
    }
    try {
      ctx.shadowSet = await buildShadowMask(SHADOW);
    } catch {
      ctx.shadowSet = null;
    }
    if (opts.props !== false) {
      try {
        const p = await Assets.load(PROPS);
        p.source.scaleMode = "nearest";
        ctx.props = p.source;
      } catch {
      }
      try {
        const p = await Assets.load(PROP_SHADOW);
        p.source.scaleMode = "nearest";
        ctx.propShadow = p.source;
      } catch {
      }
    }
    return ctx;
  },
  // `accept(tx,ty)` (chunk-local) gates which tiles this biome paints — defaults to all, so the
  // standalone map is unchanged; the multi-biome overworld passes a per-biome dither mask.
  bake({ x0, y0, seed: seed2, ctx, tmp, Sprite, tex, texFrame, add, accept = () => true }) {
    const f = chunkFields(seed2, x0, y0);
    const { waterF, dirt, stone, raisedField, forestRegion, stoneClumpRegion, M, SZ } = f;
    const idx = (i, j) => j * SZ + i;
    const atW = (wx, wy) => waterF[idx(wx - x0 + M, wy - y0 + M)] === 1;
    const atD = (wx, wy) => dirt[idx(wx - x0 + M, wy - y0 + M)] === 1;
    const atS = (wx, wy) => stone[idx(wx - x0 + M, wy - y0 + M)] === 1;
    const isRaisedAt = (wx, wy) => raisedField[idx(wx - x0 + M, wy - y0 + M)] === 1;
    const place = (coord, tx, ty) => {
      add(ctx.tiles, coord[0], coord[1], tx, ty);
      if (ctx.shadow && (!ctx.shadowSet || ctx.shadowSet.has(coord[0] + "," + coord[1]))) {
        const sh = new Sprite(tex(ctx.shadow, coord[0], coord[1]));
        sh.x = tx * TILE3;
        sh.y = ty * TILE3;
        tmp.addChild(sh);
      }
    };
    const blob = (atFn, BLOCK, fillBase, fillVars, salt, wx, wy, tx, ty) => {
      const N = !atFn(wx, wy - 1), E = !atFn(wx + 1, wy), S = !atFn(wx, wy + 1), W = !atFn(wx - 1, wy);
      if (N && E && S && W) {
        place(sparse(fillBase, fillVars, wx, wy, salt, FILL_RATE, seed2), tx, ty);
        return;
      }
      let cr;
      if (!N && !E && !S && !W) {
        const dNW = !atFn(wx - 1, wy - 1), dNE = !atFn(wx + 1, wy - 1), dSW = !atFn(wx - 1, wy + 1), dSE = !atFn(wx + 1, wy + 1);
        if (!dNW && !dNE && !dSW && !dSE) {
          place(sparse(fillBase, fillVars, wx, wy, salt, FILL_RATE, seed2), tx, ty);
          return;
        }
        cr = centerTile(BLOCK, dNW, dNE, dSW, dSE);
      } else cr = blockTile(BLOCK, N, E, S, W);
      place(cr, tx, ty);
    };
    for (let ty = 0; ty < CHUNK; ty++) for (let tx = 0; tx < CHUNK; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      place(sparse(GRASS_BASE, GRASS_VARS, wx, wy, 0, GRASS_RATE, seed2), tx, ty);
      if (atD(wx, wy)) blob(atD, DIRT_BLOCK, DIRT_FILL, DIRT_VARS2, 1, wx, wy, tx, ty);
      if (atS(wx, wy)) blob(atS, STONE_BLOCK, STONE_FILL, STONE_VARS, 2, wx, wy, tx, ty);
      if (atW(wx, wy)) blob(atW, WATER_BLOCK, WATER_FILL, WATER_VARS, 3, wx, wy, tx, ty);
    }
    const live = [];
    const propSprite = (spec, wx, wy) => {
      const sp = new Sprite(texFrame(ctx.props, spec.c * TILE3, (spec.r - spec.h + 1) * TILE3, spec.w * TILE3, spec.h * TILE3));
      sp.anchor.set(0.5, 1);
      sp.x = wx * TILE3 + TILE3 / 2;
      sp.y = (wy + 1) * TILE3;
      sp.zIndex = (wy + 1) * TILE3;
      return sp;
    };
    if (ctx.props) for (let ty = 0; ty < CHUNK; ty++) for (let tx = 0; tx < CHUNK; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      if (atW(wx, wy)) {
        if (hashU32(seed2 ^ 24301, wx, wy) % WATER_FOLIAGE_RATE === 0) live.push({ sprite: propSprite(WATER_FOLIAGE, wx, wy), shadow: null });
        continue;
      }
      if (atD(wx, wy) || atS(wx, wy)) continue;
      const h = hashU32(seed2 ^ 15733114, wx, wy);
      if (h % FOLIAGE_RATE !== 0) continue;
      let pick = (h >>> 8) % FOLIAGE_WEIGHT, g = FOLIAGE[0];
      for (const grp of FOLIAGE) {
        if (pick < grp.weight) {
          g = grp;
          break;
        }
        pick -= grp.weight;
      }
      if (g.sprite) {
        live.push({ sprite: propSprite(g.sprite, wx, wy), shadow: null });
        continue;
      }
      const [c, r] = g.tiles[(h >>> 16) % g.tiles.length];
      const sp = new Sprite(texFrame(ctx.props, c * TILE3, r * TILE3, TILE3, TILE3));
      sp.x = tx * TILE3;
      sp.y = ty * TILE3;
      tmp.addChild(sp);
    }
    const stairAt = (wx, wy) => {
      const off = hashU32(seed2 ^ 358936, Math.floor(wy / STAIR_SPACING), 0) % STAIR_SPACING;
      return ((wx - off) % STAIR_SPACING + STAIR_SPACING) % STAIR_SPACING === 0;
    };
    const stairAtV = (wx, wy) => {
      const off = hashU32(seed2 ^ 358940, Math.floor(wx / STAIR_SPACING), 0) % STAIR_SPACING;
      return ((wy - off) % STAIR_SPACING + STAIR_SPACING) % STAIR_SPACING === 0;
    };
    bakeCliffs(FP_CLIFF, { chunk: CHUNK, x0, y0, seed: seed2, raised: isRaisedAt, place, accept, stairAt, stairAtV });
    if (ctx.props) {
      const inGrove = (wx, wy) => forestRegion[idx(wx - x0 + M, wy - y0 + M)] === 1;
      const bx0 = Math.floor(x0 / FOREST_BLOCK_X), bx1 = Math.floor((x0 + CHUNK - 1) / FOREST_BLOCK_X);
      const by0 = Math.floor(y0 / FOREST_BLOCK_Y), by1 = Math.floor((y0 + CHUNK - 1) / FOREST_BLOCK_Y);
      for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
        const h = hashU32(seed2 ^ 15748695, bx, by);
        const wx = bx * FOREST_BLOCK_X + h % FOREST_BLOCK_X, wy = by * FOREST_BLOCK_Y + (h >>> 4) % FOREST_BLOCK_Y;
        if (wx < x0 || wx >= x0 + CHUNK || wy < y0 || wy >= y0 + CHUNK) continue;
        if (!accept(wx - x0, wy - y0)) continue;
        if (!inGrove(wx, wy)) continue;
        if ((h >>> 8 & 65535) / 65536 >= FOREST_FILL) continue;
        if (atW(wx, wy) || atS(wx, wy)) continue;
        if (!isRaisedAt(wx, wy)) {
          let onFace = false;
          for (let k = 1; k <= FP_CLIFF.FACE_H; k++) if (isRaisedAt(wx, wy - k)) {
            onFace = true;
            break;
          }
          if (onFace) continue;
        }
        const T = TREES[(h >>> 24) % TREES.length];
        const flip = (h >>> 20 & 255) / 256 < TREE_FLIP_RATE;
        const sc = TREE_SCALE_BASE * (1 + ((h >>> 12 & 255) / 256 - 0.5) * 2 * TREE_SCALE_JITTER);
        const px = wx * TILE3 + TILE3 / 2 + ((h >>> 16 & 15) / 16 - 0.5) * 2 * TREE_JITTER;
        const py = wy * TILE3 + TILE3 / 2 + ((h >>> 28 & 15) / 16 - 0.5) * 2 * TREE_JITTER;
        const tr = new Sprite(texFrame(ctx.props, ...T.frame));
        tr.anchor.set(T.ax, T.ay);
        tr.scale.set(flip ? -sc : sc, sc);
        tr.x = px;
        tr.y = py;
        tr.zIndex = py;
        let shadow = null;
        if (ctx.propShadow) {
          shadow = new Sprite(texFrame(ctx.propShadow, ...T.frame));
          shadow.anchor.set(T.ax, T.ay);
          shadow.scale.set(flip ? -sc : sc, sc);
          shadow.x = px;
          shadow.y = py;
        }
        live.push({ sprite: tr, shadow });
      }
    }
    if (ctx.props) {
      const inClump = (wx, wy) => stoneClumpRegion[idx(wx - x0 + M, wy - y0 + M)] === 1;
      const sbx0 = Math.floor(x0 / STONE_BLOCK_X), sbx1 = Math.floor((x0 + CHUNK - 1) / STONE_BLOCK_X);
      const sby0 = Math.floor(y0 / STONE_BLOCK_Y), sby1 = Math.floor((y0 + CHUNK - 1) / STONE_BLOCK_Y);
      for (let by = sby0; by <= sby1; by++) for (let bx = sbx0; bx <= sbx1; bx++) {
        const h = hashU32(seed2 ^ 5702885, bx, by);
        const wx = bx * STONE_BLOCK_X + h % STONE_BLOCK_X, wy = by * STONE_BLOCK_Y + (h >>> 4) % STONE_BLOCK_Y;
        if (wx < x0 || wx >= x0 + CHUNK || wy < y0 || wy >= y0 + CHUNK) continue;
        if (!accept(wx - x0, wy - y0)) continue;
        if (!inClump(wx, wy)) continue;
        if ((h >>> 8 & 65535) / 65536 >= STONE_CLUMP_FILL) continue;
        if (atW(wx, wy)) continue;
        if (!isRaisedAt(wx, wy)) {
          let onFace = false;
          for (let k = 1; k <= FP_CLIFF.FACE_H; k++) if (isRaisedAt(wx, wy - k)) {
            onFace = true;
            break;
          }
          if (onFace) continue;
        }
        let pick = (h >>> 20) % STONE_WEIGHT, st = STONES[0];
        for (const s of STONES) {
          if (pick < s.weight) {
            st = s;
            break;
          }
          pick -= s.weight;
        }
        live.push({ sprite: propSprite(st, wx, wy), shadow: null });
      }
    }
    return { meta: f, live };
  },
  macroColor(seed2, tx, ty) {
    const raised = isRaised(seed2, tx, ty);
    if (!raised && isRiver(seed2, tx, ty)) return COL_WATER;
    let c = isStone(seed2, tx, ty) && !isDirt(seed2, tx, ty) ? COL_STONE2 : isDirt(seed2, tx, ty) ? COL_DIRT2 : COL_GRASS2;
    if (raised) c = lerp3(c, COL_CLIFF, 0.25);
    return c;
  },
  tileIndexAt(wx, wy, meta) {
    if (!meta) return null;
    const { waterF, dirt, stone, M, SZ, x0, y0 } = meta;
    if (wx - x0 < 0 || wy - y0 < 0 || wx - x0 >= CHUNK || wy - y0 >= CHUNK) return null;
    const idx = (i, j) => j * SZ + i;
    const pick = (fld, BLOCK, fill) => {
      const at = (x, y) => fld[idx(x - x0 + M, y - y0 + M)] === 1;
      const N = !at(wx, wy - 1), E = !at(wx + 1, wy), S = !at(wx, wy + 1), W = !at(wx - 1, wy);
      if (N && E && S && W) return fill;
      if (!N && !E && !S && !W) {
        const dNW = !at(wx - 1, wy - 1), dNE = !at(wx + 1, wy - 1), dSW = !at(wx - 1, wy + 1), dSE = !at(wx + 1, wy + 1);
        if (!dNW && !dNE && !dSW && !dSE) return fill;
        return centerTile(BLOCK, dNW, dNE, dSW, dSE);
      }
      return blockTile(BLOCK, N, E, S, W);
    };
    if (waterF[idx(wx - x0 + M, wy - y0 + M)] === 1) return pick(waterF, WATER_BLOCK, WATER_FILL);
    if (stone[idx(wx - x0 + M, wy - y0 + M)] === 1) return pick(stone, STONE_BLOCK, STONE_FILL);
    if (dirt[idx(wx - x0 + M, wy - y0 + M)] === 1) return pick(dirt, DIRT_BLOCK, DIRT_FILL);
    return GRASS_BASE;
  }
});

// ../auto-battler/src/render/desolateDesert.js
var STAIR_SPACING2 = 14;
var DD = "/assets/minifantasy/Minifantasy_DesolateDesert_v2.0/Minifantasy_DesolateDesert_Assets";
var TILES2 = `${DD}/Tileset/Minifantasy_DesolateDesertTiles.png`;
var PROPS2 = `${DD}/Props/Minifantasy_DesolateDesertProps.png`;
var PROP_SHADOW2 = `${DD}/Props/Minifantasy_DesolateDesertPropsShadows.png`;
var DD_MOCKUP_URL = `${DD}/Minifantasy_DesolateDesertMockup.png`;
var DD_MAP_ASSETS = [TILES2, PROPS2, PROP_SHADOW2];
var TILE4 = 8;
var CHUNK2 = 32;
var SAND_BASE = [1, 3];
var SAND_VARS = [[2, 3], [3, 3], [4, 3], [5, 3]];
var SAND_RATE = 7;
var CRACK_BLOCK = [8, 5];
var CRACK_FILL = [9, 6];
var CRACK_VARS = [[8, 3], [9, 3], [10, 3]];
var GOLD_BLOCK = [14, 5];
var GOLD_FILL = [15, 6];
var GOLD_VARS = [[13, 3], [14, 3], [15, 3], [16, 3], [17, 3]];
var GOLD_CLIFF_BUF = 2;
var WATER_BLOCK2 = [20, 5];
var WATER_FILL2 = [21, 6];
var WATER_VARS2 = [[21, 6]];
var FILL_RATE2 = 6;
var CACTI = [
  { c: 9, r: 6, w: 2, h: 2, weight: 3 },
  // armed saguaro A — arms up (2×2, sheet rows 5–6)
  { c: 9, r: 8, w: 2, h: 2, weight: 3 },
  // armed saguaro B — arms out (2×2, sheet rows 7–8)
  { c: 13, r: 6, w: 2, h: 2, weight: 2 },
  // green desert shrub (2×2, sheet rows 5–6)
  { c: 13, r: 8, w: 2, h: 2, weight: 1 }
  // teal agave succulent (2×2, sheet rows 7–8)
];
var CACTUS_WEIGHT = CACTI.reduce((s, g) => s + g.weight, 0);
var CACTUS_BLOCK_X = 3;
var CACTUS_BLOCK_Y = 3;
var CACTUS_FILL = 0.22;
var PALMS = [
  { c: 6, r: 6, w: 2, h: 2 },
  { c: 6, r: 8, w: 2, h: 2 },
  { c: 6, r: 10, w: 2, h: 2 }
];
var PALM_RATE = 2;
var BOULDERS = [
  { c: 1, r: 6, w: 2, h: 2, weight: 3 },
  // small boulder (sheet rows 5–6)
  { c: 1, r: 8, w: 2, h: 2, weight: 2 }
  // bigger boulder (sheet rows 7–8)
];
var BOULDER_WEIGHT = BOULDERS.reduce((s, g) => s + g.weight, 0);
var BOULDER_BLOCK_X = 2;
var BOULDER_BLOCK_Y = 2;
var BOULDER_CLUMP_THRESHOLD = 0.7;
var BOULDER_CLUMP_MIN_NB = 3;
var BOULDER_CLUMP_FILL = 0.6;
var GROUND_PROPS = [
  { weight: 5, tiles: [[6, 1], [7, 1], [6, 2], [7, 2], [6, 3], [7, 3]] },
  // orange gravel specks
  { weight: 3, tiles: [[3, 1], [4, 1], [3, 3], [4, 3]] },
  // bleached bones
  { weight: 2, tiles: [[1, 1], [1, 2], [1, 3]] },
  // pebbles
  { weight: 4, tiles: [[9, 1], [9, 2], [9, 3], [11, 1], [11, 3], [13, 1], [14, 1], [13, 3], [14, 3], [16, 1], [17, 1], [16, 3], [17, 3]] }
  // small cacti: col-9 ×3, barrel, aloe, prickly-pear (flowering + plain)
];
var GROUND_WEIGHT = GROUND_PROPS.reduce((s, g) => s + g.weight, 0);
var GROUND_RATE = 12;
var tk = (c, r) => `${c},${r}`;
var USED_TILES = new Set(
  // Golden sand wires only SET 1 (block [14,5] + its 2 concave rows) + the row-3 fill variants; the
  // second blob variation (rows 10-14) stays unwired, so its catalogue entries read "unused".
  [
    SAND_BASE,
    ...SAND_VARS,
    CRACK_BLOCK,
    CRACK_FILL,
    ...CRACK_VARS,
    WATER_BLOCK2,
    WATER_FILL2,
    ...WATER_VARS2,
    ...GOLD_VARS,
    ...rect(14, 5, 3, 3),
    ...rect(14, 8, 3, 2)
  ].map(([c, r]) => tk(c, r))
);
var ddTile = (name, frame, tiles, note) => ({ name, frame, tiles, used: tiles.some(([c, r]) => USED_TILES.has(tk(c, r))), note });
var DD_TILE_CATALOG = [
  ddTile(
    "Sand (base + speckle)",
    [1, 3, 5, 1],
    [SAND_BASE, [2, 3], [3, 3], [4, 3], [5, 3]],
    "base ground \u2014 [1,3] + 4 speckle variants, via sparse() (cf. FP grass base)"
  ),
  // Golden sand — a brighter sand material in the SAME FP autotile format as cracked sand: a row-3
  // interior-fill strip (cols 13-17) PLUS a full blockTile/centerTile blob (3×3 edges + 2 concave
  // rows), shipped in TWO variations (rows 5-9 and 10-14). Only the single fill tile [13,3] is wired
  // today (sprinkled into the sand base via SAND_VARS); the rest are available for golden-sand
  // patches/regions. NB: the old "Dune mounds — not a tileable set" entry mislabeled this very block.
  ddTile(
    "Golden sand (fill + variants)",
    [13, 3, 5, 1],
    rect(13, 3, 5, 1),
    "interior fill for golden-sand patches, sprinkled via sparse() inside the blob ([15,6] base + these): [13-15,3] clean dash-fill, [16-17,3] busier with detail specks. Never placed as a lone tile on bare sand"
  ),
  ddTile(
    "Golden sand patch \u2014 9-slice",
    [14, 7, 3, 3],
    rect(14, 5, 3, 3),
    "FP-format blockTile blob \u2014 8 edges/convex-corners + center fill [15,6], TL anchor [14,5]. The rim set that lets golden sand form patches (would key off a noise field, exactly like cracked sand) \u2014 unused"
  ),
  ddTile(
    "Golden sand patch \u2014 concave + specks",
    [14, 9, 3, 2],
    rect(14, 8, 3, 2),
    "centerTile concave tiles (the 2 rows below the block): [14-15,8] & [14-15,9] = single-diagonal inner corners (the \u201Cdiamond\u201D), [16,8]/[16,9] = the double-diagonal specks \u2014 unused"
  ),
  ddTile(
    "Golden sand patch \u2014 9-slice (var)",
    [14, 12, 3, 3],
    rect(14, 10, 3, 3),
    "a SECOND golden blob variation (busier, more speckled edges) \u2014 block anchor [14,10], fill [15,11]; same 9-slice layout as the first \u2014 unused"
  ),
  ddTile(
    "Golden sand patch \u2014 concave + specks (var)",
    [14, 14, 3, 2],
    rect(14, 13, 3, 2),
    "concave tiles for the variation blob: diamond [14-15,13/14] + specks [16,13]/[16,14] \u2014 unused"
  ),
  ddTile(
    "Cracked sand",
    [8, 7, 3, 3],
    [CRACK_BLOCK, CRACK_FILL, [8, 3], [9, 3], [10, 3]],
    "autotile blob (blockTile/centerTile) \u2190isDirt \u2014 block [8,5], fill [9,6]; exactly like FP dirt/stone"
  ),
  ddTile(
    "Oasis water (grass shore)",
    [20, 7, 3, 3],
    [WATER_BLOCK2, WATER_FILL2],
    "water blob \u2190isRiver \u2014 grass-ringed oasis [20,5], same autotiler as FP rivers"
  ),
  ddTile(
    "Oasis water (grass, var 2)",
    [24, 7, 3, 3],
    [[24, 5]],
    "a second grass-shored water block \u2014 unused"
  ),
  ddTile(
    "Oasis water (sand shore)",
    [20, 13, 3, 3],
    [[20, 11], [24, 11]],
    "water blob with a sand rim instead of grass (cols 20-22 / 24-26, rows 11+) \u2014 unused"
  ),
  ddTile(
    "Grass (oasis patch)",
    [2, 7, 3, 3],
    [[2, 5]],
    "autotile grass-on-sand block + row-1 fill; same FP-format autotiler \u2014 unused (oasis uses the grass-rimmed water block)"
  ),
  ddTile(
    "Sand plateau (sample)",
    [7, 14, 3, 4],
    [[7, 11]],
    "a pre-assembled sand-mesa sample \u2014 unused (the rock cliff below is used instead)"
  ),
  {
    name: "Cliffs & ladders (rock)",
    frame: [9, 27, 3, 5],
    tiles: [[10, 23]],
    used: true,
    note: "the desert\u2019s OWN grey-rock cliff + stair set \u2014 mesa (cols 9-11 rows 23-27: rim/wall/face) + stair crosses (WIDE cols 1-7 rows 16-22, NARROW cols 9-13 rows 15-20). Wired via DESERT_CLIFF + bakeCliffs \u2190isRaised, the same 2.5D path as FP"
  },
  ddTile(
    "Standing stones",
    [13, 27, 1, 4],
    [[13, 24]],
    "thin 1-wide menhirs of varying height (cols 1/7/13) \u2014 unused (would be live props)"
  )
];
var COL_SAND2 = [216, 146, 60];
var COL_CRACK = [180, 120, 55];
var COL_WATER2 = [86, 134, 196];
var COL_GOLD = [228, 184, 92];
var COL_CLIFF2 = [196, 158, 104];
var DESERT_CLIFF = {
  LIP_T: [10, 23],
  LIP_T_VAR: [],
  LIP_TL: [9, 23],
  LIP_TR: [11, 23],
  // top rim + corners
  WALL_L: [9, 24],
  WALL_L_VAR: [],
  WALL_R: [11, 24],
  WALL_R_VAR: [],
  LIP_S: [10, 25],
  LIP_S_VAR: [],
  LIP_SW: [9, 25],
  LIP_SE: [11, 25],
  // front (south) rim
  FILL: [10, 24],
  FILL_VAR: [],
  // flat rock-top tile painted on fully-interior plateau cells
  FACE_H: 2,
  FACE: [[10, 26], [10, 27]],
  FACE_VAR: [[], []],
  // 2-row hatched-rock overhang
  FACE_L: [[9, 26], [9, 27]],
  FACE_R: [[11, 26], [11, 27]],
  RATE: 4,
  STAIR: {
    WIDE_SALT: 359697,
    // WIDE stair = cols 1–7 rows 16–22 (centre cols 3–5); NARROW = cols 9–13 rows 15–20 (centre col 11).
    S: { NARROW: [[11, 18], [11, 19], [11, 20], [11, 20]], WIDE: [[[3, 20], [4, 20], [5, 20]], [[3, 21], [4, 21], [5, 21]], [[3, 22], [4, 22], [5, 22]], [[3, 22], [4, 22], [5, 22]]] },
    N: { NARROW: { LIP: [11, 16], CAP: [11, 15] }, WIDE: { LIP: [[3, 17], [4, 17], [5, 17]], CAP: [[3, 16], [4, 16], [5, 16]] } },
    W: { NARROW: [{ dx: 0, dy: 0, t: [10, 17] }, { dx: -1, dy: 0, t: [9, 17] }, { dx: -1, dy: 1, t: [9, 18] }], WIDE: [{ dx: 0, dy: 0, t: [2, 18] }, { dx: 0, dy: 1, t: [2, 19] }, { dx: -1, dy: 0, t: [1, 18] }, { dx: -1, dy: 1, t: [1, 19] }, { dx: -1, dy: 2, t: [1, 20] }] },
    E: { NARROW: [{ dx: 0, dy: 0, t: [12, 17] }, { dx: 1, dy: 0, t: [13, 17] }, { dx: 1, dy: 1, t: [13, 18] }], WIDE: [{ dx: 0, dy: 0, t: [6, 18] }, { dx: 0, dy: 1, t: [6, 19] }, { dx: 1, dy: 0, t: [7, 18] }, { dx: 1, dy: 1, t: [7, 19] }, { dx: 1, dy: 2, t: [7, 20] }] }
  }
};
function chunkFields2(seed, x0, y0) {
  const WATER_BUFFER = 2, M = WATER_BUFFER + 5, SZ = CHUNK2 + 2 * M;
  const idx = (i, j) => j * SZ + i;
  const waterF = cleanField((lx, ly) => isRiver(seed, x0 + lx, y0 + ly), M, SZ);
  const crackRaw = cleanField((lx, ly) => isDirt(seed, x0 + lx, y0 + ly), M, SZ);
  const goldRaw = cleanField((lx, ly) => {
    const wx = x0 + lx, wy = y0 + ly;
    if (!isStone(seed, wx, wy) || isDirt(seed, wx, wy)) return false;
    for (let dj = -GOLD_CLIFF_BUF; dj <= GOLD_CLIFF_BUF; dj++) for (let di = -GOLD_CLIFF_BUF; di <= GOLD_CLIFF_BUF; di++) if (isRaised(seed, wx + di, wy + dj)) return false;
    for (let dj = -WATER_BUFFER; dj <= WATER_BUFFER; dj++) for (let di = -WATER_BUFFER; di <= WATER_BUFFER; di++) if (isRiver(seed, wx + di, wy + dj)) return false;
    return true;
  }, M, SZ);
  const raisedField = cleanField((lx, ly) => isRaised(seed, x0 + lx, y0 + ly), M, SZ);
  for (let k = 0; k < waterF.length; k++) if (raisedField[k]) waterF[k] = 0;
  const sraw = new Uint8Array(SZ * SZ);
  for (let j = 0; j < SZ; j++) for (let i = 0; i < SZ; i++) sraw[idx(i, j)] = stoneClumpField(seed, x0 + i - M, y0 + j - M) > BOULDER_CLUMP_THRESHOLD ? 1 : 0;
  const boulderRegion = new Uint8Array(SZ * SZ);
  for (let j = 1; j < SZ - 1; j++) for (let i = 1; i < SZ - 1; i++) {
    if (!sraw[idx(i, j)]) continue;
    let c = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && sraw[idx(i + di, j + dj)]) c++;
    boulderRegion[idx(i, j)] = c >= BOULDER_CLUMP_MIN_NB ? 1 : 0;
  }
  const crack = new Uint8Array(SZ * SZ);
  for (let j = WATER_BUFFER; j < SZ - WATER_BUFFER; j++) for (let i = WATER_BUFFER; i < SZ - WATER_BUFFER; i++) {
    let nearW = 0;
    for (let dj = -WATER_BUFFER; dj <= WATER_BUFFER && !nearW; dj++) for (let di = -WATER_BUFFER; di <= WATER_BUFFER; di++) if (waterF[idx(i + di, j + dj)]) {
      nearW = 1;
      break;
    }
    crack[idx(i, j)] = crackRaw[idx(i, j)] && !nearW && !raisedField[idx(i, j)] ? 1 : 0;
  }
  const gold = goldRaw;
  return { waterF, crack, gold, boulderRegion, raisedField, M, SZ, x0, y0 };
}
var DD_GROUND_FILLS = [
  { key: "sand", url: TILES2, tile: SAND_BASE },
  { key: "crack", url: TILES2, tile: CRACK_FILL },
  { key: "gold", url: TILES2, tile: GOLD_FILL }
];
function ddGroundFillKey(seed, x, y) {
  return isDirt(seed, x, y) ? "crack" : isStone(seed, x, y) ? "gold" : "sand";
}
var desolateDesertConfig = (seed, opts = {}) => ({
  seed,
  tile: TILE4,
  chunk: CHUNK2,
  background: "#c8923c",
  async load({ Assets }) {
    const ctx = { tiles: null, props: null, propShadow: null };
    const t = await Assets.load(TILES2);
    t.source.scaleMode = "nearest";
    ctx.tiles = t.source;
    if (opts.props !== false) {
      try {
        const p = await Assets.load(PROPS2);
        p.source.scaleMode = "nearest";
        ctx.props = p.source;
      } catch {
      }
      try {
        const p = await Assets.load(PROP_SHADOW2);
        p.source.scaleMode = "nearest";
        ctx.propShadow = p.source;
      } catch {
      }
    }
    return ctx;
  },
  bake({ x0, y0, seed: seed2, ctx, tmp, Sprite, tex, texFrame, add, accept = () => true }) {
    const f = chunkFields2(seed2, x0, y0);
    const { waterF, crack, gold, boulderRegion, raisedField, M, SZ } = f;
    const idx = (i, j) => j * SZ + i;
    const atW = (wx, wy) => waterF[idx(wx - x0 + M, wy - y0 + M)] === 1;
    const atC = (wx, wy) => crack[idx(wx - x0 + M, wy - y0 + M)] === 1;
    const atG = (wx, wy) => gold[idx(wx - x0 + M, wy - y0 + M)] === 1;
    const isRaisedAt = (wx, wy) => raisedField[idx(wx - x0 + M, wy - y0 + M)] === 1;
    const onCliffFace = (wx, wy) => {
      if (isRaisedAt(wx, wy)) return false;
      for (let k = 1; k <= DESERT_CLIFF.FACE_H; k++) if (isRaisedAt(wx, wy - k)) return true;
      return false;
    };
    const blob = (atFn, BLOCK, fillBase, fillVars, salt, wx, wy, tx, ty) => {
      const N = !atFn(wx, wy - 1), E = !atFn(wx + 1, wy), S = !atFn(wx, wy + 1), W = !atFn(wx - 1, wy);
      if (N && E && S && W) {
        add(ctx.tiles, ...sparse(fillBase, fillVars, wx, wy, salt, FILL_RATE2, seed2), tx, ty);
        return;
      }
      let cr;
      if (!N && !E && !S && !W) {
        const dNW = !atFn(wx - 1, wy - 1), dNE = !atFn(wx + 1, wy - 1), dSW = !atFn(wx - 1, wy + 1), dSE = !atFn(wx + 1, wy + 1);
        if (!dNW && !dNE && !dSW && !dSE) {
          add(ctx.tiles, ...sparse(fillBase, fillVars, wx, wy, salt, FILL_RATE2, seed2), tx, ty);
          return;
        }
        cr = centerTile(BLOCK, dNW, dNE, dSW, dSE);
      } else cr = blockTile(BLOCK, N, E, S, W);
      add(ctx.tiles, cr[0], cr[1], tx, ty);
    };
    for (let ty = 0; ty < CHUNK2; ty++) for (let tx = 0; tx < CHUNK2; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      add(ctx.tiles, ...sparse(SAND_BASE, SAND_VARS, wx, wy, 0, SAND_RATE, seed2), tx, ty);
      if (atG(wx, wy)) blob(atG, GOLD_BLOCK, GOLD_FILL, GOLD_VARS, 2, wx, wy, tx, ty);
      if (atC(wx, wy)) blob(atC, CRACK_BLOCK, CRACK_FILL, CRACK_VARS, 1, wx, wy, tx, ty);
      if (atW(wx, wy)) blob(atW, WATER_BLOCK2, WATER_FILL2, WATER_VARS2, 3, wx, wy, tx, ty);
    }
    const live = [];
    const propSprite = (spec, wx, wy) => {
      const sp = new Sprite(texFrame(ctx.props, spec.c * TILE4, (spec.r - spec.h + 1) * TILE4, spec.w * TILE4, spec.h * TILE4));
      sp.anchor.set(0.5, 1);
      sp.x = wx * TILE4 + TILE4 / 2;
      sp.y = (wy + 1) * TILE4;
      sp.zIndex = (wy + 1) * TILE4;
      return sp;
    };
    const propShadowSprite = (spec, wx, wy) => {
      if (!ctx.propShadow) return null;
      const sp = new Sprite(texFrame(ctx.propShadow, spec.c * TILE4, (spec.r - spec.h + 1) * TILE4, spec.w * TILE4, spec.h * TILE4));
      sp.anchor.set(0.5, 1);
      sp.x = wx * TILE4 + TILE4 / 2;
      sp.y = (wy + 1) * TILE4;
      return sp;
    };
    if (ctx.props) for (let ty = 0; ty < CHUNK2; ty++) for (let tx = 0; tx < CHUNK2; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      if (atW(wx, wy)) continue;
      const hh = hashU32(seed2 ^ 23197, wx, wy);
      if (hh % GROUND_RATE !== 0) continue;
      let pick = (hh >>> 8) % GROUND_WEIGHT, g = GROUND_PROPS[0];
      for (const grp of GROUND_PROPS) {
        if (pick < grp.weight) {
          g = grp;
          break;
        }
        pick -= grp.weight;
      }
      const [c, r] = g.tiles[(hh >>> 16) % g.tiles.length];
      const sp = new Sprite(texFrame(ctx.props, c * TILE4, r * TILE4, TILE4, TILE4));
      sp.x = tx * TILE4;
      sp.y = ty * TILE4;
      tmp.addChild(sp);
    }
    {
      const place = (coord, tx, ty) => add(ctx.tiles, coord[0], coord[1], tx, ty);
      const stairAt = (wx, wy) => {
        const off = hashU32(seed2 ^ 358936, Math.floor(wy / STAIR_SPACING2), 0) % STAIR_SPACING2;
        return ((wx - off) % STAIR_SPACING2 + STAIR_SPACING2) % STAIR_SPACING2 === 0;
      };
      const stairAtV = (wx, wy) => {
        const off = hashU32(seed2 ^ 358940, Math.floor(wx / STAIR_SPACING2), 0) % STAIR_SPACING2;
        return ((wy - off) % STAIR_SPACING2 + STAIR_SPACING2) % STAIR_SPACING2 === 0;
      };
      bakeCliffs(DESERT_CLIFF, { chunk: CHUNK2, x0, y0, seed: seed2, raised: isRaisedAt, place, accept, stairAt, stairAtV });
    }
    if (ctx.props) scatter(seed2 ^ 51911, CACTUS_BLOCK_X, CACTUS_BLOCK_Y, x0, y0, accept, (wx, wy, h) => {
      if (atW(wx, wy) || onCliffFace(wx, wy)) return;
      if ((h >>> 8 & 65535) / 65536 >= CACTUS_FILL) return;
      let pick = (h >>> 20) % CACTUS_WEIGHT, ca = CACTI[0];
      for (const c of CACTI) {
        if (pick < c.weight) {
          ca = c;
          break;
        }
        pick -= c.weight;
      }
      live.push({ sprite: propSprite(ca, wx, wy), shadow: propShadowSprite(ca, wx, wy) });
    });
    if (ctx.props) for (let ty = 0; ty < CHUNK2; ty++) for (let tx = 0; tx < CHUNK2; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      if (atW(wx, wy) || onCliffFace(wx, wy)) continue;
      if (!(atW(wx - 1, wy) || atW(wx + 1, wy) || atW(wx, wy - 1) || atW(wx, wy + 1))) continue;
      const h = hashU32(seed2 ^ 39454, wx, wy);
      if (h % PALM_RATE !== 0) continue;
      const pa = PALMS[(h >>> 8) % PALMS.length];
      live.push({ sprite: propSprite(pa, wx, wy), shadow: propShadowSprite(pa, wx, wy) });
    }
    if (ctx.props) {
      const inClump = (wx, wy) => boulderRegion[idx(wx - x0 + M, wy - y0 + M)] === 1;
      scatter(seed2 ^ 11541986, BOULDER_BLOCK_X, BOULDER_BLOCK_Y, x0, y0, accept, (wx, wy, h) => {
        if (!inClump(wx, wy) || atW(wx, wy) || onCliffFace(wx, wy)) return;
        if ((h >>> 8 & 65535) / 65536 >= BOULDER_CLUMP_FILL) return;
        let pick = (h >>> 20) % BOULDER_WEIGHT, b = BOULDERS[0];
        for (const s of BOULDERS) {
          if (pick < s.weight) {
            b = s;
            break;
          }
          pick -= s.weight;
        }
        live.push({ sprite: propSprite(b, wx, wy), shadow: propShadowSprite(b, wx, wy) });
      });
    }
    return { meta: f, live };
  },
  macroColor(seed2, tx, ty) {
    if (isRaised(seed2, tx, ty)) return COL_CLIFF2;
    if (isRiver(seed2, tx, ty)) return COL_WATER2;
    if (isDirt(seed2, tx, ty)) return COL_CRACK;
    if (isStone(seed2, tx, ty)) return COL_GOLD;
    return COL_SAND2;
  },
  tileIndexAt(wx, wy, meta) {
    if (!meta) return null;
    const { waterF, crack, gold, M, SZ, x0, y0 } = meta;
    if (wx - x0 < 0 || wy - y0 < 0 || wx - x0 >= CHUNK2 || wy - y0 >= CHUNK2) return null;
    const idx = (i, j) => j * SZ + i;
    const pick = (fld, BLOCK, fill) => {
      const at = (x, y) => fld[idx(x - x0 + M, y - y0 + M)] === 1;
      const N = !at(wx, wy - 1), E = !at(wx + 1, wy), S = !at(wx, wy + 1), W = !at(wx - 1, wy);
      if (N && E && S && W) return fill;
      if (!N && !E && !S && !W) {
        const dNW = !at(wx - 1, wy - 1), dNE = !at(wx + 1, wy - 1), dSW = !at(wx - 1, wy + 1), dSE = !at(wx + 1, wy + 1);
        if (!dNW && !dNE && !dSW && !dSE) return fill;
        return centerTile(BLOCK, dNW, dNE, dSW, dSE);
      }
      return blockTile(BLOCK, N, E, S, W);
    };
    if (waterF[idx(wx - x0 + M, wy - y0 + M)] === 1) return pick(waterF, WATER_BLOCK2, WATER_FILL2);
    if (crack[idx(wx - x0 + M, wy - y0 + M)] === 1) return pick(crack, CRACK_BLOCK, CRACK_FILL);
    if (gold[idx(wx - x0 + M, wy - y0 + M)] === 1) return pick(gold, GOLD_BLOCK, GOLD_FILL);
    return SAND_BASE;
  }
});
function scatter(salt, bx, by, x0, y0, accept, place) {
  const bx0 = Math.floor(x0 / bx), bx1 = Math.floor((x0 + CHUNK2 - 1) / bx);
  const by0 = Math.floor(y0 / by), by1 = Math.floor((y0 + CHUNK2 - 1) / by);
  for (let gy = by0; gy <= by1; gy++) for (let gx = bx0; gx <= bx1; gx++) {
    const h = hashU32(salt, gx, gy);
    const wx = gx * bx + h % bx, wy = gy * by + (h >>> 4) % by;
    if (wx < x0 || wx >= x0 + CHUNK2 || wy < y0 || wy >= y0 + CHUNK2) continue;
    if (!accept(wx - x0, wy - y0)) continue;
    place(wx, wy, h);
  }
}

// ../auto-battler/src/engine/orcGen.js
var sub3 = (seed, salt) => (Math.imul(seed | 0, 2654435761) ^ (salt | 0)) >>> 0;
var DDIRT_SCALE = 0.045;
var DDIRT_THRESHOLD = 0.55;
function isDarkerDirt(seed, x, y) {
  return fbm(sub3(seed, 56599), x * DDIRT_SCALE, y * DDIRT_SCALE) > DDIRT_THRESHOLD;
}
var GRASS_SCALE = 0.04;
var GRASS_THRESHOLD = 0.58;
function isGrass(seed, x, y) {
  return fbm(sub3(seed, 27221), x * GRASS_SCALE, y * GRASS_SCALE) > GRASS_THRESHOLD;
}
var ROCK_SCALE = 0.12;
var ROCK_THRESHOLD = 0.64;
function isRock(seed, x, y) {
  return fbm(sub3(seed, 16588), x * ROCK_SCALE, y * ROCK_SCALE) > ROCK_THRESHOLD;
}

// ../auto-battler/src/render/orcKingdom.js
var ORC2 = "/assets/minifantasy/Minifantasy_Orc_Kingdom_v1.0/Minifantasy_Orc_Kingdom_Assets";
var TILES3 = `${ORC2}/Tileset/Tiles.png`;
var ORC_MAP_ASSETS = [TILES3];
var TILE5 = 8;
var CHUNK3 = 32;
var DIRT_BASE2 = [7, 51];
var DIRT_VARS3 = rect(13, 51, 2, 6);
var DIRT_RATE = 4;
var GRASS = {
  fill: [3, 51],
  vars: [],
  N: [3, 54],
  S: [3, 52],
  E: [2, 53],
  W: [4, 53],
  cNW: [4, 54],
  cNE: [2, 54],
  cSW: [4, 52],
  cSE: [2, 52],
  vNW: [3, 56],
  vNE: [2, 56],
  vSW: [3, 55],
  vSE: [2, 55],
  dNWSE: [4, 55],
  dSWNE: [4, 56]
};
var DDIRT = {
  fill: [7, 53],
  vars: rect(10, 51, 2, 6),
  N: [7, 52],
  S: [7, 54],
  E: [8, 53],
  W: [6, 53],
  vNW: [6, 52],
  vNE: [8, 52],
  vSW: [6, 54],
  vSE: [8, 54],
  cNW: [6, 55],
  cNE: [7, 55],
  cSW: [6, 56],
  cSE: [7, 56],
  dNWSE: [8, 55],
  dSWNE: [8, 56]
};
var OVERLAY_RATE = 5;
var ROCK_COLOR_OFF = [0, 6, 12];
var STONE_SIZES = [[16, 51], [16, 52], [16, 53], [16, 54], [16, 55], [16, 56]];
var ROCK_FOLIAGE = [[17, 51], [18, 51], [19, 51], [20, 51]];
var ROCK_DENSE = [[18, 53], [19, 53], [18, 54], [19, 54], [18, 55], [19, 55]];
var ROCK_SPARSE = [
  [17, 52],
  [18, 52],
  [19, 52],
  [20, 52],
  [17, 53],
  [20, 53],
  [17, 54],
  [20, 54],
  [17, 55],
  [20, 55],
  [17, 56],
  [18, 56],
  [19, 56],
  [20, 56]
];
var ROCK_STONE_RATE = 28;
var ROCK_FOLIAGE_RATE = 12;
var COL_DIRT3 = [150, 128, 95];
var COL_DDIRT = [106, 90, 79];
var COL_GRASS3 = [96, 132, 58];
function chunkFields3(seed, x0, y0) {
  const M = 6, SZ = CHUNK3 + 2 * M;
  const dd = cleanField((lx, ly) => isDarkerDirt(seed, x0 + lx, y0 + ly), M, SZ);
  const grRaw = cleanField((lx, ly) => isGrass(seed, x0 + lx, y0 + ly), M, SZ);
  const gr = new Uint8Array(grRaw.length);
  for (let k = 0; k < gr.length; k++) gr[k] = grRaw[k] && !dd[k] ? 1 : 0;
  const rockRaw = cleanField((lx, ly) => isRock(seed, x0 + lx, y0 + ly), M, SZ);
  const rock = new Uint8Array(rockRaw.length);
  for (let k = 0; k < rock.length; k++) rock[k] = rockRaw[k] && !dd[k] && !gr[k] ? 1 : 0;
  return { dd, gr, rock, M, SZ, x0, y0 };
}
var ORC_GROUND_FILLS = [
  { key: "dirt", url: TILES3, tile: DIRT_BASE2 },
  { key: "ddirt", url: TILES3, tile: DDIRT.fill },
  { key: "grass", url: TILES3, tile: GRASS.fill }
];
function orcGroundFillKey(seed, x, y) {
  if (isDarkerDirt(seed, x, y)) return "ddirt";
  if (isGrass(seed, x, y)) return "grass";
  return "dirt";
}
var orcConfig = (seed) => ({
  seed,
  tile: TILE5,
  chunk: CHUNK3,
  background: "#69636f",
  async load({ Assets }) {
    const t = await Assets.load(TILES3);
    t.source.scaleMode = "nearest";
    return { tiles: t.source };
  },
  // `accept(tx,ty)` (chunk-local) gates which tiles this biome paints — defaults to all, so the
  // standalone map is unchanged; the multi-biome overworld passes a per-biome dither mask.
  bake({ x0, y0, seed: seed2, ctx, add, accept = () => true }) {
    const f = chunkFields3(seed2, x0, y0);
    const { dd, gr, rock, M, SZ } = f;
    const idx = (i, j) => j * SZ + i;
    const at = (fld, lx, ly) => fld[idx(lx + M, ly + M)] === 1;
    const atRock = (lx, ly) => rock[idx(lx + M, ly + M)] === 1;
    const place = (coord, tx, ty) => add(ctx.tiles, coord[0], coord[1], tx, ty);
    const drawLayer = (field, set, tx, ty) => {
      if (!at(field, tx, ty)) return;
      const N = !at(field, tx, ty - 1), E = !at(field, tx + 1, ty), S = !at(field, tx, ty + 1), W = !at(field, tx - 1, ty);
      const NW = !at(field, tx - 1, ty - 1), NE = !at(field, tx + 1, ty - 1), SW = !at(field, tx - 1, ty + 1), SE = !at(field, tx + 1, ty + 1);
      const t = autotile(set, N, E, S, W, NW, NE, SW, SE);
      place(t || sparse(set.fill, set.vars, x0 + tx, y0 + ty, set === GRASS ? 1 : 2, OVERLAY_RATE, seed2), tx, ty);
    };
    for (let ty = 0; ty < CHUNK3; ty++) {
      for (let tx = 0; tx < CHUNK3; tx++) {
        if (!accept(tx, ty)) continue;
        place(sparse(DIRT_BASE2, DIRT_VARS3, x0 + tx, y0 + ty, 0, DIRT_RATE, seed2), tx, ty);
        drawLayer(dd, DDIRT, tx, ty);
        drawLayer(gr, GRASS, tx, ty);
        if (atRock(tx, ty)) {
          const h = rhash(x0 + tx, y0 + ty, 3, seed2);
          const interior = atRock(tx, ty - 1) && atRock(tx + 1, ty) && atRock(tx, ty + 1) && atRock(tx - 1, ty);
          const pool = interior ? ROCK_DENSE : ROCK_SPARSE;
          place(offset(pool[(h >>> 2) % pool.length], ROCK_COLOR_OFF[h % 3]), tx, ty);
        } else if (!at(dd, tx, ty) && !at(gr, tx, ty)) {
          const h = rhash(x0 + tx, y0 + ty, 7, seed2);
          if (h % ROCK_STONE_RATE === 0) place(offset(STONE_SIZES[(h >>> 3) % STONE_SIZES.length], ROCK_COLOR_OFF[(h >>> 6) % 3]), tx, ty);
          else if ((h >>> 8) % ROCK_FOLIAGE_RATE === 0) place(offset(ROCK_FOLIAGE[(h >>> 11) % ROCK_FOLIAGE.length], ROCK_COLOR_OFF[(h >>> 14) % 3]), tx, ty);
        }
      }
    }
    return { meta: f };
  },
  macroColor(seed2, tx, ty) {
    if (isDarkerDirt(seed2, tx, ty)) return COL_DDIRT;
    if (isGrass(seed2, tx, ty)) return COL_GRASS3;
    return COL_DIRT3;
  },
  // Top-most ground tile [c,r] at world (wx,wy) for the grid overlay (rocks omitted).
  tileIndexAt(wx, wy, meta) {
    if (!meta) return null;
    const { dd, gr, M, SZ, x0, y0 } = meta;
    const lx = wx - x0, ly = wy - y0;
    if (lx < 0 || ly < 0 || lx >= CHUNK3 || ly >= CHUNK3) return null;
    const at = (f, x, y) => f[(y + M) * SZ + (x + M)] === 1;
    for (const [field, set] of [[gr, GRASS], [dd, DDIRT]]) {
      if (!at(field, lx, ly)) continue;
      const N = !at(field, lx, ly - 1), E = !at(field, lx + 1, ly), S = !at(field, lx, ly + 1), W = !at(field, lx - 1, ly);
      const NW = !at(field, lx - 1, ly - 1), NE = !at(field, lx + 1, ly - 1), SW = !at(field, lx - 1, ly + 1), SE = !at(field, lx + 1, ly + 1);
      return autotile(set, N, E, S, W, NW, NE, SW, SE) || set.fill;
    }
    return DIRT_BASE2;
  }
});

// ../auto-battler/src/render/necropolis.js
var NECRO2 = "/assets/minifantasy/Minifantasy_Necropolis_v1.0/Minifantasy_Necropolis_Assets";
var EXT_DIR = `${NECRO2}/PremadeScenes/Exterior/SeparateLayers`;
var BIOME = `${NECRO2}/Tileset/Biome/CorruptedBiome.png`;
var SHADOW2 = `${NECRO2}/Tileset/Biome/CorruptedBiomeShadows.png`;
var PROPS3 = `${NECRO2}/Props/Props.png`;
var PROP_SHADOW3 = `${NECRO2}/Props/PropShadows.png`;
var NECRO_MAP_ASSETS = [BIOME, SHADOW2, PROPS3, PROP_SHADOW3];
var TILE6 = 8;
var CHUNK4 = 32;
var TREES2 = [
  { frame: [9, 15, 14, 14], shadow: [8, 24, 3, 5], ax: 0.04, ay: 0.82 },
  // 1,1 (2×3)
  { frame: [28, 11, 17, 19], shadow: [25, 24, 6, 6], ax: 0, ay: 0.84 },
  // 3,1 (3×3)
  { frame: [51, 13, 18, 16], shadow: [55, 24, 7, 5], ax: 0.42, ay: 0.84 },
  // 6,1 (3×3)
  { frame: [75, 14, 10, 15], shadow: [72, 25, 7, 4], ax: 0.05, ay: 0.87 }
  // 9,1 (2×3)
];
var TREE_SCALE_BASE2 = 1;
var TREE_SCALE_JITTER2 = 0.15;
var TREE_FLIP_RATE2 = 0.5;
var TREE_JITTER2 = 2;
var FOREST_BLOCK_X2 = 2;
var FOREST_BLOCK_Y2 = 1;
var FOREST_THRESHOLD2 = 0.62;
var FOREST_MIN_NB2 = 2;
var FOREST_FILL2 = 0.55;
var TREE_WATER_BUFFER = 1;
var FOLIAGE2 = [
  { tiles: [[1, 5], [2, 5], [1, 6], [2, 6]], shadow: false, weight: 3 },
  // grass tufts (most common)
  { tiles: [[6, 5], [7, 5], [6, 6], [7, 6]], shadow: true, weight: 1 },
  // species A
  { tiles: [[9, 5], [10, 5], [9, 6], [10, 6]], shadow: true, weight: 1 }
  // species B
];
var FOLIAGE_WEIGHT2 = FOLIAGE2.reduce((s, g) => s + g.weight, 0);
var FOLIAGE_RATE2 = 12;
var LIP_T = [2, 10];
var LIP_T_VAR = [[3, 10], [4, 10], [5, 10]];
var LIP_TL = [1, 10];
var LIP_TR = [6, 10];
var WALL_L = [1, 14];
var WALL_L_VAR = [[1, 11], [1, 12], [1, 13]];
var WALL_R = [6, 14];
var WALL_R_VAR = [[6, 11], [6, 12], [6, 13]];
var LIP_S = [2, 15];
var LIP_S_VAR = [[3, 15], [4, 15], [5, 15]];
var LIP_SW = [1, 15];
var LIP_SE = [6, 15];
var FACE_H = 2;
var FACE = [[3, 16], [3, 17]];
var FACE_VAR = [[[2, 16], [4, 16], [5, 16]], [[2, 17], [4, 17], [5, 17]]];
var FACE_L = [[1, 16], [1, 17]];
var FACE_R = [[6, 16], [6, 17]];
var CLIFF_SPARSE_RATE = 2;
var NECRO_CLIFF = {
  LIP_T,
  LIP_T_VAR,
  LIP_TL,
  LIP_TR,
  WALL_L,
  WALL_L_VAR,
  WALL_R,
  WALL_R_VAR,
  LIP_S,
  LIP_S_VAR,
  LIP_SW,
  LIP_SE,
  FACE_H,
  FACE,
  FACE_VAR,
  FACE_L,
  FACE_R,
  RATE: CLIFF_SPARSE_RATE
};
var CORRUPT_LIGHT = [1, 1];
var CORRUPT_DARK = [2, 1];
var NECRO_GROUND_FILLS = [
  { key: "light", url: BIOME, tile: CORRUPT_LIGHT },
  { key: "dark", url: BIOME, tile: CORRUPT_DARK }
];
function necroGroundFillKey(seed, x, y) {
  return isDark(seed, x, y) ? "dark" : "light";
}
var LIGHT_VARIANTS = [[1, 2], [2, 2], [1, 3], [2, 3], [1, 4], [2, 4], [1, 5], [2, 5]];
var LIGHT_SPARSE_RATE = 10;
var WATER_BLOCK3 = [4, 2];
var BONE_BLOCK = [13, 2];
var BONE_FILL = [[12, 1], [13, 1], [14, 1], [15, 1]];
var EDGE_N = [18, 4];
var EDGE_S = [18, 2];
var EDGE_E = [17, 3];
var EDGE_W = [19, 3];
var CONV_NW = [18, 6];
var CONV_NE = [17, 6];
var CONV_SW = [18, 5];
var CONV_SE = [17, 5];
var CONC_NW = [19, 4];
var CONC_NE = [17, 4];
var CONC_SW = [19, 2];
var CONC_SE = [17, 2];
var CONC_NWSE = [19, 6];
var CONC_NESW = [19, 5];
var COL_LIGHT = [130, 119, 136];
var COL_DARK = [105, 99, 113];
var COL_WATER3 = [74, 142, 48];
var COL_BONE = [180, 156, 126];
var COL_CLIFF3 = [175, 146, 109];
var COL_FOREST = [96, 101, 70];
function corruptTile(N, E, S, W, NW, NE, SW, SE) {
  const card = (N ? 1 : 0) + (E ? 1 : 0) + (S ? 1 : 0) + (W ? 1 : 0);
  if (card === 1) return N ? EDGE_N : S ? EDGE_S : E ? EDGE_E : EDGE_W;
  if (card === 2) {
    if (N && W) return CONV_NW;
    if (N && E) return CONV_NE;
    if (S && W) return CONV_SW;
    if (S && E) return CONV_SE;
    return N ? EDGE_N : EDGE_E;
  }
  if (card >= 3) return N ? EDGE_N : S ? EDGE_S : E ? EDGE_E : EDGE_W;
  const diag = (NW ? 1 : 0) + (NE ? 1 : 0) + (SW ? 1 : 0) + (SE ? 1 : 0);
  if (diag === 0) return null;
  if (diag === 1) return NW ? CONC_NW : NE ? CONC_NE : SW ? CONC_SW : CONC_SE;
  if (NW && SE && !NE && !SW) return CONC_NWSE;
  if (NE && SW && !NW && !SE) return CONC_NESW;
  return null;
}
function boneCenterTile([c0, r0], dNW, dNE, dSW, dSE) {
  const n = dNW + dNE + dSW + dSE;
  if (n === 1) {
    if (dNW) return [c0, r0 + 3];
    if (dNE) return [c0 + 1, r0 + 3];
    if (dSW) return [c0, r0 + 4];
    return [c0 + 1, r0 + 4];
  }
  if (dNE && dSW && !dNW && !dSE) return [c0 + 2, r0 + 4];
  if (dNW && dSE && !dNE && !dSW) return [c0 + 2, r0 + 3];
  return [c0 + 1, r0 + 1];
}
function biomeColor(seed, tx, ty) {
  const raised = isRaised2(seed, tx, ty);
  if (!raised && isRiver2(seed, tx, ty)) return COL_WATER3;
  if (isBone(seed, tx, ty)) return COL_BONE;
  let c = isDark(seed, tx, ty) ? COL_DARK : COL_LIGHT;
  if (forestField2(seed, tx, ty) > FOREST_THRESHOLD2) c = lerp3(c, COL_FOREST, 0.5);
  if (raised) c = lerp3(c, COL_CLIFF3, 0.22);
  return c;
}
function loadImg3(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
async function buildShadowMask2(url) {
  const img = await loadImg3(url);
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const cols = img.naturalWidth / TILE6 | 0, rows = img.naturalHeight / TILE6 | 0, set = /* @__PURE__ */ new Set();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const d = g.getImageData(c * TILE6, r * TILE6, TILE6, TILE6).data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 8) {
        set.add(c + "," + r);
        break;
      }
    }
  }
  return set;
}
function chunkFields4(seed, x0, y0) {
  const WATER_BUFFER = 2;
  const ELEV_BUFFER = 3;
  const M = Math.max(WATER_BUFFER, ELEV_BUFFER) + 4, SZ = CHUNK4 + 2 * M;
  const idx = (i, j) => j * SZ + i;
  const clean = (pred) => {
    let cur = new Uint8Array(SZ * SZ);
    for (let j = 0; j < SZ; j++) for (let i = 0; i < SZ; i++) cur[idx(i, j)] = pred(x0 + i - M, y0 + j - M) ? 1 : 0;
    let nxt = new Uint8Array(SZ * SZ);
    for (let j = 1; j < SZ - 1; j++) for (let i = 1; i < SZ - 1; i++) {
      let c = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) c += cur[idx(i + di, j + dj)];
      nxt[idx(i, j)] = c >= 5 ? 1 : 0;
    }
    cur = nxt;
    for (let p = 0; p < 2; p++) {
      nxt = new Uint8Array(SZ * SZ);
      for (let j = 1; j < SZ - 1; j++) for (let i = 1; i < SZ - 1; i++) {
        const card = cur[idx(i, j - 1)] + cur[idx(i + 1, j)] + cur[idx(i, j + 1)] + cur[idx(i - 1, j)];
        nxt[idx(i, j)] = cur[idx(i, j)] ? card >= 2 ? 1 : 0 : card >= 3 ? 1 : 0;
      }
      cur = nxt;
    }
    return cur;
  };
  const darkRaw = clean((x, y) => isDark(seed, x, y));
  const waterField = clean((x, y) => isRiver2(seed, x, y));
  const raisedField = clean((x, y) => isRaised2(seed, x, y));
  const boneField = clean((x, y) => isBone(seed, x, y));
  const fraw = new Uint8Array(SZ * SZ);
  for (let j = 0; j < SZ; j++) for (let i = 0; i < SZ; i++) fraw[idx(i, j)] = forestField2(seed, x0 + i - M, y0 + j - M) > FOREST_THRESHOLD2 ? 1 : 0;
  const forestRegion = new Uint8Array(SZ * SZ);
  for (let j = 1; j < SZ - 1; j++) for (let i = 1; i < SZ - 1; i++) {
    if (!fraw[idx(i, j)]) continue;
    let c = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && fraw[idx(i + di, j + dj)]) c++;
    forestRegion[idx(i, j)] = c >= FOREST_MIN_NB2 ? 1 : 0;
  }
  const field = new Uint8Array(SZ * SZ);
  const boneMask = new Uint8Array(SZ * SZ);
  const B = Math.max(WATER_BUFFER, ELEV_BUFFER);
  for (let j = B; j < SZ - B; j++) for (let i = B; i < SZ - B; i++) {
    let nearW = 0;
    for (let dj = -WATER_BUFFER; dj <= WATER_BUFFER && !nearW; dj++) for (let di = -WATER_BUFFER; di <= WATER_BUFFER; di++) if (waterField[idx(i + di, j + dj)]) {
      nearW = 1;
      break;
    }
    let nearCliff = 0;
    {
      const me = raisedField[idx(i, j)];
      for (let dj = -ELEV_BUFFER; dj <= ELEV_BUFFER && !nearCliff; dj++) for (let di = -ELEV_BUFFER; di <= ELEV_BUFFER; di++) if (raisedField[idx(i + di, j + dj)] !== me) {
        nearCliff = 1;
        break;
      }
    }
    const water = waterField[idx(i, j)];
    field[idx(i, j)] = darkRaw[idx(i, j)] && !nearW && !water && !nearCliff ? 0 : 1;
    boneMask[idx(i, j)] = boneField[idx(i, j)] && !water && !nearW && !nearCliff ? 1 : 0;
  }
  for (let pass = 0; pass < 3; pass++) {
    const prev = boneMask.slice();
    let changed = false;
    for (let j = B + 1; j < SZ - B - 1; j++) for (let i = B + 1; i < SZ - B - 1; i++) {
      if (!prev[idx(i, j)]) continue;
      const up = prev[idx(i, j - 1)], down = prev[idx(i, j + 1)], left = prev[idx(i - 1, j)], right = prev[idx(i + 1, j)];
      if (!up && !down || !left && !right) {
        boneMask[idx(i, j)] = 0;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { field, boneMask, waterField, raisedField, forestRegion, M, SZ, x0, y0 };
}
var necropolisConfig = (seed, opts = {}) => ({
  seed,
  tile: TILE6,
  chunk: CHUNK4,
  background: "#69636f",
  async load({ Assets }) {
    const ctx = { biome: null, shadow: null, shadowSet: null, props: null, propShadow: null };
    const b = await Assets.load(BIOME);
    b.source.scaleMode = "nearest";
    ctx.biome = b.source;
    try {
      const s = await Assets.load(SHADOW2);
      s.source.scaleMode = "nearest";
      ctx.shadow = s.source;
    } catch {
    }
    try {
      ctx.shadowSet = await buildShadowMask2(SHADOW2);
    } catch {
      ctx.shadowSet = null;
    }
    if (opts.props !== false) {
      try {
        const p = await Assets.load(PROPS3);
        p.source.scaleMode = "nearest";
        ctx.props = p.source;
      } catch {
      }
      try {
        const p = await Assets.load(PROP_SHADOW3);
        p.source.scaleMode = "nearest";
        ctx.propShadow = p.source;
      } catch {
      }
    }
    return ctx;
  },
  // `accept(tx,ty)` (chunk-local) gates which tiles this biome paints — defaults to all, so the
  // standalone map is unchanged; the multi-biome overworld passes a per-biome dither mask.
  bake({ x0, y0, seed: seed2, ctx, tmp, Sprite, tex, texFrame, add, accept = () => true }) {
    const f = chunkFields4(seed2, x0, y0);
    const { field, boneMask, waterField, raisedField, forestRegion, M, SZ } = f;
    const idx = (i, j) => j * SZ + i;
    const isLight = (wx, wy) => field[idx(wx - x0 + M, wy - y0 + M)] === 1;
    const isRaisedAt = (wx, wy) => raisedField[idx(wx - x0 + M, wy - y0 + M)] === 1;
    const isWater = (wx, wy) => waterField[idx(wx - x0 + M, wy - y0 + M)] === 1 && !isRaisedAt(wx, wy);
    const boneAt = (wx, wy) => boneMask[idx(wx - x0 + M, wy - y0 + M)] === 1;
    const place = (coord, tx, ty) => {
      add(ctx.biome, coord[0], coord[1], tx, ty);
      if (ctx.shadow && (!ctx.shadowSet || ctx.shadowSet.has(coord[0] + "," + coord[1]))) {
        const sh = new Sprite(tex(ctx.shadow, coord[0], coord[1]));
        sh.x = tx * TILE6;
        sh.y = ty * TILE6;
        tmp.addChild(sh);
      }
    };
    for (let ty = 0; ty < CHUNK4; ty++) for (let tx = 0; tx < CHUNK4; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      if (!isLight(wx, wy)) {
        place(CORRUPT_DARK, tx, ty);
        continue;
      }
      const N = !isLight(wx, wy - 1), E = !isLight(wx + 1, wy), S = !isLight(wx, wy + 1), Wf = !isLight(wx - 1, wy);
      const NW = !isLight(wx - 1, wy - 1), NE = !isLight(wx + 1, wy - 1), SW = !isLight(wx - 1, wy + 1), SE = !isLight(wx + 1, wy + 1);
      const t = corruptTile(N, E, S, Wf, NW, NE, SW, SE);
      if (!t) {
        place(sparse(CORRUPT_LIGHT, LIGHT_VARIANTS, wx, wy, 0, LIGHT_SPARSE_RATE, seed2), tx, ty);
        continue;
      }
      place(CORRUPT_DARK, tx, ty);
      place(t, tx, ty);
    }
    for (let ty = 0; ty < CHUNK4; ty++) for (let tx = 0; tx < CHUNK4; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      if (!isWater(wx, wy)) continue;
      const N = !isWater(wx, wy - 1), E = !isWater(wx + 1, wy), S = !isWater(wx, wy + 1), Wf = !isWater(wx - 1, wy);
      if (N && E && S && Wf) continue;
      let cr;
      if (!N && !E && !S && !Wf) cr = centerTile(WATER_BLOCK3, !isWater(wx - 1, wy - 1), !isWater(wx + 1, wy - 1), !isWater(wx - 1, wy + 1), !isWater(wx + 1, wy + 1));
      else cr = blockTile(WATER_BLOCK3, N, E, S, Wf);
      place(cr, tx, ty);
    }
    for (let ty = 0; ty < CHUNK4; ty++) for (let tx = 0; tx < CHUNK4; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      if (!boneAt(wx, wy)) continue;
      const N = !boneAt(wx, wy - 1), E = !boneAt(wx + 1, wy), S = !boneAt(wx, wy + 1), Wf = !boneAt(wx - 1, wy);
      if (N && E && S && Wf) {
        place(sparse(BONE_FILL[0], BONE_FILL, wx, wy, 11, 1, seed2), tx, ty);
        continue;
      }
      let cr;
      if (!N && !E && !S && !Wf) {
        const dNW = !boneAt(wx - 1, wy - 1), dNE = !boneAt(wx + 1, wy - 1), dSW = !boneAt(wx - 1, wy + 1), dSE = !boneAt(wx + 1, wy + 1);
        if (dNW || dNE || dSW || dSE) cr = boneCenterTile(BONE_BLOCK, dNW, dNE, dSW, dSE);
        else {
          place(sparse(BONE_FILL[0], BONE_FILL, wx, wy, 11, 1, seed2), tx, ty);
          continue;
        }
      } else cr = blockTile(BONE_BLOCK, N, E, S, Wf);
      place(cr, tx, ty);
    }
    if (ctx.props) for (let ty = 0; ty < CHUNK4; ty++) for (let tx = 0; tx < CHUNK4; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      if (isWater(wx, wy) || boneAt(wx, wy)) continue;
      const h = hashU32(seed2 ^ 15733114, wx, wy);
      if (h % FOLIAGE_RATE2 !== 0) continue;
      let pick = (h >>> 8) % FOLIAGE_WEIGHT2, g = FOLIAGE2[0];
      for (const grp of FOLIAGE2) {
        if (pick < grp.weight) {
          g = grp;
          break;
        }
        pick -= grp.weight;
      }
      const [c, r] = g.tiles[(h >>> 16) % g.tiles.length];
      if (g.shadow && ctx.propShadow) {
        const sh = new Sprite(texFrame(ctx.propShadow, c * TILE6, r * TILE6, TILE6, TILE6));
        sh.x = tx * TILE6;
        sh.y = ty * TILE6;
        tmp.addChild(sh);
      }
      const sp = new Sprite(texFrame(ctx.props, c * TILE6, r * TILE6, TILE6, TILE6));
      sp.x = tx * TILE6;
      sp.y = ty * TILE6;
      tmp.addChild(sp);
    }
    bakeCliffs(NECRO_CLIFF, { chunk: CHUNK4, x0, y0, seed: seed2, raised: isRaisedAt, place, accept });
    const live = [];
    if (ctx.props) {
      const nearWater = (wx, wy) => {
        for (let dj = -TREE_WATER_BUFFER; dj <= TREE_WATER_BUFFER; dj++) for (let di = -TREE_WATER_BUFFER; di <= TREE_WATER_BUFFER; di++) if (waterField[idx(wx + di - x0 + M, wy + dj - y0 + M)]) return true;
        return false;
      };
      const nearCliff = (wx, wy) => {
        const me = isRaisedAt(wx, wy);
        for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) if (isRaisedAt(wx + di, wy + dj) !== me) return true;
        return false;
      };
      const bx0 = Math.floor(x0 / FOREST_BLOCK_X2), bx1 = Math.floor((x0 + CHUNK4 - 1) / FOREST_BLOCK_X2);
      const by0 = Math.floor(y0 / FOREST_BLOCK_Y2), by1 = Math.floor((y0 + CHUNK4 - 1) / FOREST_BLOCK_Y2);
      for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
        const h = hashU32(seed2 ^ 15748695, bx, by);
        const wx = bx * FOREST_BLOCK_X2 + h % FOREST_BLOCK_X2, wy = by * FOREST_BLOCK_Y2 + (h >>> 4) % FOREST_BLOCK_Y2;
        if (wx < x0 || wx >= x0 + CHUNK4 || wy < y0 || wy >= y0 + CHUNK4) continue;
        if (!accept(wx - x0, wy - y0)) continue;
        if (forestRegion[idx(wx - x0 + M, wy - y0 + M)] !== 1) continue;
        if ((h >>> 8 & 65535) / 65536 >= FOREST_FILL2) continue;
        if (nearWater(wx, wy) || boneAt(wx, wy) || nearCliff(wx, wy)) continue;
        const T = TREES2[(h >>> 24) % TREES2.length];
        const flip = (h >>> 20 & 255) / 256 < TREE_FLIP_RATE2;
        const sc = TREE_SCALE_BASE2 * (1 + ((h >>> 12 & 255) / 256 - 0.5) * 2 * TREE_SCALE_JITTER2);
        const px = wx * TILE6 + TILE6 / 2 + ((h >>> 16 & 15) / 16 - 0.5) * 2 * TREE_JITTER2;
        const py = wy * TILE6 + TILE6 / 2 + ((h >>> 28 & 15) / 16 - 0.5) * 2 * TREE_JITTER2;
        const tr = new Sprite(texFrame(ctx.props, ...T.frame));
        tr.anchor.set(T.ax, T.ay);
        tr.scale.set(flip ? -sc : sc, sc);
        tr.x = px;
        tr.y = py;
        tr.zIndex = py;
        let shadow = null;
        if (ctx.propShadow) {
          shadow = new Sprite(texFrame(ctx.propShadow, ...T.shadow));
          shadow.anchor.set(0.5, 0.5);
          shadow.scale.set(sc, sc);
          shadow.x = px;
          shadow.y = py;
        }
        live.push({ sprite: tr, shadow });
      }
    }
    return { meta: f, live };
  },
  macroColor: biomeColor,
  // The ground tile [c,r] the renderer placed at world (wx,wy) — for the debug grid overlay.
  tileIndexAt(wx, wy, meta) {
    if (!meta) return null;
    const { field, M, SZ, x0, y0 } = meta;
    const fl = (x, y) => field[(y - y0 + M) * SZ + (x - x0 + M)] === 1;
    if (wx - x0 < 0 || wy - y0 < 0 || wx - x0 >= CHUNK4 || wy - y0 >= CHUNK4) return null;
    if (!fl(wx, wy)) return CORRUPT_DARK;
    const t = corruptTile(
      !fl(wx, wy - 1),
      !fl(wx + 1, wy),
      !fl(wx, wy + 1),
      !fl(wx - 1, wy),
      !fl(wx - 1, wy - 1),
      !fl(wx + 1, wy - 1),
      !fl(wx - 1, wy + 1),
      !fl(wx + 1, wy + 1)
    );
    return t || CORRUPT_LIGHT;
  }
});

// ../auto-battler/src/render/gameWorld.js
var TILE7 = 8;
var CHUNK5 = 32;
var GW_W = 720;
var GW_H = 480;
var GW_BANDS = ["forgottenPlains", "desolateDesert", "orc", "necropolis"];
var GW_CUTS = [0.5, 1, 1.5];
var GW_FACTORIES = { forgottenPlains: fpConfig, desolateDesert: desolateDesertConfig, orc: orcConfig, necropolis: necropolisConfig };
var GW_GROUNDS = {
  forgottenPlains: { fills: FP_GROUND_FILLS, fillKey: fpGroundFillKey },
  desolateDesert: { fills: DD_GROUND_FILLS, fillKey: ddGroundFillKey },
  orc: { fills: ORC_GROUND_FILLS, fillKey: orcGroundFillKey },
  necropolis: { fills: NECRO_GROUND_FILLS, fillKey: necroGroundFillKey }
};
var GW_TINT = { forgottenPlains: [97, 150, 55], desolateDesert: [216, 146, 60], orc: [150, 128, 95], necropolis: [120, 110, 128] };
var MACRO_BLEND = 0.06;
var TINT_MIX = 0.55;
var RANK = {};
GW_BANDS.forEach((id, i) => {
  RANK[id] = i;
});
var { regionAt, biomeAt } = makeRegions(GW_W, GW_H, GW_BANDS, GW_CUTS);
var GW_ASSETS = [.../* @__PURE__ */ new Set([...FP_MAP_ASSETS, ...DD_MAP_ASSETS, ...ORC_MAP_ASSETS, ...NECRO_MAP_ASSETS, ...cityKindAssets(Object.keys(CITY_KINDS))])];
var COL_ROAD = [150, 116, 78];
var COL_PLAZA = [150, 116, 78];
var STREET_HALF = 2;
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
var COST_DIRT = 1;
var COST_OPEN = 4;
var COST_BLOCK = 4e3;
var COST_HOUSE = 6e4;
var DIRT_KEYS = /* @__PURE__ */ new Set(["dirt", "ddirt", "crack", "dark"]);
function blockedTerrain(seed, x, y, id) {
  if (id === "orc") return false;
  if (id === "necropolis") return isRiver2(seed, x, y) || isRaised2(seed, x, y);
  return isRiver(seed, x, y) || isRaised(seed, x, y);
}
function buildSkeleton(seed) {
  const START = { x: 56, y: GW_H - 56, r: 11, kind: "start" };
  const EXIT = { x: GW_W - 56, y: 56, r: 8, kind: "exit" };
  const sites = [];
  const N = 5;
  for (let i = 1; i <= N; i++) {
    const t = i / (N + 1);
    const bx = START.x + (EXIT.x - START.x) * t, by = START.y + (EXIT.y - START.y) * t;
    const h = hashU32(seed ^ 5340759, i, 7);
    const jx = (h % 2e3 / 2e3 - 0.5) * 300, jy = ((h >>> 11) % 2e3 / 2e3 - 0.5) * 300;
    sites.push({ x: clamp(bx + jx, 40, GW_W - 40), y: clamp(by + jy, 40, GW_H - 40), r: 7, kind: h >>> 22 & 1 ? "fortress" : "town" });
  }
  const nodes = [START, ...sites, EXIT];
  const wk = (ax, ay) => ax >= 0 && ay >= 0 && ax < GW_W && ay < GW_H && !blockedTerrain(seed, ax, ay, regionAt(seed, ax, ay).id);
  for (const n of nodes) {
    const s = nearestWalkable(wk, Math.round(n.x), Math.round(n.y), 40);
    n.x = s.x;
    n.y = s.y;
  }
  const prog = (n) => n.x / GW_W + (GW_H - n.y) / GW_H;
  const ordered = [...nodes].sort((a, b) => prog(a) - prog(b));
  const segs = [], seen = /* @__PURE__ */ new Set();
  const key = (a, b) => {
    const ia = nodes.indexOf(a), ib = nodes.indexOf(b);
    return ia < ib ? ia + "-" + ib : ib + "-" + ia;
  };
  const addSeg = (a, b) => {
    if (a !== b) {
      const k = key(a, b);
      if (!seen.has(k)) {
        seen.add(k);
        segs.push([a, b]);
      }
    }
  };
  for (let i = 0; i < ordered.length - 1; i++) addSeg(ordered[i], ordered[i + 1]);
  for (let i = 0; i < ordered.length - 2; i++) if (hashU32(seed ^ 35404, i, 3) % 2 === 0) addSeg(ordered[i], ordered[i + 2]);
  for (const n of sites) {
    const cand = nodes.filter((m) => m !== n).sort((a, b) => Math.hypot(a.x - n.x, a.y - n.y) - Math.hypot(b.x - n.x, b.y - n.y));
    if (hashU32(seed ^ 13233, nodes.indexOf(n), 1) % 2 === 0) addSeg(n, cand[1] || cand[0]);
  }
  return { nodes, segs, START, EXIT, sites };
}
var skelCache = { seed: null, skel: null };
var getSkeleton = (seed) => skelCache.seed === seed ? skelCache.skel : (skelCache = { seed, skel: buildSkeleton(seed) }).skel;
var nodeAt = (skel, x, y) => {
  let bd = Infinity, bn = null;
  for (const n of skel.nodes) {
    const d = Math.hypot(x - n.x, y - n.y);
    if (d < bd) {
      bd = d;
      bn = n;
    }
  }
  return { d: bd, n: bn };
};
function buildCostGrid(seed) {
  const grid = new Uint16Array(GW_W * GW_H);
  for (let y = 0; y < GW_H; y++) for (let x = 0; x < GW_W; x++) {
    const id = regionAt(seed, x, y).id;
    grid[y * GW_W + x] = blockedTerrain(seed, x, y, id) ? COST_BLOCK : DIRT_KEYS.has(GW_GROUNDS[id].fillKey(seed, x, y)) ? COST_DIRT : COST_OPEN;
  }
  for (const v of getVillages(seed, getSkeleton(seed))) for (const ho of v.houses) {
    for (let yy = ho.by - 1; yy <= ho.by; yy++) for (let xx = ho.bx; xx < ho.bx + ho.plan.w; xx++) {
      if (xx >= 0 && yy >= 0 && xx < GW_W && yy < GW_H) grid[yy * GW_W + xx] = COST_HOUSE;
    }
  }
  return grid;
}
var costCache = { seed: null, grid: null };
var getCostGrid = (seed) => costCache.seed === seed ? costCache.grid : (costCache = { seed, grid: buildCostGrid(seed) }).grid;
function buildRoads(seed) {
  const skel = getSkeleton(seed), cost = getCostGrid(seed);
  const nodeCells = skel.nodes.map((n) => Math.round(n.y) * GW_W + Math.round(n.x));
  const edges = skel.segs.map(([a, b]) => [skel.nodes.indexOf(a), skel.nodes.indexOf(b)]);
  return buildRoadNet(cost, GW_W, GW_H, nodeCells, edges);
}
var roadCache = { seed: null, net: null };
var getRoadNet = (seed) => roadCache.seed === seed ? roadCache.net : (roadCache = { seed, net: buildRoads(seed) }).net;
var villageClearing = (seed, villages, wx, wy) => {
  for (const v of villages) {
    const j = hashU32(seed ^ 961, wx, wy) % 7 - 3;
    if (Math.hypot(wx - v.cx, wy - v.cy) < v.R + j) return true;
  }
  return false;
};
function gameWorldWalkable(seed) {
  const roadNet = getRoadNet(seed), houseBlocked = gameWorldBlockedAt(seed);
  const villages = getVillages(seed, getSkeleton(seed));
  return (wx, wy) => {
    if (roadNet.has(wx, wy)) return true;
    if (houseBlocked(wx, wy)) return false;
    if (villageClearing(seed, villages, wx, wy)) return true;
    const id = regionAt(seed, wx, wy).id;
    if (id === "orc") return true;
    return !(id === "necropolis" ? isRiver2 : isRiver)(seed, wx, wy);
  };
}
function gameWorldPath(seed) {
  const walk = gameWorldWalkable(seed);
  return (sx, sy, gx, gy, cap) => {
    if (sx < 0 || sy < 0 || sx >= GW_W || sy >= GW_H || gx < 0 || gy < 0 || gx >= GW_W || gy >= GW_H) return null;
    if (!walk(gx, gy)) return null;
    const path = aStarWalk(walk, GW_W, GW_H, sy * GW_W + sx, gy * GW_W + gx, cap ?? 2e4);
    return path ? path.map((i) => [i % GW_W, i / GW_W | 0]) : null;
  };
}
function gameWorldSpawn(seed) {
  const skel = getSkeleton(seed);
  const v = getVillages(seed, skel)[0];
  const n = v ? { x: v.cx, y: v.cy } : skel.START;
  return { x: (n.x + 0.5) * TILE7, y: (n.y + 0.5) * TILE7 };
}
var cityKindFor = (seed, site) => "medieval";
function buildVillages(seed, skel) {
  const villages = [];
  for (const site of skel.sites) {
    if (site.kind !== "town") continue;
    const kind = cityKindFor(seed, site);
    const def = CITY_KINDS[kind];
    if (!def) continue;
    villages.push({ kind, def, ...def.planVillage(seed, site) });
  }
  return villages;
}
var villageCache = { seed: null, villages: null };
var getVillages = (seed, skel) => villageCache.seed === seed ? villageCache.villages : (villageCache = { seed, villages: buildVillages(seed, skel) }).villages;
function gameWorldBlockedAt(seed) {
  const villages = getVillages(seed, getSkeleton(seed));
  return (wx, wy) => {
    for (const v of villages) if (v.blockedAt(wx, wy)) return true;
    return false;
  };
}
function dominantForeign(at, tx, ty, A, rankA) {
  const tally = /* @__PURE__ */ new Map();
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const b = at(tx + dx, ty + dy);
    if (b !== A && RANK[b] < rankA) tally.set(b, (tally.get(b) || 0) + 1);
  }
  let best = null, bestN = 0;
  for (const [b, n] of tally) if (n > bestN) {
    bestN = n;
    best = b;
  }
  return best;
}
var gameWorldConfig = (seed) => {
  const richBiomes = {};
  for (const id of GW_BANDS) richBiomes[id] = GW_FACTORIES[id](seed);
  return {
    seed,
    tile: TILE7,
    chunk: CHUNK5,
    background: "#5a7b3a",
    bounds: { x0: 0, y0: 0, x1: GW_W, y1: GW_H },
    async load(api) {
      const { Assets, Texture } = api;
      const ctx = { rich: {}, flat: {} };
      for (const id of GW_BANDS) {
        ctx.rich[id] = await richBiomes[id].load(api);
        const t = await Assets.load(GAME_BIOMES[id].url);
        t.source.scaleMode = "nearest";
        ctx.flat[id] = t.source;
      }
      const grounds = { ...GW_GROUNDS }, ids = [...GW_BANDS];
      for (const id of GW_BANDS) {
        const desc = GAME_BIOMES[id], pid = biomePathId(id);
        grounds[pid] = { fills: [{ key: "path", url: desc.url, tile: (desc.path || desc.ground).base }], fillKey: () => "path" };
        ids.push(pid);
      }
      const atlas = await buildTransitionAtlas({ grounds, ids });
      const aTex = Texture.from(atlas.canvas);
      aTex.source.scaleMode = "nearest";
      ctx.trans = { source: aTex.source, tileAt: atlas.tileAt, variants: atlas.variants };
      const villages = getVillages(seed, getSkeleton(seed));
      for (const kind of new Set(villages.map((v) => v.kind))) {
        const def = CITY_KINDS[kind];
        try {
          const t = await Assets.load(def.assets[0]);
          t.source.scaleMode = "nearest";
          ctx[def.sheet] = t.source;
        } catch {
        }
      }
      return ctx;
    },
    bake(api) {
      const { x0, y0, seed: seed2, ctx, add, Container, Sprite, tex, texFrame } = api;
      const skel = getSkeleton(seed2);
      const villages = getVillages(seed2, skel);
      const trans = ctx.trans;
      const GWm = CHUNK5 + 2, widx = (lx, ly) => (ly + 1) * GWm + (lx + 1);
      const winner = new Array(GWm * GWm), pmask = new Uint8Array(GWm * GWm);
      const roadNet = getRoadNet(seed2);
      const pathRaw = (wx, wy) => {
        const na = nodeAt(skel, wx, wy);
        if (na.d < na.n.r) return true;
        if (roadNet.has(wx, wy)) return true;
        for (const v of villages) if (v.streetDist(wx, wy) < STREET_HALF) return true;
        return false;
      };
      for (let ly = -1; ly <= CHUNK5; ly++) for (let lx = -1; lx <= CHUNK5; lx++) {
        winner[widx(lx, ly)] = regionAt(seed2, x0 + lx, y0 + ly).id;
        pmask[widx(lx, ly)] = pathRaw(x0 + lx, y0 + ly) ? 1 : 0;
      }
      const at = (lx, ly) => winner[widx(lx, ly)];
      const isPath = (lx, ly) => pmask[widx(lx, ly)] === 1;
      const inClearing = (wx, wy) => villageClearing(seed2, villages, wx, wy);
      const present = /* @__PURE__ */ new Set();
      for (let ty = 0; ty < CHUNK5; ty++) for (let tx = 0; tx < CHUNK5; tx++) present.add(at(tx, ty));
      const live = [];
      for (const id of GW_BANDS) {
        if (!present.has(id)) continue;
        const accept = (tx, ty) => at(tx, ty) === id && !isPath(tx, ty) && !inClearing(x0 + tx, y0 + ty);
        const res = richBiomes[id].bake({ ...api, ctx: ctx.rich[id], accept }) || {};
        if (res.live) for (const l of res.live) live.push(l);
      }
      if (trans && present.size > 1) {
        for (let ty = 0; ty < CHUNK5; ty++) for (let tx = 0; tx < CHUNK5; tx++) {
          if (isPath(tx, ty) || inClearing(x0 + tx, y0 + ty)) continue;
          const A = at(tx, ty), rankA = RANK[A];
          const below = (lx, ly) => {
            const b = at(lx, ly);
            return b !== A && RANK[b] < rankA;
          };
          const key = boundaryCase(below(tx, ty - 1), below(tx + 1, ty), below(tx, ty + 1), below(tx - 1, ty), below(tx - 1, ty - 1), below(tx + 1, ty - 1), below(tx - 1, ty + 1), below(tx + 1, ty + 1));
          if (!key) continue;
          const B = dominantForeign(at, tx, ty, A, rankA);
          if (!B) continue;
          const wx = x0 + tx, wy = y0 + ty;
          const fgKey = GW_GROUNDS[A].fillKey(seed2, wx, wy), bgKey = GW_GROUNDS[B].fillKey(seed2, wx, wy);
          const variant = hashU32(seed2 ^ 1957, wx, wy) % trans.variants;
          const cr = trans.tileAt(A, fgKey, B, bgKey, key, variant);
          if (cr) add(trans.source, cr[0], cr[1], tx, ty);
        }
      }
      for (let ty = 0; ty < CHUNK5; ty++) for (let tx = 0; tx < CHUNK5; tx++) {
        const wx = x0 + tx, wy = y0 + ty, b = at(tx, ty), desc = GAME_BIOMES[b];
        if (isPath(tx, ty)) {
          const key = boundaryCase(!isPath(tx, ty - 1), !isPath(tx + 1, ty), !isPath(tx, ty + 1), !isPath(tx - 1, ty), !isPath(tx - 1, ty - 1), !isPath(tx + 1, ty - 1), !isPath(tx - 1, ty + 1), !isPath(tx + 1, ty + 1));
          let cr = null;
          if (key && trans) {
            const bgKey = inClearing(wx, wy) ? GW_GROUNDS[b].fills[0].key : GW_GROUNDS[b].fillKey(seed2, wx, wy);
            const variant = hashU32(seed2 ^ 1957, wx, wy) % trans.variants;
            cr = trans.tileAt(biomePathId(b), "path", b, bgKey, key, variant);
          }
          if (cr) add(trans.source, cr[0], cr[1], tx, ty);
          else {
            const ptile = biomePathTile(desc, wx, wy, seed2);
            add(ctx.flat[b], ptile[0], ptile[1], tx, ty);
          }
        } else if (inClearing(wx, wy)) {
          const g = biomeGroundTile(desc, wx, wy, seed2);
          add(ctx.flat[b], g[0], g[1], tx, ty);
        }
      }
      if (Container) for (const v of villages) {
        const src = ctx[v.def.sheet];
        if (!src) continue;
        const hapi = { Sprite, Container, tex, texFrame, source: src };
        for (const ho of v.houses) {
          const anchorX = ho.bx + (ho.plan.w >> 1);
          if (anchorX < x0 || anchorX >= x0 + CHUNK5 || ho.by < y0 || ho.by >= y0 + CHUNK5) continue;
          live.push(v.def.assemble(hapi, ho.bx, ho.by, ho.plan));
        }
      }
      return { live };
    },
    macroColor(seed2, x, y) {
      const skel = getSkeleton(seed2);
      const na = nodeAt(skel, x, y);
      if (na.d < na.n.r) return COL_PLAZA;
      if (getRoadNet(seed2).has(x, y)) return COL_ROAD;
      for (const v of getVillages(seed2, skel)) if (v.streetDist(x, y) < 2) return COL_ROAD;
      const { id, id2, edge } = regionAt(seed2, x, y);
      let tint = GW_TINT[id];
      if (edge < MACRO_BLEND && id !== id2) tint = lerp3(tint, GW_TINT[id2], 0.5 * (1 - edge / MACRO_BLEND));
      return lerp3(tint, richBiomes[id].macroColor(seed2, x, y), TINT_MIX);
    },
    biomeAt(seed2, wx, wy) {
      return regionAt(seed2, wx, wy).id;
    }
  };
};
function createGameWorld(pixi, host, opts = {}) {
  const seed = opts.seed ?? 1;
  const ctrl = createChunkedMap(pixi, host, { ...gameWorldConfig(seed), keyboardPan: opts.keyboardPan });
  if (typeof window !== "undefined") {
    const sk = getSkeleton(seed);
    const why = (x, y) => {
      const id = regionAt(seed, x, y).id;
      const [riv, rai] = id === "orc" ? [() => false, () => false] : id === "necropolis" ? [isRiver2, isRaised2] : [isRiver, isRaised];
      return { id, river: riv(seed, x, y), raised: rai(seed, x, y), house: gameWorldBlockedAt(seed)(x, y), road: getRoadNet(seed).has(x, y), walkable: gameWorldWalkable(seed)(x, y) };
    };
    window.__gw = { ctrl, seed, skel: sk, villages: getVillages(seed, sk), blockedAt: gameWorldBlockedAt(seed), roadNet: getRoadNet(seed), walkable: gameWorldWalkable(seed), why };
  }
  return ctrl;
}

// ../auto-battler/src/engine/skills.js
var FIRST_15 = [
  // ── Warrior: adrenaline-fuelled condition → spike (Swordsmanship line) ──
  {
    id: 382,
    name: "Sever Artery",
    profession: "Warrior",
    attribute: "Swordsmanship",
    category: "melee_attack",
    target: "foe",
    cost: { adrenaline: 4 },
    cast: 0,
    recharge: 0,
    requires: ["on_hit"],
    effects: [{ op: "apply_condition", condition: "bleeding", duration: { scale: [5, 25] } }]
  },
  {
    id: 384,
    name: "Gash",
    profession: "Warrior",
    attribute: "Swordsmanship",
    category: "melee_attack",
    target: "foe",
    cost: { adrenaline: 6 },
    cast: 0,
    recharge: 0,
    // The payoff: bonus damage + Deep Wound, but only on an already-Bleeding foe.
    requires: ["on_hit", { target: "bleeding" }],
    effects: [
      { op: "bonus_damage", amount: { scale: [5, 20] } },
      { op: "apply_condition", condition: "deepWound", duration: { scale: [5, 20] } }
    ]
  },
  {
    id: 385,
    name: "Final Thrust",
    profession: "Warrior",
    attribute: "Swordsmanship",
    category: "melee_attack",
    target: "foe",
    cost: { adrenaline: 10 },
    cast: 0,
    recharge: 0,
    requires: ["on_hit"],
    effects: [
      { op: "lose_all_adrenaline" },
      { op: "bonus_damage", amount: { scale: [1, 40] } },
      // "doubled if below 50%" — applying the same bonus a second time, gated.
      { op: "bonus_damage", amount: { scale: [1, 40] }, if: { target_below_health: 0.5 } }
    ]
  },
  // ── Ranger: preparations + ranged conditions/interrupt ──
  {
    id: 435,
    name: "Apply Poison",
    profession: "Ranger",
    attribute: "Wilderness Survival",
    category: "preparation",
    target: "self",
    cost: { energy: 15 },
    cast: 2,
    recharge: 12,
    // The differentiator: a self rider — future physical attacks inflict Poison.
    effects: [{
      op: "preparation",
      duration: { fixed: 24 },
      on_attack: [{ op: "apply_condition", condition: "poison", duration: { scale: [3, 15] } }]
    }]
  },
  {
    id: 391,
    name: "Hunter's Shot",
    profession: "Ranger",
    attribute: "Marksmanship",
    category: "bow_attack",
    target: "foe",
    cost: { energy: 5 },
    cast: 1,
    recharge: 10,
    requires: ["on_hit"],
    effects: [{ op: "apply_condition", condition: "bleeding", duration: { scale: [3, 25] } }]
  },
  {
    id: 426,
    name: "Savage Shot",
    profession: "Ranger",
    attribute: "Marksmanship",
    category: "bow_attack",
    target: "foe",
    cost: { energy: 10 },
    cast: 0.5,
    recharge: 5,
    requires: ["on_hit"],
    effects: [
      { op: "interrupt" },
      // Bonus only if the interrupted action was a spell.
      { op: "bonus_damage", amount: { scale: [13, 28] }, if: { target: "casting_spell" } }
    ]
  },
  // ── Necromancer: trigger-hexes (the event bus / physway) ──
  {
    id: 121,
    name: "Spiteful Spirit",
    profession: "Necromancer",
    attribute: "Curses",
    category: "hex",
    target: "foe",
    cost: { energy: 15 },
    cast: 2,
    recharge: 10,
    elite: true,
    effects: [{
      op: "hex",
      duration: { scale: [8, 20] },
      trigger: "on_action",
      payload: [{ op: "damage", damageType: "shadow", amount: { scale: [5, 35] }, scope: "target_and_adjacent" }]
    }]
  },
  {
    id: 101,
    name: "Barbs",
    profession: "Necromancer",
    attribute: "Curses",
    category: "hex",
    target: "foe",
    cost: { energy: 10 },
    cast: 2,
    recharge: 5,
    effects: [{
      op: "hex",
      duration: { fixed: 30 },
      // Passive amplifier — no discrete trigger; the damage pipeline reads it.
      payload: [{ op: "amplify_damage", amount: { scale: [1, 15] }, vs: "physical" }]
    }]
  },
  {
    id: 150,
    name: "Mark of Pain",
    profession: "Necromancer",
    attribute: "Curses",
    category: "hex",
    target: "foe",
    cost: { energy: 10 },
    cast: 1,
    recharge: 20,
    effects: [{
      op: "hex",
      duration: { fixed: 30 },
      trigger: "on_physical_hit",
      payload: [{ op: "damage", damageType: "shadow", amount: { scale: [10, 40] }, scope: "adjacent_to_target" }]
    }]
  },
  // ── Monk: the damage-interception pipeline ──
  {
    id: 245,
    name: "Protective Spirit",
    profession: "Monk",
    attribute: "Protection Prayers",
    category: "enchantment",
    target: "ally",
    cost: { energy: 10 },
    cast: 0.25,
    recharge: 5,
    effects: [{
      op: "enchant",
      duration: { scale: [5, 23] },
      // Cap: a single hit can't remove more than 10% of max Health.
      payload: [{ op: "cap_damage", maxFraction: 0.1 }]
    }]
  },
  {
    id: 307,
    name: "Reversal of Fortune",
    profession: "Monk",
    attribute: "Protection Prayers",
    category: "enchantment",
    target: "ally",
    cost: { energy: 5 },
    cast: 0.25,
    recharge: 2,
    effects: [{
      op: "enchant",
      duration: { fixed: 8 },
      charges: 1,
      trigger: "on_incoming_damage",
      payload: [{ op: "convert_damage_to_heal", cap: { scale: [15, 80] } }]
    }]
  },
  {
    id: 1114,
    name: "Spirit Bond",
    profession: "Monk",
    attribute: "Protection Prayers",
    category: "enchantment",
    target: "ally",
    cost: { energy: 10 },
    cast: 0.25,
    recharge: 2,
    effects: [{
      op: "enchant",
      duration: { fixed: 8 },
      charges: 10,
      trigger: "on_incoming_damage",
      threshold: { perHitDamageOver: 50 },
      payload: [{ op: "heal", amount: { scale: [30, 90] }, scope: "target" }]
    }]
  },
  // ── Assassin: the combo chain (lead → off-hand → dual) ──
  {
    id: 782,
    name: "Jagged Strike",
    profession: "Assassin",
    attribute: "Dagger Mastery",
    category: "lead_attack",
    target: "foe",
    cost: { energy: 5 },
    cast: 0.5,
    recharge: 1,
    requires: ["on_hit"],
    effects: [
      { op: "apply_condition", condition: "bleeding", duration: { scale: [5, 20] } },
      { op: "set_combo_mark", stage: "lead" }
    ]
  },
  {
    id: 780,
    name: "Fox Fangs",
    profession: "Assassin",
    attribute: "Dagger Mastery",
    category: "offhand_attack",
    target: "foe",
    cost: { energy: 5 },
    cast: 0.5,
    recharge: 3,
    requires: ["on_hit", { combo_follows: "lead" }],
    effects: [
      { op: "bonus_damage", amount: { scale: [10, 35] }, unblockable: true },
      { op: "set_combo_mark", stage: "offhand" }
    ]
  },
  {
    id: 775,
    name: "Death Blossom",
    profession: "Assassin",
    attribute: "Dagger Mastery",
    category: "dual_attack",
    target: "foe",
    cost: { energy: 5 },
    cast: 0,
    recharge: 2,
    requires: ["on_hit", { combo_follows: "offhand" }],
    effects: [
      { op: "bonus_damage", amount: { scale: [20, 45] } },
      { op: "damage", amount: { scale: [20, 45] }, scope: "adjacent_to_target" }
    ]
  }
];
var VARIANT_EXTRA = [
  // ── Warrior · Sentinel (soak / protect) ──
  {
    id: 348,
    name: '"Watch Yourself!"',
    profession: "Warrior",
    attribute: "Tactics",
    category: "shout",
    target: "party",
    cost: { adrenaline: 4 },
    cast: 0,
    recharge: 4,
    // Party armor for 10s, but the buff also ends after 10 incoming attacks.
    effects: [{ op: "armor_mod", amount: { scale: [5, 25] }, duration: { fixed: 10 }, attacksLeft: 10, scope: "party" }]
  },
  {
    id: 372,
    name: "Gladiator's Defense",
    profession: "Warrior",
    attribute: "Tactics",
    category: "stance",
    target: "self",
    cost: { energy: 5 },
    cast: 0,
    recharge: 30,
    elite: true,
    // 75% block; whoever you block in melee takes 5…35 back.
    effects: [{ op: "block", chance: 0.75, vs: "melee", reflect: { scale: [5, 35] }, duration: { scale: [5, 11] } }]
  },
  {
    id: 1,
    name: "Healing Signet",
    profession: "Warrior",
    attribute: "Tactics",
    category: "signet",
    target: "self",
    cost: {},
    cast: 2,
    recharge: 4,
    effects: [{ op: "heal", amount: { scale: [82, 172] }, scope: "self" }],
    whileActivating: [{ op: "armor_mod", amount: -40, duration: { fixed: 0 }, scope: "self" }]
    // −40 armor while using
  },
  // ── Warrior · Breaker (knockdown control) ──
  {
    id: 332,
    name: "Bull's Strike",
    profession: "Warrior",
    attribute: "Strength",
    category: "melee_attack",
    target: "foe",
    cost: { energy: 5 },
    cast: 0,
    recharge: 10,
    requires: ["on_hit", { target: "moving" }],
    effects: [
      { op: "bonus_damage", amount: { scale: [5, 30] } },
      { op: "knockdown", duration: { fixed: 2 } }
    ]
  },
  {
    id: 331,
    name: "Hammer Bash",
    profession: "Warrior",
    attribute: "Hammer Mastery",
    category: "melee_attack",
    target: "foe",
    cost: { adrenaline: 6 },
    cast: 0,
    recharge: 0,
    requires: ["on_hit"],
    effects: [
      { op: "knockdown", duration: { fixed: 2 } },
      { op: "lose_all_adrenaline" }
    ]
  },
  {
    id: 352,
    name: "Crushing Blow",
    profession: "Warrior",
    attribute: "Hammer Mastery",
    category: "melee_attack",
    target: "foe",
    cost: { energy: 5 },
    cast: 0,
    recharge: 10,
    requires: ["on_hit"],
    effects: [
      { op: "bonus_damage", amount: { scale: [1, 20] } },
      { op: "apply_condition", condition: "deepWound", duration: { scale: [5, 20] }, if: { target: "knocked_down" } }
    ]
  },
  // ── Ranger · Sharpshooter (Punishing Shot completes the interrupt bar) ──
  {
    id: 409,
    name: "Punishing Shot",
    profession: "Ranger",
    attribute: "Marksmanship",
    category: "bow_attack",
    target: "foe",
    cost: { energy: 10 },
    cast: 0.5,
    recharge: 5,
    elite: true,
    requires: ["on_hit"],
    effects: [
      { op: "bonus_damage", amount: { scale: [10, 20] } },
      { op: "interrupt" }
    ]
  },
  // ── Ranger · Toxicologist (stacked degen) ──
  {
    id: 1470,
    name: "Barbed Arrows",
    profession: "Ranger",
    attribute: "Wilderness Survival",
    category: "preparation",
    target: "self",
    cost: { energy: 10 },
    cast: 2,
    recharge: 12,
    effects: [{
      op: "preparation",
      duration: { fixed: 24 },
      on_attack: [{ op: "apply_condition", condition: "bleeding", duration: { scale: [3, 15] } }]
    }],
    whileActivating: [{ op: "armor_mod", amount: -40, duration: { fixed: 0 }, scope: "self" }]
    // −40 armor while activating
  },
  {
    id: 1466,
    name: "Burning Arrow",
    profession: "Ranger",
    attribute: "Marksmanship",
    category: "bow_attack",
    target: "foe",
    cost: { energy: 10 },
    cast: 0,
    recharge: 5,
    elite: true,
    requires: ["on_hit"],
    effects: [
      { op: "bonus_damage", amount: { scale: [10, 30] } },
      { op: "apply_condition", condition: "burning", duration: { scale: [1, 7] } }
    ]
  },
  // ── Ranger · Survivalist (sustain / kite) ──
  {
    id: 446,
    name: "Troll Unguent",
    profession: "Ranger",
    attribute: "Wilderness Survival",
    category: "skill",
    target: "self",
    cost: { energy: 5 },
    cast: 3,
    recharge: 10,
    effects: [{ op: "regen_mod", pips: { scale: [3, 10] }, duration: { fixed: 13 }, scope: "self" }]
  },
  {
    id: 1727,
    name: "Natural Stride",
    profession: "Ranger",
    attribute: "Wilderness Survival",
    category: "stance",
    target: "self",
    cost: { energy: 5 },
    cast: 0,
    recharge: 12,
    // Move 33% faster + 50% block; the stance ends if you become hexed/enchanted.
    effects: [
      { op: "move_speed", mult: 1.33, duration: { scale: [1, 8] }, endsOnHexEnchant: true },
      { op: "block", chance: 0.5, vs: "all", duration: { scale: [1, 8] }, endsOnHexEnchant: true }
    ]
  },
  {
    id: 393,
    name: "Crippling Shot",
    profession: "Ranger",
    attribute: "Marksmanship",
    category: "bow_attack",
    target: "foe",
    cost: { energy: 10 },
    cast: 0,
    recharge: 2,
    elite: true,
    requires: ["on_hit"],
    effects: [{ op: "apply_condition", condition: "crippled", duration: { scale: [1, 12] }, unblockable: true }]
  },
  // ── Necromancer · Vampire (life-steal sustain) ──
  {
    id: 153,
    name: "Vampiric Gaze",
    profession: "Necromancer",
    attribute: "Blood Magic",
    category: "spell",
    target: "foe",
    cost: { energy: 10 },
    cast: 1,
    recharge: 8,
    effects: [{ op: "life_steal", amount: { scale: [18, 60] } }]
  },
  {
    id: 109,
    name: "Life Siphon",
    profession: "Necromancer",
    attribute: "Blood Magic",
    category: "hex",
    target: "foe",
    cost: { energy: 10 },
    cast: 1,
    recharge: 5,
    effects: [
      { op: "regen_mod", pips: { scale: [-1, -3] }, duration: { scale: [12, 24] }, scope: "target" },
      { op: "regen_mod", pips: { scale: [1, 3] }, duration: { scale: [12, 24] }, scope: "self" }
    ]
  },
  {
    id: 115,
    name: "Blood Renewal",
    profession: "Necromancer",
    attribute: "Blood Magic",
    category: "enchantment",
    target: "self",
    cost: { energy: 1, sacrifice: 15 },
    cast: 1,
    recharge: 7,
    // +3…6 regen for 7s, then a burst heal of 40…190 when the enchant ends.
    effects: [
      { op: "regen_mod", pips: { scale: [3, 6] }, duration: { fixed: 7 }, scope: "self" },
      { op: "enchant", duration: { fixed: 7 }, trigger: "on_end", payload: [{ op: "heal", amount: { scale: [40, 190] }, scope: "self" }] }
    ]
  },
  // ── Necromancer · Plaguebearer (condition spread) ──
  {
    id: 118,
    name: "Enfeebling Blood",
    profession: "Necromancer",
    attribute: "Curses",
    category: "spell",
    target: "foe",
    cost: { energy: 1, sacrifice: 10 },
    cast: 1,
    recharge: 8,
    effects: [{ op: "apply_condition", condition: "weakness", duration: { scale: [5, 20] }, scope: "target_and_adjacent" }]
  },
  {
    id: 106,
    name: "Rotting Flesh",
    profession: "Necromancer",
    attribute: "Death Magic",
    category: "spell",
    target: "foe",
    cost: { energy: 15 },
    cast: 3,
    recharge: 3,
    effects: [{ op: "apply_condition", condition: "disease", duration: { scale: [10, 25] } }]
  },
  {
    id: 135,
    name: "Faintheartedness",
    profession: "Necromancer",
    attribute: "Curses",
    category: "hex",
    target: "foe",
    cost: { energy: 10 },
    cast: 1,
    recharge: 8,
    effects: [
      { op: "regen_mod", pips: { scale: [0, -3] }, duration: { scale: [3, 16] }, scope: "target" },
      { op: "attack_speed", mult: 2, duration: { scale: [3, 16] }, scope: "target" }
    ]
  },
  // ── Monk · Healer (raw healing) ──
  {
    id: 281,
    name: "Orison of Healing",
    profession: "Monk",
    attribute: "Healing Prayers",
    category: "spell",
    target: "ally",
    cost: { energy: 5 },
    cast: 1,
    recharge: 2,
    effects: [{ op: "heal", amount: { scale: [20, 70] }, scope: "target" }]
  },
  {
    id: 283,
    name: "Dwayna's Kiss",
    profession: "Monk",
    attribute: "Healing Prayers",
    category: "spell",
    target: "other_ally",
    cost: { energy: 5 },
    cast: 1,
    recharge: 3,
    // Heal, +10…35 more for each enchantment and hex on the target ally.
    effects: [{ op: "heal", amount: { scale: [15, 60] }, scope: "target", plusPerMod: { kinds: ["enchant", "hex"], amount: { scale: [10, 35] } } }]
  },
  {
    id: 282,
    name: "Word of Healing",
    profession: "Monk",
    attribute: "Healing Prayers",
    category: "spell",
    target: "ally",
    cost: { energy: 5 },
    cast: 0.75,
    recharge: 3,
    elite: true,
    // Conditional bonus first so the "<50% Health" check reads the pre-heal HP
    // (the base heal below would otherwise lift the ally over the threshold).
    effects: [
      { op: "heal", amount: { scale: [30, 115] }, scope: "target", if: { target_below_health: 0.5 } },
      { op: "heal", amount: { scale: [5, 100] }, scope: "target" }
    ]
  },
  // ── Monk · Smiter (holy offense) ──
  {
    id: 312,
    name: "Holy Strike",
    profession: "Monk",
    attribute: "Smiting Prayers",
    category: "spell",
    target: "foe",
    cost: { energy: 5 },
    cast: 0.75,
    recharge: 8,
    effects: [
      { op: "damage", damageType: "holy", amount: { scale: [10, 55] }, scope: "target" },
      { op: "damage", damageType: "holy", amount: { scale: [10, 55] }, scope: "target", if: { target: "knocked_down" } }
    ]
  },
  {
    id: 240,
    name: "Smite",
    profession: "Monk",
    attribute: "Smiting Prayers",
    category: "spell",
    target: "foe",
    cost: { energy: 10 },
    cast: 1,
    recharge: 10,
    effects: [
      { op: "damage", damageType: "holy", amount: { scale: [10, 55] }, scope: "target_and_adjacent" },
      { op: "damage", damageType: "holy", amount: { scale: [10, 35] }, scope: "target_and_adjacent", if: { target: "attacking" } }
    ]
  },
  {
    id: 252,
    name: "Banish",
    profession: "Monk",
    attribute: "Smiting Prayers",
    category: "spell",
    target: "foe",
    cost: { energy: 5 },
    cast: 1,
    recharge: 10,
    // Double vs summoned creatures — a no-op until summons exist, but recorded.
    effects: [{ op: "damage", damageType: "holy", amount: { scale: [20, 56] }, scope: "target", vsSummoned: 2 }]
  },
  // ── Assassin · Nightstalker (shadow-step burst) ──
  {
    id: 952,
    name: "Death's Charge",
    profession: "Assassin",
    attribute: "Shadow Arts",
    category: "skill",
    target: "foe",
    cost: { energy: 5 },
    cast: 0.25,
    recharge: 30,
    // Shadow-step to the foe; heal only if that foe has more Health than you.
    effects: [
      { op: "shadow_step", to: "foe" },
      { op: "heal", amount: { scale: [65, 200] }, scope: "self", if: { target_health_above_self: true } }
    ]
  },
  {
    id: 1024,
    name: "Black Mantis Thrust",
    profession: "Assassin",
    attribute: "Deadly Arts",
    category: "lead_attack",
    target: "foe",
    cost: { energy: 5 },
    cast: 1,
    recharge: 6,
    requires: ["on_hit"],
    effects: [
      { op: "bonus_damage", amount: { scale: [8, 20] } },
      { op: "apply_condition", condition: "crippled", duration: { scale: [3, 15] }, if: { target: "hexed" } },
      { op: "set_combo_mark", stage: "lead" }
    ]
  },
  // ── Assassin · Saboteur (control / Deadly Arts) ──
  {
    id: 858,
    name: "Dancing Daggers",
    profession: "Assassin",
    attribute: "Deadly Arts",
    category: "spell",
    target: "foe",
    cost: { energy: 5 },
    cast: 1,
    recharge: 5,
    // Three earth projectiles, each 5…35; counts as a lead attack.
    effects: [
      { op: "damage", damageType: "earth", amount: { scale: [5, 35] }, projectiles: 3, delivery: "projectile_spell", scope: "target" },
      { op: "set_combo_mark", stage: "lead" }
    ]
  },
  {
    id: 784,
    name: "Entangling Asp",
    profession: "Assassin",
    attribute: "Deadly Arts",
    category: "spell",
    target: "foe",
    cost: { energy: 10 },
    cast: 1,
    recharge: 20,
    requires: [{ combo_follows: "lead" }],
    effects: [
      { op: "knockdown", duration: { fixed: 2 } },
      { op: "apply_condition", condition: "poison", duration: { scale: [5, 20] } }
    ]
  },
  {
    id: 988,
    name: "Temple Strike",
    profession: "Assassin",
    attribute: "Dagger Mastery",
    category: "offhand_attack",
    target: "foe",
    cost: { energy: 15 },
    cast: 0,
    recharge: 20,
    elite: true,
    requires: ["on_hit", { combo_follows: "lead" }],
    effects: [
      { op: "interrupt", if: { target: "casting_spell" } },
      // interrupts a spell
      { op: "apply_condition", condition: "dazed", duration: { scale: [1, 10] } },
      { op: "apply_condition", condition: "blind", duration: { scale: [1, 10] } }
    ]
  }
];
var CB_SKILLS = [...FIRST_15, ...VARIANT_EXTRA];

// ../auto-battler/src/gw.js
var iconUrl = (id) => `/gw/skills/${id}.jpg`;

// ../auto-battler/src/lib/recolor.js
var QUANT = 24;
var SAT_MIN = 0.2;
var L_MIN = 0.1;
var L_MAX = 0.95;
var SWATCH_N = 5;
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  h /= 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(hue(h + 1 / 3) * 255), Math.round(hue(h) * 255), Math.round(hue(h - 1 / 3) * 255)];
}
var hexToRgb = (hex) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
};
var rgbToHex = (r, g, b) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
var isMaterial = (s, l) => s >= SAT_MIN && l >= L_MIN && l <= L_MAX;
var _imgCache = /* @__PURE__ */ new Map();
function loadImage(url) {
  if (_imgCache.has(url)) return _imgCache.get(url);
  const p = new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
  _imgCache.set(url, p);
  return p;
}
function pixels(img) {
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { cv, ctx, data: ctx.getImageData(0, 0, cv.width, cv.height) };
}
var _analysis = /* @__PURE__ */ new Map();
function analyze(idleUrl) {
  if (_analysis.has(idleUrl)) return _analysis.get(idleUrl);
  const p = (async () => {
    const { data } = pixels(await loadImage(idleUrl));
    const d = data.data;
    const counts = /* @__PURE__ */ new Map();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      const r = d[i] - d[i] % QUANT, g = d[i + 1] - d[i + 1] % QUANT, b = d[i + 2] - d[i + 2] % QUANT;
      const [h, s, l] = rgbToHsl(r, g, b);
      if (!isMaterial(s, l)) continue;
      const k = r << 16 | g << 8 | b;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    if (!counts.size) return { anchor: null, swatches: [] };
    const entries = [...counts.entries()].map(([k, c]) => ({ k, c, hsl: rgbToHsl(k >> 16 & 255, k >> 8 & 255, k & 255) })).sort((a, b) => b.c - a.c);
    const anchor = entries[0].hsl;
    const swatches = entries.slice(0, SWATCH_N).sort((a, b) => a.hsl[0] - b.hsl[0] || a.hsl[2] - b.hsl[2]).map(({ k }) => rgbToHex(k >> 16 & 255, k >> 8 & 255, k & 255));
    return { anchor, swatches };
  })();
  _analysis.set(idleUrl, p);
  return p;
}
function xform([h, s, l], anchor, tH, tS) {
  const nh = ((h + (tH - anchor[0])) % 360 + 360) % 360;
  const ns = Math.min(1, Math.max(0, s + (tS - anchor[1])));
  return hslToRgb(nh, ns, l);
}
var _canvasCache = /* @__PURE__ */ new Map();
function recoloredCanvas(url, idleUrl, targetHex) {
  const key = `${url}#${idleUrl}#${targetHex}`;
  if (_canvasCache.has(key)) return _canvasCache.get(key);
  const p = (async () => {
    const [img, { anchor }] = await Promise.all([loadImage(url), analyze(idleUrl)]);
    const { cv, ctx, data } = pixels(img);
    if (anchor) {
      const [tH, tS] = rgbToHsl(...hexToRgb(targetHex));
      const d = data.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        if (!isMaterial(s, l)) continue;
        const [r, g, b] = xform([h, s, l], anchor, tH, tS);
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
      }
      ctx.putImageData(data, 0, 0);
    }
    return cv;
  })();
  _canvasCache.set(key, p);
  return p;
}
async function recoloredTexture(Texture, url, idleUrl, targetHex) {
  const cv = targetHex ? await recoloredCanvas(url, idleUrl, targetHex) : await loadImage(url);
  const t = Texture.from(cv);
  t.source.scaleMode = "nearest";
  return t;
}

// ../auto-battler/src/render/spriteSheet.js
var SHEET_ROWS = 4;
var cellOf = (height) => Math.round(height / SHEET_ROWS);
function sliceGridWith(pixi, texture, cell = cellOf(texture.source.height)) {
  const { Texture, Rectangle } = pixi;
  const src = texture.source;
  const rows = Math.max(1, Math.round(src.height / cell));
  const cols = Math.max(1, Math.round(src.width / cell));
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_2, c) => new Texture({ source: src, frame: new Rectangle(c * cell, r * cell, cell, cell) })));
}
var ANIM = { idle: 0.12, walk: 0.18, attack: 0.3, dmg: 0.25, die: 0.28 };
var ROW_FOR = { "front-right": 0, "front-left": 1, "back-right": 2, "back-left": 3 };
var rowFor = (grid, facing) => grid[ROW_FOR[facing]] ?? grid[0];
var facingFor = (faceX, faceY) => (faceY < 0 ? "back" : "front") + "-" + (faceX < 0 ? "left" : "right");

// ../auto-battler/src/render/combatRenderer.js
var COND_ICON = {
  bleeding: "bleeding",
  poison: "poison",
  burning: "burning",
  deepWound: "deep-wound",
  disease: "disease",
  dazed: "dazed",
  crippled: "crippled",
  weakness: "weakness",
  blind: "blind",
  crackedArmor: "cracked-armor"
};
var COND_STATUS = {
  bleeding: "bleeding",
  poison: "poison",
  burning: "fire",
  disease: "sickness",
  deepWound: "petrification",
  dazed: "stun",
  crippled: "ice",
  weakness: "nature",
  blind: "fear",
  crackedArmor: "shock"
};
var COND_PRIORITY = ["deepWound", "burning", "poison", "bleeding", "disease", "dazed", "crippled", "blind", "crackedArmor", "weakness"];
var OUT_OFF = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
var MAT_RED = [0, 0, 0, 0, 0.86, 0, 0, 0, 0, 0.12, 0, 0, 0, 0, 0.12, 0, 0, 0, 1, 0];
var MAT_YELLOW = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0.84, 0, 0, 0, 0, 0.1, 0, 0, 0, 1, 0];
var GOLD = 16767050;
var BAR_TOP = 3;
var GHOST_HOLD = 220;
var GHOST_TAU = 150;
var GHOST_FADE = 400;
var ICON_SIZE = 18;
var _footCache = /* @__PURE__ */ new Map();
async function footFracOf(url) {
  if (!url) return 1;
  if (_footCache.has(url)) return _footCache.get(url);
  try {
    const img = await new Promise((ok, no) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = no;
      i.src = url;
    });
    const cell = Math.round(img.naturalHeight / 4);
    const cv = document.createElement("canvas");
    cv.width = cell;
    cv.height = cell;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cell, cell, 0, 0, cell, cell);
    const d = ctx.getImageData(0, 0, cell, cell).data;
    let bottom = cell - 1;
    for (let y = cell - 1; y >= 0; y--) {
      let any = false;
      for (let x = 0; x < cell; x++) if (d[(y * cell + x) * 4 + 3] > 16) {
        any = true;
        break;
      }
      if (any) {
        bottom = y;
        break;
      }
    }
    const frac = Math.min(1, (bottom + 1.5) / cell);
    _footCache.set(url, frac);
    return frac;
  } catch {
    return 1;
  }
}
var facingOf = (a) => facingFor(a.faceX, a.faceY);
async function createCombatRenderer({ pixi, defsById = {}, layers, coords, getBattle }) {
  const { Assets, Texture, Rectangle, AnimatedSprite, Sprite, Container, Graphics, Text, ColorMatrixFilter } = pixi;
  const sliceGrid = (texture, cell) => sliceGridWith({ Texture, Rectangle }, texture, cell);
  const rowFramesH = (texture, cell) => {
    const src = texture.source;
    const cols = Math.max(1, Math.round(src.width / cell));
    const h = Math.min(cell, src.height);
    return Array.from({ length: cols }, (_, c) => new Texture({ source: src, frame: new Rectangle(c * cell, 0, cell, h) }));
  };
  const { units, fx, projLayer } = layers;
  const { mapX, mapY, depthOf } = coords;
  const actorOf = (id) => getBattle()?.actors.find((x) => x.id === id);
  const floats = [];
  const sheetsById = {};
  async function loadSheets(id, def) {
    if (!def?.idle) {
      sheetsById[id] = null;
      return;
    }
    try {
      const load = (url) => url ? recoloredTexture(Texture, url, def.idle, def.recolor) : null;
      const [idle, walk, attack, dmg, die] = await Promise.all([
        load(def.idle),
        load(def.walk),
        load(def.attack),
        load(def.dmg),
        load(def.die)
      ]);
      for (const tx of [idle, walk, attack, dmg, die]) if (tx) tx.source.scaleMode = "nearest";
      const cell = Math.round(idle.source.height / 4);
      sheetsById[id] = {
        idle: sliceGrid(idle, cell),
        walk: walk ? sliceGrid(walk, cell) : sliceGrid(idle, cell),
        attack: attack ? sliceGrid(attack, cell) : sliceGrid(idle, cell),
        dmg: dmg ? sliceGrid(dmg, cell) : null,
        die: die ? sliceGrid(die, cell) : null,
        cell,
        footFrac: await footFracOf(def.idle)
      };
    } catch {
      sheetsById[id] = null;
    }
  }
  for (const [id, def] of Object.entries(defsById)) await loadSheets(id, def);
  const skillIcons = {};
  for (const s of CB_SKILLS) {
    try {
      const t = await Assets.load(iconUrl(s.id));
      t.source.scaleMode = "linear";
      skillIcons[s.id] = t;
    } catch {
    }
  }
  const condIcons = {};
  for (const [type, file] of Object.entries(COND_ICON)) {
    try {
      const t = await Assets.load(`/gw/icons/condition-${file}.jpg`);
      t.source.scaleMode = "linear";
      condIcons[type] = t;
    } catch {
    }
  }
  const condFrames = {};
  try {
    const catalogue = await fetch("/assets/effects.json").then((r) => r.json()).then((d) => d.effects || []);
    const byKey = Object.fromEntries(catalogue.filter((e) => e.category === "status").map((e) => [e.key, e]));
    for (const [type, statusKey] of Object.entries(COND_STATUS)) {
      const e = byKey[statusKey];
      if (!e) continue;
      try {
        const t = await Assets.load(e.url);
        t.source.scaleMode = "nearest";
        condFrames[type] = rowFramesH(t, e.cell || t.source.height);
      } catch {
      }
    }
  } catch {
  }
  const skillPlay = {};
  async function buildSkillPlay(id, def) {
    const cell = sheetsById[id]?.cell;
    const map = {};
    for (const [skillId, fxCfg] of Object.entries(def.skillFx || {})) {
      let animGrid = null;
      if (fxCfg.animUrl && cell) {
        try {
          const t = await recoloredTexture(Texture, fxCfg.animUrl, def.idle, def.recolor);
          animGrid = sliceGrid(t, cell);
        } catch {
        }
      }
      const effects = [];
      for (const ef of fxCfg.effects || []) {
        try {
          const t = await Assets.load(ef.url);
          t.source.scaleMode = "nearest";
          effects.push(sliceGrid(t, ef.cell || 32)[0]);
        } catch {
        }
      }
      map[skillId] = { animGrid, effects };
    }
    skillPlay[id] = map;
  }
  for (const [id, def] of Object.entries(defsById)) await buildSkillPlay(id, def);
  const view = {};
  function buildView(id, def) {
    const sh = sheetsById[id];
    const c = new Container();
    let sp;
    if (sh) {
      sp = new AnimatedSprite(rowFor(sh.idle, "front-right"));
      sp.anchor.set(0.5, sh.footFrac ?? 1);
      sp.animationSpeed = ANIM.idle;
      sp.play();
    } else {
      sp = new Container();
      const g = new Graphics();
      g.circle(0, -16, 16).fill(def?.color || 8947848);
      const t = new Text({ text: (def?.name || "?")[0], style: { fill: 16777215, fontSize: 15, fontWeight: "700" } });
      t.anchor.set(0.5);
      t.y = -16;
      sp.addChild(g, t);
    }
    const bars = new Graphics();
    const status = new Container();
    const overlay = new AnimatedSprite([Texture.EMPTY]);
    overlay.anchor.set(0.5, sh?.footFrac ?? 1);
    overlay.visible = false;
    overlay.loop = true;
    overlay.animationSpeed = 0.15;
    const makeOutline = (matrix) => {
      if (!sh) return null;
      const o = { container: new Container(), copies: [] };
      const filter = new ColorMatrixFilter();
      filter.matrix = matrix;
      o.container.filters = [filter];
      o.container.visible = false;
      o.container.alpha = 0.75;
      for (let i = 0; i < OUT_OFF.length; i++) {
        const s = new Sprite(Texture.EMPTY);
        s.anchor.set(0.5, sh.footFrac ?? 1);
        o.container.addChild(s);
        o.copies.push(s);
      }
      return o;
    };
    const castOutline = makeOutline(MAT_YELLOW);
    const outline = makeOutline(MAT_RED);
    if (castOutline) c.addChild(castOutline.container);
    if (outline) c.addChild(outline.container);
    c.addChild(sp, overlay, bars, status);
    units.addChild(c);
    view[id] = { def, sheets: sh, container: c, sprite: sp, overlay, overlayKey: null, bars, status, statusSprites: {}, outline, castOutline, mode: null, facing: null, flash: 0, dead: false };
  }
  for (const [id, def] of Object.entries(defsById)) buildView(id, def);
  async function addActor(id, def) {
    if (view[id]) return view[id];
    defsById[id] = def;
    await loadSheets(id, def);
    await buildSkillPlay(id, def);
    buildView(id, def);
    return view[id];
  }
  function removeActor2(id) {
    const v = view[id];
    if (!v) return;
    units.removeChild(v.container);
    v.container.destroy({ children: true });
    delete view[id];
    delete sheetsById[id];
    delete skillPlay[id];
    delete defsById[id];
  }
  function setLoop(v, mode, facing) {
    if (v.mode === mode && v.facing === facing) return;
    v.mode = mode;
    v.facing = facing;
    v.sprite.textures = rowFor(v.sheets[mode], facing);
    v.sprite.loop = true;
    v.sprite.animationSpeed = ANIM[mode];
    v.sprite.play();
  }
  function playOnce(v, mode, facing, onDone, speedMul = 1) {
    v.mode = mode;
    v.facing = facing;
    v.sprite.onComplete = null;
    v.sprite.textures = rowFor(v.sheets[mode], facing);
    v.sprite.loop = false;
    v.sprite.animationSpeed = ANIM[mode] * speedMul;
    v.sprite.onComplete = () => {
      v.sprite.onComplete = null;
      onDone && onDone();
    };
    v.sprite.gotoAndPlay(0);
  }
  const resume = (v) => {
    v.mode = null;
  };
  function playAttack(id, a, onDone = null, speedMul = 1) {
    const v = view[id];
    if (!v?.sheets || v.dead) return;
    playOnce(v, "attack", facingOf(a), () => {
      resume(v);
      onDone && onDone();
    }, speedMul);
  }
  function playHurt(id, a) {
    const v = view[id];
    if (!v?.sheets?.dmg || v.dead || v.skillAnim || v.mode !== "idle") return;
    playOnce(v, "dmg", facingOf(a), () => resume(v));
  }
  function playDie(id, a) {
    const v = view[id];
    if (!v || v.dead) return;
    v.dead = true;
    v.mode = "die";
    const facing = facingOf(a);
    v.facing = facing;
    if (!v.sheets) return;
    const crumple = () => {
      if (!v.sheets.die) return;
      const frames = rowFor(v.sheets.die, facing);
      v.sprite.onComplete = null;
      v.sprite.textures = frames;
      v.sprite.loop = false;
      v.sprite.animationSpeed = ANIM.die * 0.75;
      v.sprite.onComplete = () => {
        v.sprite.onComplete = null;
        v.sprite.gotoAndStop(frames.length - 1);
      };
      v.sprite.gotoAndPlay(0);
    };
    if (v.sheets.dmg) {
      const hit = rowFor(v.sheets.dmg, facing);
      v.sprite.onComplete = null;
      v.sprite.textures = hit;
      v.sprite.loop = false;
      v.sprite.animationSpeed = ANIM.dmg;
      v.sprite.onComplete = () => {
        v.sprite.onComplete = null;
        crumple();
      };
      v.sprite.gotoAndPlay(0);
    } else crumple();
  }
  function playGridOnce(v, grid, { speedMul = 1, hold = false, onDone = null } = {}) {
    if (!grid || !v || v.dead) return false;
    v.mode = "attack";
    v.skillAnim = true;
    v.sprite.onComplete = null;
    v.sprite.textures = grid[0];
    v.sprite.loop = false;
    v.sprite.animationSpeed = ANIM.attack * speedMul;
    v.sprite.onComplete = () => {
      v.sprite.onComplete = null;
      if (hold) v.sprite.gotoAndStop(grid[0].length - 1);
      else {
        v.skillAnim = false;
        resume(v);
      }
      onDone && onDone();
    };
    v.sprite.gotoAndPlay(0);
    return true;
  }
  function spawnEffects(casterId, framesList) {
    const a = actorOf(casterId);
    const v = view[casterId];
    if (!a || !v || !framesList?.length) return;
    const cell = v.sheets?.cell ?? 24, ff = v.sheets?.footFrac ?? 1, depth = depthOf(a);
    const cx = mapX(a.x), cy = mapY(a.y) - (ff - 0.5) * cell * depth;
    for (const frames of framesList) {
      if (!frames?.length) continue;
      const s = new AnimatedSprite(frames);
      s.anchor.set(0.5);
      s.loop = false;
      s.animationSpeed = 0.3;
      s.scale.set(depth);
      s.position.set(cx, cy);
      s.onComplete = () => fx.removeChild(s);
      fx.addChild(s);
      s.gotoAndPlay(0);
    }
  }
  const headY = (id, a) => {
    const v = view[id], cell = v?.sheets?.cell ?? 24, ff = v?.sheets?.footFrac ?? 1;
    return mapY(a.y) - ff * cell * depthOf(a) - 2;
  };
  function floatText(id, text, color, opts = {}) {
    const a = actorOf(id);
    if (!a) return;
    const t = new Text({ text, style: { fill: color, fontSize: opts.big ? 20 : 14, fontFamily: "monospace", fontWeight: "700", stroke: opts.big ? { color: 2760448, width: 3 } : void 0 } });
    t.anchor.set(0.5);
    t.x = mapX(a.x) + (Math.random() * 20 - 10);
    t.y = headY(id, a) - (opts.big ? 6 : 0);
    fx.addChild(t);
    floats.push({ t, life: opts.big ? 1.25 : 1, max: opts.big ? 1.25 : 1 });
  }
  function floatIcon(id, skillId) {
    const a = actorOf(id);
    const tex = skillId && skillIcons[skillId];
    if (!a || !tex) return false;
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.width = ICON_SIZE;
    s.height = ICON_SIZE;
    s.x = mapX(a.x);
    s.y = headY(id, a) - 8;
    fx.addChild(s);
    floats.push({ t: s, life: 1.2, max: 1.2, icon: true, size: ICON_SIZE, who: id });
    return true;
  }
  function flagEmpower(id) {
    for (const f of floats) if (f.icon && f.who === id) {
      f.t.tint = GOLD;
      f.empower = true;
      f.size = ICON_SIZE + 6;
    }
    floatText(id, "\u26A1", GOLD);
  }
  function spawnEcho(id) {
    const a = actorOf(id), v = view[id];
    if (!a || !v?.sheets) return;
    const depth = depthOf(a);
    for (const cfg of [{ life: 0.55, scaleTo: 2.2, a0: 0.85 }, { life: 0.8, scaleTo: 3.1, a0: 0.55 }]) {
      const s = new Sprite(v.sprite.texture);
      s.anchor.set(0.5, v.sheets.footFrac ?? 1);
      s.tint = 10473727;
      s.x = mapX(a.x);
      s.y = mapY(a.y);
      fx.addChild(s);
      floats.push({ t: s, life: cfg.life, max: cfg.life, echo: true, baseScale: depth, scaleTo: cfg.scaleTo, alpha0: cfg.a0, dir: a.facing || 1 });
    }
  }
  function drawBars(id, a, dt, now) {
    const v = view[id];
    const g = v.bars;
    g.clear();
    const w = 40;
    const cur = Math.max(0, a.hp / a.baseMaxHp);
    if (v.hpGhost == null || cur >= v.hpGhost) {
      v.hpGhost = cur;
      v.hpLast = cur;
      v.hpGhostT = GHOST_HOLD;
    }
    if (cur < (v.hpLast ?? cur) - 8e-3) v.hpGhostT = 0;
    v.hpLast = cur;
    v.hpGhostT = (v.hpGhostT ?? GHOST_HOLD) + dt;
    if (v.hpGhost > cur && v.hpGhostT > GHOST_HOLD) {
      v.hpGhost = cur + (v.hpGhost - cur) * Math.max(0, 1 - dt / GHOST_TAU);
      if (v.hpGhost - cur < 4e-3) v.hpGhost = cur;
    }
    g.rect(-w / 2, BAR_TOP, w, 5).fill(1316897);
    if (v.hpGhost > cur + 1e-4) {
      const fade = v.hpGhostT <= GHOST_HOLD ? 1 : Math.max(0, 1 - (v.hpGhostT - GHOST_HOLD) / GHOST_FADE);
      g.rect(-w / 2 + 1 + (w - 2) * cur, BAR_TOP + 1, (w - 2) * (v.hpGhost - cur), 3).fill({ color: 16777215, alpha: 0.85 * fade });
    }
    g.rect(-w / 2 + 1, BAR_TOP + 1, (w - 2) * cur, 3).fill(cur > 0.4 ? 12113482 : 14165786);
    const res = a.profession === "Warrior" ? a.adrenaline / 25 : a.energy / a.maxEnergy;
    g.rect(-w / 2, BAR_TOP + 6, w, 3).fill(1316897);
    g.rect(-w / 2 + 1, BAR_TOP + 7, (w - 2) * Math.max(0, Math.min(1, res)), 1.5).fill(a.profession === "Warrior" ? 15247146 : 3832997);
    const mark = Object.values(a.marks || {}).find((m) => m && m.until > now);
    if (mark) for (let i = 0; i < (mark.stage === "offhand" ? 2 : 1); i++) g.circle(w / 2 - 2 - i * 3, BAR_TOP - 2, 1.3).fill(16767050);
    const headRel = -((v.sheets?.footFrac ?? 1) * (v.sheets?.cell ?? 24) * depthOf(a)) - 4;
    if (a.kd > now) {
      const cy = headRel + 2;
      for (let i = 0; i < 3; i++) {
        const ang = now * 6 + i * 2 * Math.PI / 3;
        g.circle(Math.cos(ang) * 6, cy + Math.sin(ang) * 2.2, 1.5).fill(16110658);
      }
    }
    if (a.casting && a.casting.skill) {
      const total = a.casting.skill.cast || 1;
      const prog = Math.max(0, Math.min(1, 1 - (a.casting.left ?? 0) / total));
      g.rect(-11, headRel, 22, 3).fill(1316897);
      g.rect(-10, headRel + 0.75, 20 * prog, 1.5).fill(7325664);
    }
  }
  function drawStatus(id, a, t, depth) {
    const v = view[id];
    const active = a.conds.filter((c) => c.until > t && condIcons[c.type]);
    const sz = 11, gap = 2, totalW = active.length * sz + Math.max(0, active.length - 1) * gap;
    active.forEach((c, i) => {
      let s = v.statusSprites[c.type];
      if (!s) {
        s = new Sprite(condIcons[c.type]);
        s.anchor.set(0.5);
        s.width = sz;
        s.height = sz;
        v.status.addChild(s);
        v.statusSprites[c.type] = s;
      }
      s.x = -totalW / 2 + sz / 2 + i * (sz + gap);
      s.y = BAR_TOP + 15;
      const left = c.until - t;
      s.visible = left >= 1.2 || Math.floor(t * 6) % 2 === 0;
    });
    for (const type in v.statusSprites) if (!active.find((c) => c.type === type)) v.statusSprites[type].visible = false;
    let key = null;
    if (!v.dead) {
      for (const type of COND_PRIORITY) if (condFrames[type] && active.some((c) => c.type === type)) {
        key = type;
        break;
      }
    }
    if (key !== v.overlayKey) {
      v.overlayKey = key;
      if (key) {
        v.overlay.textures = condFrames[key];
        v.overlay.visible = true;
        v.overlay.gotoAndPlay(0);
      } else {
        v.overlay.visible = false;
      }
    }
    if (key) v.overlay.scale.set(depth);
  }
  function resetForNewBattle() {
    for (const id in view) {
      const v = view[id];
      v.dead = false;
      v.mode = null;
      v.facing = null;
      v.flash = 0;
      v.skillAnim = false;
      for (const k in v.statusSprites) v.statusSprites[k].visible = false;
      v.overlay.visible = false;
      v.overlayKey = null;
      if (v.sheets) {
        v.sprite.onComplete = null;
        v.sprite.tint = 16777215;
        v.sprite.alpha = 1;
      }
    }
  }
  function syncActors(b, dtMS, now, { cine = null, cineDim = 0, cineCfg = {} } = {}) {
    for (const a of b.actors) {
      const v = view[a.id];
      if (!v) continue;
      v.container.x = mapX(a.x);
      v.container.y = mapY(a.y);
      if (cine?.hit && a.id === cine.targetId && !v.dead) {
        v.container.x += (Math.random() * 2 - 1) * 2.5;
        v.container.y += (Math.random() * 2 - 1) * 2.5;
      }
      v.container.zIndex = a.y;
      const depth = depthOf(a);
      const dimmed = cine && cine.freeze && cineCfg.dim !== false && a.id !== cine.casterId && a.id !== cine.targetId;
      const dimTint = () => {
        const g = Math.round(255 * (1 - cineDim * 0.5));
        return g << 16 | g << 8 | g;
      };
      if (v.sheets) {
        v.sprite.scale.set(depth);
        if (v.dead) {
          v.sprite.tint = dimmed ? dimTint() : 16777215;
          v.sprite.alpha = 0.9;
        } else {
          if (v.mode !== "attack" && v.mode !== "dmg") {
            setLoop(v, a.moving ? "walk" : "idle", facingOf(a));
          }
          v.flash = Math.max(0, v.flash - dtMS);
          v.sprite.tint = dimmed ? dimTint() : v.flash > 0 && !v.skillAnim ? 16738922 : 16777215;
          v.sprite.alpha = 1;
        }
      } else {
        v.sprite.scale.set(1);
        v.sprite.alpha = a.alive ? 1 : 0.32;
      }
      if (!a.decor) {
        drawBars(a.id, a, dtMS, b.t);
        drawStatus(a.id, a, b.t, depth);
      }
    }
  }
  function updateFloats(dtMS) {
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.life -= dtMS / 1e3;
      const age = f.max - f.life;
      if (f.echo) {
        const p = Math.min(1, age / f.max);
        const sc = f.baseScale * (1 + (f.scaleTo - 1) * p);
        f.t.scale.set(sc * (f.dir < 0 ? -1 : 1), sc);
        f.t.alpha = f.alpha0 * (1 - p);
      } else {
        f.t.y -= dtMS * 0.022;
        const fin = Math.min(1, age / 0.18), fout = Math.min(1, f.life / 0.35);
        f.t.alpha = Math.max(0, Math.min(fin, fout));
        if (f.icon) {
          const sz = f.size * (0.6 + 0.4 * fin);
          f.t.width = sz;
          f.t.height = sz;
        }
      }
      if (f.life <= 0) {
        fx.removeChild(f.t);
        floats.splice(i, 1);
      }
    }
  }
  function drawProjectiles(b) {
    projLayer.clear();
    for (const p of b.projectiles) {
      const frac = Math.max(0, Math.min(1, (b.t - p.bornT) / (p.hitT - p.bornT)));
      const px = mapX(p.fromX + (p.aimX - p.fromX) * frac);
      const py = mapY(p.fromY + (p.aimY - p.fromY) * frac) - 26;
      projLayer.circle(px, py, 4).fill(15786176).stroke({ width: 1, color: 2764602 });
    }
  }
  function processLog(b, r, hooks = {}) {
    const log2 = b.log;
    for (; r.logIdx < log2.length; r.logIdx++) {
      const e = log2[r.logIdx];
      if (e.kind === "cast") {
        const h = hooks.onCast?.(e) || {};
        if (h.break) {
          r.logIdx++;
          return;
        }
        const v = view[e.who], a = actorOf(e.who), play = skillPlay[e.who]?.[e.skillId];
        if (!h.skipInline) {
          if (v && a) {
            if (!playGridOnce(v, play?.animGrid)) playAttack(e.who, a);
            spawnEffects(e.who, play?.effects);
          }
          if (!floatIcon(e.who, e.skillId)) floatText(e.who, e.name + (e.elite ? " \u2605" : ""), 16769357);
          if (e.combo === "dual") floatText(e.who, "\u2726", GOLD);
        }
      } else if (e.kind === "swing") {
        if (!e.skillId) playAttack(e.who, actorOf(e.who));
      } else if (e.kind === "shoot") {
        if (!e.skillId) playAttack(e.who, actorOf(e.who));
      } else if (e.kind === "hit" && e.amount > 0) {
        const v = view[e.who];
        if (v) v.flash = 130;
        playHurt(e.who, actorOf(e.who));
        hooks.onHit?.(e);
        e.empowered ? floatText(e.who, "-" + e.amount + "!", GOLD, { big: true }) : floatText(e.who, "-" + e.amount, 16743018);
      } else if (e.kind === "heal" && e.amount > 0) e.empowered ? floatText(e.who, "+" + e.amount + "!", GOLD, { big: true }) : floatText(e.who, "+" + e.amount, 9429896);
      else if (e.kind === "cond" && e.empowered) floatText(e.who, (e.cond === "interrupted" ? "INTERRUPT" : String(e.cond).toUpperCase()) + "!", GOLD, { big: true });
      else if (e.kind === "empower") flagEmpower(e.who);
      else if (e.kind === "miss") floatText(e.who, "dodge", 10405352);
      else if (e.kind === "death") {
        playDie(e.who, actorOf(e.who));
        hooks.onDeath?.(e);
      }
    }
  }
  return {
    view,
    floats,
    actorOf,
    skillPlay,
    addActor,
    removeActor: removeActor2,
    setLoop,
    playOnce,
    resume,
    playAttack,
    playHurt,
    playDie,
    playGridOnce,
    spawnEffects,
    floatText,
    floatIcon,
    flagEmpower,
    spawnEcho,
    drawBars,
    drawStatus,
    resetForNewBattle,
    syncActors,
    updateFloats,
    drawProjectiles,
    processLog
  };
}

// ../auto-battler/src/engine/range.js
var MELEE_GW = 144;
var BASIC_MELEE_GW = MELEE_GW / 2;
var BOW_GW = 1e3;

// ../auto-battler/src/engine/teamBattle.js
var byId = Object.fromEntries(CB_SKILLS.map((s) => [s.id, s]));
var skillById = (id) => byId[id] || null;
var FIELD = { w: 1e3, h: 600 };
var FORMATION = [
  { x: 0.31, y: 0.66 },
  { x: 0.47, y: 0.74 },
  { x: 0.13, y: 0.73 },
  { x: 0.28, y: 0.82 },
  { x: 0.44, y: 0.91 }
];
var HIT_TOLERANCE = 130;
function val(v, rank = 12) {
  if (typeof v === "number") return v;
  if (v == null) return 0;
  if (v.fixed != null) return v.fixed;
  if (v.scale) {
    const [a, b] = v.scale;
    return Math.round(a + (b - a) * rank / 15);
  }
  return 0;
}
var DEGEN = { bleeding: 4, poison: 4, burning: 8, disease: 4 };
var ATTACK_CATEGORIES = ["melee_attack", "bow_attack", "lead_attack", "offhand_attack", "dual_attack", "scythe_attack", "spear_attack"];
var isAttack = (s) => ATTACK_CATEGORIES.includes(s.category);
var CLASS_TEMPLATES = {
  Warrior: { maxHp: 520, role: "melee", weapon: { min: 15, max: 22, interval: 1.5, range: BASIC_MELEE_GW }, moveSpeed: 130, maxEnergy: 25, energyRegen: 0.5, armor: 80 },
  Assassin: { maxHp: 480, role: "melee", weapon: { min: 7, max: 17, interval: 1.33, range: BASIC_MELEE_GW }, moveSpeed: 175, maxEnergy: 30, energyRegen: 1.2, armor: 55 },
  Ranger: { maxHp: 430, role: "ranged", weapon: { min: 12, max: 28, interval: 1.9, range: BOW_GW, projSpeed: 850 }, moveSpeed: 155, preferredRange: 620, maxEnergy: 35, energyRegen: 1, armor: 45 },
  Monk: { maxHp: 470, role: "melee", weapon: { min: 8, max: 14, interval: 1.6, range: BASIC_MELEE_GW }, moveSpeed: 140, maxEnergy: 40, energyRegen: 1.4, armor: 60 },
  Necromancer: { maxHp: 450, role: "ranged", weapon: { min: 10, max: 20, interval: 1.8, range: BOW_GW, projSpeed: 720 }, moveSpeed: 140, preferredRange: 520, maxEnergy: 35, energyRegen: 1, armor: 45 }
};
var DEFAULT_TEMPLATE = { maxHp: 300, role: "melee", weapon: { min: 10, max: 16, interval: 1.5, range: BASIC_MELEE_GW }, moveSpeed: 150, maxEnergy: 30, energyRegen: 1, armor: 50 };
function templateFor(unit) {
  if (unit.template) return unit.template;
  if (unit.profession && CLASS_TEMPLATES[unit.profession]) return CLASS_TEMPLATES[unit.profession];
  if (unit.stats) {
    const s = unit.stats;
    const basic = s.basicDamage ?? 12;
    const ranged = unit.attackType === "ranged";
    return {
      maxHp: s.hp ?? 100,
      role: ranged ? "ranged" : "melee",
      armor: s.armor ?? 40,
      moveSpeed: 150,
      maxEnergy: 30,
      energyRegen: 1,
      preferredRange: ranged ? 600 : void 0,
      weapon: {
        min: Math.max(1, Math.round(basic * 0.8)),
        max: Math.round(basic * 1.3),
        interval: 1.4,
        range: ranged ? BOW_GW : BASIC_MELEE_GW,
        ...ranged ? { projSpeed: 800 } : {}
      }
    };
  }
  return DEFAULT_TEMPLATE;
}
function makeActor(unit, team, id, slot) {
  const tpl = templateFor(unit);
  const hpMul = unit.hpMul ?? unit.statMul ?? 1;
  const dmgMul = unit.dmgMul ?? unit.statMul ?? 1;
  const maxHp = Math.max(1, Math.round(tpl.maxHp * hpMul));
  const rangeMul = unit.rangeMul ?? 1;
  const ranged = tpl.role === "ranged";
  const weapon = { ...tpl.weapon, min: Math.max(1, Math.round(tpl.weapon.min * dmgMul)), max: Math.max(1, Math.round(tpl.weapon.max * dmgMul)), range: Math.round((tpl.weapon.range ?? 0) * (ranged ? rangeMul : 1)) };
  const preferredRange = tpl.preferredRange != null ? Math.round(tpl.preferredRange * rangeMul) : void 0;
  const p = FORMATION[slot % FORMATION.length];
  const pt = team === "player" ? { x: p.x, y: p.y } : { x: 1 - p.x, y: 1 - p.y };
  const bar = (unit.skills || []).map((s) => s && typeof s === "object" ? s : skillById(s)).filter(Boolean);
  return {
    id,
    team,
    name: unit.name || id,
    profession: unit.profession || null,
    // control: 'ai' (autonomous), 'player' (driven by b.input via setInput) or
    // 'dummy' (passive target — takes damage, never acts). Sandboxes use the
    // latter two so the Classes/Enemies hero fights real engine dummies.
    control: unit.control || "ai",
    role: tpl.role,
    rank: unit.rank ?? 12,
    armor: tpl.armor ?? 0,
    weapon,
    moveSpeed: Math.round(tpl.moveSpeed * (unit.speedMul ?? 1)),
    preferredRange,
    radius: radiusOf(unit, tpl),
    maxEnergy: tpl.maxEnergy,
    energyRegen: tpl.energyRegen,
    baseMaxHp: maxHp,
    maxHp,
    hp: maxHp,
    energy: tpl.maxEnergy,
    adrenaline: 0,
    bar,
    x: pt.x * FIELD.w,
    y: pt.y * FIELD.h,
    facing: team === "player" ? 1 : -1,
    faceX: team === "player" ? 1 : -1,
    faceY: team === "player" ? -1 : 1,
    // players look up-right, enemies down-left
    attackTimer: tpl.weapon.interval,
    casting: null,
    recharge: {},
    conds: [],
    marks: {},
    prep: null,
    alive: true,
    mods: [],
    kd: 0,
    aggroRadius: unit.aggroRadius ?? null,
    // optional: idle until a foe is within this distance (else always engage)
    noKite: !!unit.noKite
    // ranged: hold ground in range instead of backing away (kiting)
  };
}
function makeTeamBattle({ seed = 1, players = [], enemies = [], sandbox = false, respawnDummies = 0, freeCast = false, world = null, field = null } = {}) {
  const actors = [];
  players.filter(Boolean).slice(0, 5).forEach((u, i) => actors.push(makeActor(u, "player", `P${i}`, i)));
  enemies.filter(Boolean).slice(0, 5).forEach((u, i) => actors.push(makeActor(u, "enemy", `E${i}`, i)));
  return { t: 0, rng: makeRng(seed), actors, projectiles: [], log: [], over: false, winner: null, sandbox, respawnDummies, freeCast, input: {}, world, field: field || FIELD };
}
function spawnActor(b, unit, team, id) {
  const a = makeActor(unit, team, id, 0);
  a.attackTimer = a.weapon.interval;
  b.actors.push(a);
  return a;
}
function removeActor(b, id) {
  const i = b.actors.findIndex((a) => a.id === id);
  if (i >= 0) b.actors.splice(i, 1);
}
function setInput(b, id, cmd) {
  if (!b.input) b.input = {};
  b.input[id] = { ...b.input[id] || {}, ...cmd };
}
var ADJACENT_GW = 140;
var BODY_RADIUS = { melee: 35, ranged: 32 };
var DEFAULT_RADIUS = 32;
var DEOVERLAP_ITERS = 3;
var DEOVERLAP_FRACTION = 0.5;
var CONTACT_SLOP = 2;
var MAX_BATTLE_T = 90;
var COLLISION_Y_WEIGHT = 3.2;
var radiusOf = (unit, tpl) => unit.template?.radius ?? unit.stats?.radius ?? tpl.radius ?? BODY_RADIUS[tpl.role] ?? DEFAULT_RADIUS;
var edgeGap = (a, t) => dist2(a, t) - (a.radius || 0) - (t.radius || 0);
var MELEE_REACH = 2;
var reachOf = (a) => a.role === "ranged" ? a.weapon.range : MELEE_REACH;
var SPELL_RANGE = 900;
var ARMOR_IGNORING = /* @__PURE__ */ new Set(["shadow", "holy", "dark", "chaos"]);
var dist2 = (a, e) => Math.hypot(a.x - e.x, a.y - e.y);
var hasCond = (a, type) => a.conds.some((c) => c.type === type);
var isKd = (b, a) => a.kd > b.t;
var gainAdr = (a, n) => {
  a.adrenaline = Math.min(25, a.adrenaline + n);
};
var livingFoes = (b, a) => b.actors.filter((x) => x.alive && x.team !== a.team);
var alliesOf = (b, a) => b.actors.filter((x) => x.alive && x.team === a.team);
function nearestFoe(b, a) {
  let best = null, bd = Infinity;
  for (const x of livingFoes(b, a)) {
    const d = dist2(a, x);
    if (d < bd) {
      bd = d;
      best = x;
    }
  }
  return best;
}
function mostWoundedAlly(b, a, includeSelf = true) {
  let best = null, bf = Infinity;
  for (const x of alliesOf(b, a)) {
    if (!includeSelf && x === a) continue;
    const f = x.hp / x.maxHp;
    if (f < bf) {
      bf = f;
      best = x;
    }
  }
  return best;
}
var adjacentTo = (b, tgt) => b.actors.filter((x) => x.alive && x.team === tgt.team && x !== tgt && dist2(x, tgt) <= ADJACENT_GW);
var addMod = (b, a, m) => a.mods.push({ until: b.t + (m.dur ?? 0), ...m });
var activeMods = (b, a, kind) => a.mods.filter((m) => m.kind === kind && m.until > b.t);
var hasModKind = (b, a, kind) => a.mods.some((m) => m.kind === kind && m.until > b.t);
var sumRegenPips = (b, a) => activeMods(b, a, "regen").reduce((n, m) => n + m.pips, 0);
var bonusArmor = (b, a) => activeMods(b, a, "armor").reduce((n, m) => n + m.amount, 0);
var attackSpeedMult = (b, a) => activeMods(b, a, "attackSpeed").reduce((n, m) => n * m.mult, 1);
var moveSpeedMult = (b, a) => (hasCond(a, "crippled") ? 0.5 : 1) * activeMods(b, a, "moveSpeed").reduce((n, m) => n * m.mult, 1);
var hasHex = (b, a) => hasModKind(b, a, "hex");
var countCat = (b, a, kinds) => a.mods.filter((m) => m.until > b.t && kinds.includes(m.cat)).length;
var mitigate = (dmg, armor) => dmg * (100 / (100 + (armor || 0)));
function log(b, kind, who, extra = {}) {
  b.log.push({ t: Math.round(b.t * 100) / 100, kind, who: who?.id, ...extra });
}
function applyCondition(b, tgt, type, dur, empowered) {
  if (!tgt.alive) return;
  const ex = tgt.conds.find((c) => c.type === type);
  if (ex) {
    ex.until = Math.max(ex.until, b.t + dur);
    return;
  }
  tgt.conds.push({ type, until: b.t + dur });
  if (type === "deepWound") {
    tgt.maxHp = Math.round(tgt.baseMaxHp * 0.8);
    if (tgt.hp > tgt.maxHp) tgt.hp = tgt.maxHp;
  }
  log(b, "cond", tgt, { cond: type, amount: Math.round(dur), ...empowered ? { empowered: true } : {} });
}
function expireConds(b, a) {
  for (const c of a.conds) if (c.until <= b.t && c.type === "deepWound") a.maxHp = a.baseMaxHp;
  a.conds = a.conds.filter((c) => c.until > b.t);
  for (const m of a.mods) if (m.kind === "onEnd" && m.until <= b.t && !m.fired) {
    m.fired = true;
    const src = b.actors.find((x) => x.id === m.srcId) || a;
    for (const e of m.payload || []) applyEffect(b, src, a, e, "spell");
  }
  a.mods = a.mods.filter((m) => m.until > b.t);
}
function healActor(b, a, amount, empowered) {
  if (!a.alive || amount <= 0) return;
  a.hp = Math.min(a.maxHp, a.hp + Math.round(amount));
  log(b, "heal", a, { amount: Math.round(amount), ...empowered ? { empowered: true } : {} });
}
function dealDamage(b, src, tgt, amount, label, opts = {}) {
  if (!tgt.alive) return 0;
  if (tgt.invulnUntil && b.t < tgt.invulnUntil) {
    log(b, "miss", tgt, { name: label });
    return 0;
  }
  const { damageType = "physical", delivery = "spell", armorIgnoring = false, empowered = false } = opts;
  const physical = delivery === "melee" || delivery === "projectile";
  if (physical) {
    const blk = blockRoll(b, tgt, delivery);
    if (blk) {
      if (blk.reflect && delivery === "melee") dealDamage(b, tgt, src, blk.reflect, "reflect", { delivery: "spell", armorIgnoring: true });
      log(b, "miss", tgt, { name: label });
      return 0;
    }
  }
  let dmg = amount;
  if (physical) {
    for (const m of activeMods(b, tgt, "amplify")) if (m.vs === "physical") dmg += m.amount;
  }
  if (!(armorIgnoring || ARMOR_IGNORING.has(damageType))) dmg = mitigate(dmg, tgt.armor + bonusArmor(b, tgt));
  const cap = activeMods(b, tgt, "cap")[0];
  if (cap) dmg = Math.min(dmg, cap.fraction * tgt.maxHp);
  const conv = activeMods(b, tgt, "convert").find((m) => m.charges > 0);
  if (conv) {
    healActor(b, tgt, Math.min(dmg, conv.cap));
    conv.charges--;
    dmg = 0;
  }
  for (const m of activeMods(b, tgt, "onIncomingHeal")) {
    if (m.charges > 0 && dmg > m.threshold) {
      healActor(b, tgt, m.amount);
      m.charges--;
    }
  }
  dmg = Math.max(0, Math.round(dmg));
  tgt.hp -= dmg;
  log(b, "hit", tgt, { src: src.id, amount: dmg, name: label, ...empowered ? { empowered: true } : {} });
  gainAdr(tgt, 1);
  if (physical) {
    for (const m of activeMods(b, tgt, "armor")) if (m.attacksLeft != null && --m.attacksLeft <= 0) m.until = b.t;
    fireTrigger(b, tgt, "onPhysicalHit");
  }
  if (tgt.hp <= 0) kill(b, tgt);
  return dmg;
}
function blockRoll(b, tgt, delivery) {
  for (const m of activeMods(b, tgt, "block")) {
    if (m.vs === "all" || m.vs === delivery) {
      if (b.rng() < m.chance) return m;
    }
  }
  return null;
}
function kill(b, a) {
  if (!a.alive) return;
  a.alive = false;
  a.hp = 0;
  a.deadAt = b.t;
  log(b, "death", a);
  if (hasCond(a, "disease")) for (const x of adjacentTo(b, a)) applyCondition(b, x, "disease", 10);
}
function applyContainer(b, src, tgt, e) {
  const dur = val(e.duration, src.rank);
  const cat = e.op;
  const p = e.payload?.[0] || {};
  if (e.op === "hex") addMod(b, tgt, { kind: "hex", cat, dur });
  for (const m of tgt.mods) if (m.endsOnHexEnchant && m.until > b.t) m.until = b.t;
  if (p.op === "amplify_damage") {
    addMod(b, tgt, { kind: "amplify", cat, vs: p.vs || "physical", amount: val(p.amount, src.rank), dur });
    return;
  }
  if (p.op === "cap_damage") {
    addMod(b, tgt, { kind: "cap", cat, fraction: p.maxFraction, dur });
    return;
  }
  if (p.op === "convert_damage_to_heal") {
    addMod(b, tgt, { kind: "convert", cat, cap: val(p.cap, src.rank), charges: e.charges ?? 1, dur });
    return;
  }
  if (e.trigger === "on_end") {
    addMod(b, tgt, { kind: "onEnd", cat, payload: e.payload, srcId: src.id, srcRank: src.rank, dur });
    return;
  }
  if (e.trigger === "on_incoming_damage" && p.op === "heal") {
    addMod(b, tgt, { kind: "onIncomingHeal", cat, amount: val(p.amount, src.rank), threshold: e.threshold?.perHitDamageOver ?? 0, charges: e.charges ?? 1, dur });
    return;
  }
  if (e.trigger === "on_action") {
    addMod(b, tgt, { kind: "onAction", cat, payload: e.payload, srcId: src.id, srcRank: src.rank, dur });
    return;
  }
  if (e.trigger === "on_physical_hit") {
    addMod(b, tgt, { kind: "onPhysicalHit", cat, payload: e.payload, srcId: src.id, srcRank: src.rank, dur });
    return;
  }
  addMod(b, tgt, { kind: "enchant", cat, dur });
}
function fireTrigger(b, a, kind) {
  for (const m of activeMods(b, a, kind)) {
    const fakeSrc = b.actors.find((x) => x.id === m.srcId) || { id: m.srcId, rank: m.srcRank };
    for (const e of m.payload || []) applyEffect(b, fakeSrc, a, e, "spell");
  }
}
function resolveScope(b, src, tgt, scope, range) {
  switch (scope) {
    case "self":
      return [src];
    case "party":
      return alliesOf(b, src);
    case "target_and_adjacent":
      return [tgt, ...adjacentTo(b, tgt)];
    case "adjacent_to_target":
      return adjacentTo(b, tgt);
    case "nearby":
    case "area":
      return [tgt, ...adjacentTo(b, tgt)];
    case "area_around_caster": {
      const r = range || 180;
      return b.actors.filter((x) => x.alive && x.team !== src.team && dist2(src, x) <= r);
    }
    default:
      return [tgt];
  }
}
function applyEffect(b, src, tgt, e, delivery = "spell", s = null) {
  if (e.if && !branchOk(b, e.if, src, tgt)) return;
  if (e.if && s) logEmpower(b, src, tgt, s, empowerLabel(e, src.rank), reasonOf(e.if));
  const emp = !!e.if;
  const targets = resolveScope(b, src, tgt, e.scope, e.range);
  for (const t of targets) {
    if (!t || !t.alive) continue;
    const dur = e.duration != null ? val(e.duration, src.rank) : 0;
    switch (e.op) {
      case "damage": {
        const amt = val(e.amount, src.rank);
        const n = e.projectiles || 0;
        if (n > 1 || e.delivery === "projectile_spell") fireSpellProjectiles(b, src, t, amt, e, n || 1);
        else dealDamage(b, src, t, amt, src.name || "spell", { damageType: e.damageType, delivery, empowered: emp });
        break;
      }
      case "life_steal": {
        const dealt = dealDamage(b, src, t, val(e.amount, src.rank), src.name || "steal", { delivery, armorIgnoring: true });
        healActor(b, src, dealt);
        break;
      }
      case "heal": {
        let amt = val(e.amount, src.rank);
        let scaled = 0;
        if (e.plusPerMod) {
          scaled = countCat(b, t, e.plusPerMod.kinds) * val(e.plusPerMod.amount, src.rank);
          amt += scaled;
        }
        if (s && scaled > 0) logEmpower(b, src, t, s, `+${scaled} heal`, `${countCat(b, t, e.plusPerMod.kinds)} effects`);
        healActor(b, t, amt, emp || scaled > 0);
        break;
      }
      case "apply_condition":
        applyCondition(b, t, e.condition, dur, emp);
        break;
      case "knockdown":
        t.kd = Math.max(t.kd, b.t + dur);
        t.casting = null;
        break;
      case "interrupt":
        if (t.casting) {
          t.casting = null;
          log(b, "cond", t, { cond: "interrupted", amount: 0, ...emp ? { empowered: true } : {} });
        }
        break;
      case "regen_mod":
        addMod(b, t, { kind: "regen", pips: val(e.pips, src.rank), dur });
        break;
      case "attack_speed":
        addMod(b, t, { kind: "attackSpeed", mult: e.mult, dur });
        break;
      case "armor_mod":
        addMod(b, t, { kind: "armor", amount: val(e.amount, src.rank), attacksLeft: e.attacksLeft, dur });
        break;
      case "move_speed":
        addMod(b, src, { kind: "moveSpeed", mult: e.mult, endsOnHexEnchant: e.endsOnHexEnchant, dur });
        break;
      case "block":
        addMod(b, src, { kind: "block", chance: e.chance, vs: e.vs || "all", reflect: e.reflect ? val(e.reflect, src.rank) : 0, endsOnHexEnchant: e.endsOnHexEnchant, dur });
        break;
      case "shadow_step":
        shadowStep(b, src, t);
        break;
      case "set_combo_mark":
        src.marks[t.id] = { stage: e.stage, until: b.t + 20 };
        break;
      case "lose_all_adrenaline":
        src.adrenaline = 0;
        break;
      case "preparation":
        src.prep = { on_attack: e.on_attack, until: b.t + dur };
        break;
      case "hex":
      case "enchant":
        applyContainer(b, src, t, e);
        break;
      default:
        break;
    }
  }
}
function shadowStep(b, a, tgt) {
  const f = b.field || FIELD;
  const dx = a.x - tgt.x, dy = a.y - tgt.y, len = Math.hypot(dx, dy) || 1;
  a.x = Math.max(0, Math.min(f.w, tgt.x + dx / len * (BASIC_MELEE_GW * 0.8)));
  a.y = Math.max(0, Math.min(f.h, tgt.y + dy / len * (BASIC_MELEE_GW * 0.8)));
}
function fireSpellProjectiles(b, src, tgt, amt, e, n) {
  const base = dist2(src, tgt) / 900;
  for (let i = 0; i < n; i++) {
    b.projectiles.push({
      srcId: src.id,
      tgtId: tgt.id,
      aimX: tgt.x,
      aimY: tgt.y,
      bornT: b.t,
      hitT: b.t + base + i * 0.1,
      spell: true,
      amount: amt,
      damageType: e.damageType,
      label: src.name || "spell"
    });
  }
  log(b, "shoot", src, { name: src.name });
}
function branchOk(b, req, a, tgt) {
  if (req.target_below_health != null) return tgt.hp / tgt.maxHp < req.target_below_health;
  if (req.target_health_above_self) return tgt.hp > a.hp;
  if (req.target === "bleeding") return hasCond(tgt, "bleeding");
  if (req.target === "casting_spell") return !!tgt.casting;
  if (req.target === "moving") return !!tgt.moving;
  if (req.target === "knocked_down") return isKd(b, tgt);
  if (req.target === "hexed") return hasHex(b, tgt);
  if (req.target === "attacking") return tgt.attackedAt != null && b.t - tgt.attackedAt < 1.2;
  if (req.self === "enchanted") return hasModKind(b, a, "cap") || hasModKind(b, a, "convert");
  return true;
}
function reasonOf(req) {
  if (!req) return "";
  if (req.target_below_health != null) return `foe <${req.target_below_health * 100}%`;
  if (req.target_health_above_self) return "foe has more HP";
  if (req.target === "bleeding") return "foe Bleeding";
  if (req.target === "casting_spell") return "foe casting";
  if (req.target === "moving") return "foe moving";
  if (req.target === "knocked_down") return "knocked down";
  if (req.target === "hexed") return "foe hexed";
  if (req.target === "attacking") return "foe attacking";
  return "";
}
function empowerLabel(e, rank) {
  switch (e.op) {
    case "bonus_damage":
    case "damage":
      return `+${val(e.amount, rank)} dmg`;
    case "apply_condition":
      return `+${e.condition}`;
    case "heal":
      return `+${val(e.amount, rank)} heal`;
    case "interrupt":
      return "INTERRUPT";
    default:
      return "bonus";
  }
}
function logEmpower(b, src, tgt, s, label, reason) {
  log(b, "empower", src, { tgt: tgt?.id, skillId: s?.id, name: s?.name, label, reason });
}
function strike(b, a, enemy, s) {
  a.attackTimer = a.weapon.interval * attackSpeedMult(b, a);
  a.attackedAt = b.t;
  if (hasCond(a, "blind") && b.rng() < 0.9) {
    if (a.role !== "ranged") log(b, "swing", a, { name: s ? s.name : "attack" });
    log(b, "miss", enemy, { name: s ? s.name : "attack" });
    return;
  }
  let weaponDmg = a.weapon.min + b.rng() * (a.weapon.max - a.weapon.min);
  if (hasCond(a, "weakness")) weaponDmg *= 0.75;
  let bonus = 0, empEffect = null;
  if (s) {
    for (const e of s.effects) if (e.op === "bonus_damage" && (!e.if || branchOk(b, e.if, a, enemy))) {
      bonus += val(e.amount, a.rank);
      if (e.if) empEffect = e;
    }
  }
  if (a.role === "ranged") {
    const flight = dist2(a, enemy) / (a.weapon.projSpeed || 800);
    b.projectiles.push({ srcId: a.id, tgtId: enemy.id, fromX: a.x, fromY: a.y, aimX: enemy.x, aimY: enemy.y, bornT: b.t, hitT: b.t + flight, weaponDmg, bonus, s, empEffect });
    log(b, "shoot", a, { name: s ? s.name : "shot", skillId: s?.id });
  } else {
    log(b, "swing", a, { name: s ? s.name : "attack" });
    applyHit(b, a, enemy, s, weaponDmg, bonus, empEffect);
  }
}
function applyHit(b, a, enemy, s, weaponDmg, bonus, empEffect = null) {
  if (!enemy.alive) return;
  const delivery = a.role === "ranged" ? "projectile" : "melee";
  if (empEffect) logEmpower(b, a, enemy, s, empowerLabel(empEffect, a.rank), reasonOf(empEffect.if));
  dealDamage(b, a, enemy, weaponDmg + bonus, s ? s.name : "attack", { delivery, empowered: !!empEffect });
  if (s) {
    for (const e of s.effects) {
      if (e.op === "bonus_damage") continue;
      if (e.if && !branchOk(b, e.if, a, enemy)) continue;
      const emp = !!e.if;
      if (emp && e.op !== "damage") logEmpower(b, a, enemy, s, empowerLabel(e, a.rank), reasonOf(e.if));
      switch (e.op) {
        case "apply_condition":
          for (const t of resolveScope(b, a, enemy, e.scope)) applyCondition(b, t, e.condition, val(e.duration, a.rank), emp);
          break;
        case "set_combo_mark":
          a.marks[enemy.id] = { stage: e.stage, until: b.t + 20 };
          break;
        case "lose_all_adrenaline":
          a.adrenaline = 0;
          break;
        case "knockdown":
          enemy.kd = Math.max(enemy.kd, b.t + val(e.duration, a.rank));
          enemy.casting = null;
          break;
        case "interrupt":
          if (enemy.casting) {
            enemy.casting = null;
            log(b, "cond", enemy, { cond: "interrupted", amount: 0, ...emp ? { empowered: true } : {} });
          }
          break;
        case "damage":
          applyEffect(b, a, enemy, e, "melee", s);
          break;
        default:
          break;
      }
    }
    if (s.category === "dual_attack") delete a.marks[enemy.id];
  }
  if (a.prep && a.prep.until > b.t) for (const e of a.prep.on_attack) {
    if (e.op === "apply_condition") applyCondition(b, enemy, e.condition, val(e.duration, a.rank));
  }
  gainAdr(a, 1);
}
function advanceProjectiles(b) {
  const live = [];
  for (const p of b.projectiles) {
    if (b.t < p.hitT) {
      live.push(p);
      continue;
    }
    const src = b.actors.find((x) => x.id === p.srcId);
    const tgt = b.actors.find((x) => x.id === p.tgtId);
    if (!src || !tgt || !tgt.alive) continue;
    if (Math.hypot(tgt.x - p.aimX, tgt.y - p.aimY) > HIT_TOLERANCE) {
      log(b, "miss", tgt, { name: p.label || p.s?.name || "shot" });
      continue;
    }
    if (p.spell) dealDamage(b, src, tgt, p.amount, p.label, { damageType: p.damageType, delivery: "spell" });
    else applyHit(b, src, tgt, p.s, p.weaponDmg, p.bonus, p.empEffect);
  }
  b.projectiles = live;
}
var fireOnAction = (b, a) => fireTrigger(b, a, "onAction");
function applyActivationPenalty(b, a, s, cast) {
  for (const e of s.whileActivating || []) {
    if (e.op === "armor_mod") addMod(b, a, { kind: "armor", amount: val(e.amount, a.rank), dur: cast });
  }
}
var COMBO_STAGE = { lead_attack: "lead", offhand_attack: "offhand", dual_attack: "dual" };
function performSkill(b, a, tgt, s) {
  if (s.cost?.energy) a.energy -= s.cost.energy;
  if (s.cost?.adrenaline) a.adrenaline -= s.cost.adrenaline;
  if (s.cost?.sacrifice) a.hp = Math.max(1, a.hp - Math.round(a.maxHp * s.cost.sacrifice / 100));
  log(b, "cast", a, { name: s.name, elite: !!s.elite, skillId: s.id, tgt: tgt.id, ...COMBO_STAGE[s.category] ? { combo: COMBO_STAGE[s.category] } : {} });
  a.recharge[s.name] = b.t + (s.recharge || 0);
  fireOnAction(b, a);
  if (isAttack(s)) {
    strike(b, a, tgt, s);
    return;
  }
  for (const e of s.effects) applyEffect(b, a, tgt, e, "spell", s);
}
var isSupport = (s) => !!s && ["self", "ally", "other_ally", "party"].includes(s.target);
var enchantModKind = (e) => {
  const p = e.payload?.[0] || {};
  if (p.op === "cap_damage") return "cap";
  if (p.op === "convert_damage_to_heal") return "convert";
  if (e.trigger === "on_incoming_damage") return "onIncomingHeal";
  return null;
};
function skillTarget(b, a, s, foe) {
  if (s.target === "self" || s.target === "party") return a;
  if (s.target === "ally") return mostWoundedAlly(b, a, true);
  if (s.target === "other_ally") return mostWoundedAlly(b, a, false);
  return foe;
}
function usable(b, a, s, tgt, foe, free = false) {
  if (!tgt) return false;
  if (free) return true;
  if (b.t < (a.recharge[s.name] || 0)) return false;
  if (s.cost?.energy && a.energy < s.cost.energy) return false;
  if (s.cost?.adrenaline && a.adrenaline < s.cost.adrenaline) return false;
  if (isAttack(s) && edgeGap(a, foe) > reachOf(a)) return false;
  if (!isAttack(s) && !isSupport(s) && dist2(a, foe) > SPELL_RANGE) return false;
  for (const r of s.requires || []) {
    if (r === "on_hit") continue;
    if (r.combo_follows && a.marks[foe.id]?.stage !== r.combo_follows) return false;
    if (r.target === "bleeding" && !hasCond(foe, "bleeding")) return false;
    if (r.target === "casting_spell" && !foe.casting) return false;
    if (r.target === "moving" && !foe.moving) return false;
    if (r.target === "knocked_down" && !isKd(b, foe)) return false;
  }
  if (s.effects.some((e) => e.op === "preparation") && a.prep && a.prep.until > b.t) return false;
  if (isSupport(s)) {
    if (s.effects.some((e) => e.op === "heal") && tgt.hp / tgt.maxHp >= 0.7 && s.effects.every((e) => e.op === "heal" || e.op === "shadow_step")) return false;
    for (const e of s.effects) {
      if (e.op === "enchant") {
        const k = enchantModKind(e);
        if (k && hasModKind(b, tgt, k)) return false;
      }
      const selfBuffKind = { block: "block", armor_mod: "armor", regen_mod: "regen", attack_speed: "attackSpeed", move_speed: "moveSpeed" }[e.op];
      if (selfBuffKind && hasModKind(b, a, selfBuffKind)) return false;
    }
  } else {
    const meaningful = s.effects.filter((e) => e.op !== "set_combo_mark" && e.op !== "preparation");
    if (meaningful.length && meaningful.every((e) => e.op === "apply_condition" && hasCond(foe, e.condition))) return false;
  }
  return true;
}
function chooseAction(b, a, foe) {
  for (const s of a.bar) {
    const tgt = skillTarget(b, a, s, foe);
    if (usable(b, a, s, tgt, foe)) return { skill: s, target: tgt };
  }
  return null;
}
function moveActor(b, a, enemy, dt) {
  const d = dist2(a, enemy);
  let toward = 0;
  if (a.role === "ranged") {
    if (a.noKite) toward = d > a.weapon.range ? 1 : 0;
    else if (d < (a.preferredRange ?? a.weapon.range * 0.7)) toward = -1;
    else if (d > a.weapon.range) toward = 1;
  } else if (edgeGap(a, enemy) > reachOf(a)) {
    toward = 1;
  }
  if (!toward) {
    a.vx = 0;
    a.vy = 0;
    return;
  }
  const speed = a.moveSpeed * moveSpeedMult(b, a);
  const dx = enemy.x - a.x, dy = enemy.y - a.y, len = Math.hypot(dx, dy) || 1;
  const desVx = dx / len * speed * toward, desVy = dy / len * speed * toward;
  const [vx, vy] = avoidVelocity(b, a, enemy, desVx, desVy, speed);
  const px = a.x, py = a.y;
  stepMove(b, a, vx, vy, dt);
  a.vx = vx;
  a.vy = vy;
  a.moving = b.world ? a.x !== px || a.y !== py : true;
}
var RVO_TAU = 1.6;
var RVO_RANGE = 280;
var RVO_W = 240;
var RVO_ANGLES = [0, 0.3, -0.3, 0.62, -0.62, 0.98, -0.98, 1.4, -1.4];
var RVO_SPEEDS = [1, 0.6];
function avoidVelocity(b, a, enemy, desVx, desVy, speed) {
  const KY = COLLISION_Y_WEIGHT;
  const obs = [];
  for (const o of b.actors) {
    if (o === a || !o.alive || o === enemy) continue;
    const rpx = o.x - a.x, rpy = (o.y - a.y) * KY;
    if (rpx * rpx + rpy * rpy > RVO_RANGE * RVO_RANGE) continue;
    obs.push({ rpx, rpy, ovx: o.vx || 0, ovy: (o.vy || 0) * KY, R: a.radius + o.radius });
  }
  if (!obs.length) return [desVx, desVy];
  const baseAng = Math.atan2(desVy, desVx);
  let best = [desVx, desVy], bestPen = Infinity;
  for (const da of RVO_ANGLES) {
    const ang = baseAng + da, cs = Math.cos(ang), sn = Math.sin(ang);
    for (const sf of RVO_SPEEDS) {
      const cvx = cs * speed * sf, cvy = sn * speed * sf;
      const cvxw = cvx, cvyw = cvy * KY;
      let minTtc = Infinity;
      for (const o of obs) {
        const t = timeToHit(o.rpx, o.rpy, o.ovx - cvxw, o.ovy - cvyw, o.R);
        if (t < minTtc) minTtc = t;
      }
      const collPen = minTtc <= RVO_TAU ? RVO_W / Math.max(minTtc, 0.05) : 0;
      const dev = Math.hypot(cvx - desVx, cvy - desVy);
      const pen = collPen + dev;
      if (pen < bestPen) {
        bestPen = pen;
        best = [cvx, cvy];
      }
    }
  }
  return best;
}
function timeToHit(px, py, rvx, rvy, R) {
  const c = px * px + py * py - R * R;
  if (c <= 0) return 0;
  const a2 = rvx * rvx + rvy * rvy;
  if (a2 < 1e-6) return Infinity;
  const b2 = px * rvx + py * rvy;
  if (b2 >= 0) return Infinity;
  const disc = b2 * b2 - a2 * c;
  if (disc <= 0) return Infinity;
  return (-b2 - Math.sqrt(disc)) / a2;
}
var clampField = (v, r, max) => Math.max(r, Math.min(max - r, v));
function stepMove(b, a, vx, vy, dt) {
  const f = b.field || FIELD;
  const w = b.world && b.world.walkable;
  let nx = clampField(a.x + vx * dt, a.radius, f.w);
  let ny = clampField(a.y + vy * dt, a.radius, f.h);
  if (w) {
    if (!w(nx, a.y)) nx = a.x;
    if (!w(nx, ny)) ny = a.y;
  }
  a.x = nx;
  a.y = ny;
}
function resolveOverlaps(b) {
  const f = b.field || FIELD;
  const live = b.actors.filter((a) => a.alive);
  for (let it = 0; it < DEOVERLAP_ITERS; it++) {
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], o = live[j];
        const dx = o.x - a.x, dy = (o.y - a.y) * COLLISION_Y_WEIGHT;
        const d = Math.hypot(dx, dy) || 0.01;
        const overlap = a.radius + o.radius - d;
        if (overlap <= CONTACT_SLOP) continue;
        const ux = dx / d, uy = dy / d;
        const aFix = isImmovable(b, a), oFix = isImmovable(b, o);
        const push = overlap * DEOVERLAP_FRACTION;
        const aShare = aFix ? 0 : oFix ? 1 : 0.5;
        const oShare = oFix ? 0 : aFix ? 1 : 0.5;
        const yPush = uy / COLLISION_Y_WEIGHT;
        a.x = clampField(a.x - ux * push * aShare, a.radius, f.w);
        a.y = clampField(a.y - yPush * push * aShare, a.radius, f.h);
        o.x = clampField(o.x + ux * push * oShare, o.radius, f.w);
        o.y = clampField(o.y + yPush * push * oShare, o.radius, f.h);
      }
    }
  }
}
var isImmovable = (b, a) => !!a.casting || isKd(b, a);
function playerActionReason(b, a, action) {
  if (!a || !action) return null;
  const foe = nearestFoe(b, a);
  if (action === "basic") return !foe || edgeGap(a, foe) > reachOf(a) ? "no-target" : null;
  const s = a.bar.find((x) => x.id === action);
  if (!s) return null;
  if (s.cost?.adrenaline && a.adrenaline < s.cost.adrenaline) return "need-adrenaline";
  if (s.cost?.energy && a.energy < s.cost.energy) return "need-energy";
  if (b.t < (a.recharge[s.name] || 0)) return "recharging";
  const aoe = (s.effects || []).find((e) => e.scope === "area_around_caster");
  if (aoe) {
    const r = aoe.range || 180;
    return b.actors.some((x) => x.alive && x.team !== a.team && dist2(a, x) <= r) ? null : "no-target";
  }
  if (isAttack(s)) return !foe || edgeGap(a, foe) > reachOf(a) ? "no-target" : null;
  if (!isSupport(s)) return !foe || dist2(a, foe) > SPELL_RANGE ? "no-target" : null;
  return null;
}
function stepPlayer(b, a, foe, dt) {
  const cmd = b.input && b.input[a.id] || {};
  const mx = cmd.moveX || 0, my = cmd.moveY || 0;
  if (mx || my) {
    const len = Math.hypot(mx, my) || 1;
    const speed = a.moveSpeed * moveSpeedMult(b, a);
    const px = a.x, py = a.y;
    stepMove(b, a, mx / len * speed, my / len * speed, dt);
    a.moving = b.world ? a.x !== px || a.y !== py : true;
    a.faceX = mx < 0 ? -1 : mx > 0 ? 1 : a.faceX;
    a.faceY = my < 0 ? -1 : my > 0 ? 1 : a.faceY;
    a.facing = a.faceX;
  }
  if (a.casting) {
    a.casting.left -= dt;
    if (a.casting.left <= 0) {
      const { skill, target } = a.casting;
      a.casting = null;
      performSkill(b, a, target?.alive ? target : foe, skill);
    }
    return;
  }
  const action = cmd.action;
  if (!action) return;
  const free = !!b.freeCast;
  if (free) {
    a.energy = a.maxEnergy;
    a.adrenaline = 25;
  }
  const clear = () => {
    if (b.input) b.input[a.id] = { ...cmd, action: null };
  };
  if (action === "basic") {
    if (!free && a.role !== "ranged" && edgeGap(a, foe) > reachOf(a)) {
      clear();
      return;
    }
    fireOnAction(b, a);
    strike(b, a, foe, null);
    clear();
    return;
  }
  const s = a.bar.find((x) => x.id === action);
  if (!s) {
    clear();
    return;
  }
  const tgt = skillTarget(b, a, s, foe);
  if (!usable(b, a, s, tgt, foe, free)) return;
  const cast = (s.cast || 0) * (hasCond(a, "dazed") ? 2 : 1);
  if (cast <= 0) performSkill(b, a, tgt, s);
  else {
    applyActivationPenalty(b, a, s, cast);
    a.casting = { skill: s, target: tgt, left: cast };
  }
  clear();
}
function reviveDummy(b, a) {
  a.alive = true;
  a.hp = a.maxHp = a.baseMaxHp;
  a.energy = a.maxEnergy;
  a.adrenaline = 0;
  a.conds = [];
  a.marks = {};
  a.mods = [];
  a.casting = null;
  a.kd = 0;
  a.deadAt = null;
}
function step(b, dt) {
  if (b.over) return;
  b.t += dt;
  if (b.sandbox && b.respawnDummies) {
    for (const a of b.actors) if (!a.alive && a.control === "dummy" && a.deadAt != null && b.t - a.deadAt >= b.respawnDummies) reviveDummy(b, a);
  }
  for (const a of b.actors) {
    if (!a.alive) continue;
    a.energy = Math.min(a.maxEnergy, a.energy + a.energyRegen * dt);
    let degen = 0;
    for (const c of a.conds) if (c.until > b.t) degen += DEGEN[c.type] || 0;
    const rate = degen - sumRegenPips(b, a) * 2;
    if (rate) {
      a.hp = Math.min(a.maxHp, a.hp - rate * dt);
      if (a.hp <= 0) kill(b, a);
    }
    expireConds(b, a);
    a.attackTimer -= dt;
    for (const id of Object.keys(a.marks)) if (a.marks[id]?.until <= b.t) delete a.marks[id];
  }
  advanceProjectiles(b);
  for (const a of b.actors) {
    if (!a.alive || b.over) continue;
    const enemy = nearestFoe(b, a);
    if (!enemy && a.control !== "player") continue;
    if (a.aggroRadius != null && a.control !== "player" && dist2(a, enemy) > a.aggroRadius) {
      a.moving = false;
      continue;
    }
    if (enemy) {
      a.facing = enemy.x < a.x ? -1 : 1;
      a.faceX = a.facing;
      a.faceY = enemy.y < a.y ? -1 : 1;
    }
    a.moving = false;
    if (isKd(b, a)) {
      a.casting = null;
      continue;
    }
    if (a.control === "dummy") continue;
    if (a.control === "player") {
      stepPlayer(b, a, enemy, dt);
      continue;
    }
    if (a.casting) {
      a.casting.left -= dt;
      if (a.casting.left <= 0) {
        const { skill, target } = a.casting;
        a.casting = null;
        performSkill(b, a, target?.alive ? target : enemy, skill);
      }
      continue;
    }
    const action = chooseAction(b, a, enemy);
    if (action) {
      const cast = (action.skill.cast || 0) * (hasCond(a, "dazed") ? 2 : 1);
      if (cast <= 0) performSkill(b, a, action.target, action.skill);
      else {
        applyActivationPenalty(b, a, action.skill, cast);
        a.casting = { skill: action.skill, target: action.target, left: cast };
      }
    } else if (edgeGap(a, enemy) <= reachOf(a) && a.attackTimer <= 0) {
      fireOnAction(b, a);
      strike(b, a, enemy, null);
    } else {
      moveActor(b, a, enemy, dt);
    }
  }
  resolveOverlaps(b);
  if (b.sandbox) return;
  const playerAlive = b.actors.some((a) => a.alive && a.team === "player");
  const enemyAlive = b.actors.some((a) => a.alive && a.team === "enemy");
  if (!playerAlive || !enemyAlive) {
    b.over = true;
    b.winner = playerAlive ? "player" : enemyAlive ? "enemy" : null;
  } else if (b.t >= MAX_BATTLE_T) {
    const hp = (team) => b.actors.filter((a) => a.alive && a.team === team).reduce((n, a) => n + a.hp, 0);
    const ph = hp("player"), eh = hp("enemy");
    b.over = true;
    b.winner = ph === eh ? null : ph > eh ? "player" : "enemy";
  }
}

// ../auto-battler/src/render/emotes.js
var CELL = {
  happy: [6, 0],
  // smile — killed a foe / level-up payoff
  angry: [4, 2],
  // grr — took a hit
  surprised: [2, 3],
  // o-mouth
  dizzy: [5, 3],
  // red X eyes — stunned / dead
  sick: [2, 4],
  // queasy — bleeding/poison/burning
  sweat: [2, 5],
  // nervous drop — low HP
  love: [6, 5],
  // ❤ — level-up
  sleepy: [7, 5]
  // ♪ — idle, out of combat
};
async function createEmoteLayer(pixi, parent, { url, unit, sizeTiles = 1.3, headTiles = 1.15 }) {
  await pixi.Assets.load(url);
  const base = pixi.Texture.from(url);
  try {
    base.source.scaleMode = "nearest";
  } catch {
  }
  const sub4 = (c, r) => new pixi.Texture({ source: base.source, frame: new pixi.Rectangle(8 + 16 * c, 8 + 16 * r, 8, 8) });
  const tex = {};
  for (const k in CELL) tex[k] = sub4(CELL[k][0], CELL[k][1]);
  const layer = new pixi.Container();
  layer.zIndex = 5e8;
  parent.addChild(layer);
  const scale = unit * sizeTiles / 8;
  const active = /* @__PURE__ */ new Map();
  const enabled = () => {
    try {
      return localStorage.getItem("tinyarmy.emotes") !== "0";
    } catch {
      return true;
    }
  };
  function show(actorId, key, now, secs = 1.4) {
    if (!enabled() || !tex[key]) return;
    let e = active.get(actorId);
    if (!e) {
      const spr = new pixi.Sprite(tex[key]);
      spr.anchor.set(0.5, 1);
      layer.addChild(spr);
      e = { spr };
      active.set(actorId, e);
    }
    e.spr.texture = tex[key];
    e.until = now + secs;
    e.born = now;
  }
  function update(now, posOf) {
    for (const [id, e] of [...active]) {
      if (now >= e.until) {
        e.spr.destroy();
        active.delete(id);
        continue;
      }
      const p = posOf(id);
      if (!p) {
        e.spr.visible = false;
        continue;
      }
      const age = now - e.born, pop = Math.min(1, age / 0.1);
      e.spr.visible = true;
      e.spr.scale.set(scale * (0.5 + 0.5 * pop));
      e.spr.x = p.x;
      e.spr.y = p.y - headTiles * unit - Math.sin(Math.min(age, 0.25) / 0.25 * Math.PI) * 0.3 * unit;
    }
  }
  function clear(actorId) {
    const e = active.get(actorId);
    if (e) {
      e.spr.destroy();
      active.delete(actorId);
    }
  }
  function destroy() {
    for (const [, e] of active) {
      try {
        e.spr.destroy();
      } catch {
      }
    }
    active.clear();
    try {
      layer.destroy({ children: true });
    } catch {
    }
  }
  return { show, update, clear, destroy, keys: Object.keys(CELL) };
}

// ../auto-battler/src/render/skillVfx.js
function createSkillVfx(pixi, parent, { gScale = 1 } = {}) {
  const { Container, Graphics } = pixi;
  const layer = new Container();
  layer.zIndex = 6e8;
  parent.addChild(layer);
  const active = [];
  const hex = (s) => {
    const n = parseInt(String(s || "").replace("#", ""), 16);
    return Number.isFinite(n) ? n : 16777215;
  };
  const lwOf = (base) => base / gScale;
  function play(visual, x, y, radius, now, { aim } = {}) {
    const g = new Graphics();
    layer.addChild(g);
    active.push({ g, born: now, dur: 0.45 + (visual?.intensity || 2) * 0.13, shape: visual?.shape || "nova", color: hex(visual?.color), intensity: visual?.intensity || 2, x, y, radius: radius || 120, aim });
  }
  function update(now) {
    for (let i = active.length - 1; i >= 0; i--) {
      const e = active[i];
      const t = (now - e.born) / e.dur;
      if (t >= 1 || t < 0) {
        try {
          e.g.destroy();
        } catch {
        }
        active.splice(i, 1);
        continue;
      }
      draw(e, t);
    }
  }
  function draw(e, t) {
    const g = e.g;
    g.clear();
    const ease = 1 - Math.pow(1 - t, 2);
    const a = 1 - t;
    const lw = lwOf(2 + e.intensity);
    const c = e.color, R = e.radius;
    switch (e.shape) {
      case "ring":
      case "shockwave": {
        const r = R * ease;
        g.circle(e.x, e.y, r).stroke({ width: lw * 1.6, color: c, alpha: a * 0.95 });
        if (e.shape === "shockwave") g.circle(e.x, e.y, r * 0.66).stroke({ width: lw, color: c, alpha: a * 0.5 });
        break;
      }
      case "beam": {
        const aim = e.aim || { x: e.x + R, y: e.y };
        g.moveTo(e.x, e.y).lineTo(aim.x, aim.y).stroke({ width: lw * 2.4 * (1 - t * 0.5), color: c, alpha: a });
        g.circle(aim.x, aim.y, R * 0.18 * ease).fill({ color: c, alpha: a * 0.7 });
        break;
      }
      case "pillar": {
        const w = R * 0.5 * (1 - t * 0.3), h = R * 1.5;
        g.rect(e.x - w / 2, e.y - h, w, h).fill({ color: c, alpha: a * 0.32 });
        g.rect(e.x - w / 2, e.y - h, w, h).stroke({ width: lw, color: c, alpha: a * 0.85 });
        break;
      }
      case "projectile": {
        const r = R * ease;
        g.circle(e.x, e.y, Math.max(lwOf(4), R * 0.16)).fill({ color: c, alpha: a });
        g.circle(e.x, e.y, r).stroke({ width: lw, color: c, alpha: a * 0.4 });
        break;
      }
      case "slash": {
        const r = R * (0.6 + ease * 0.5);
        g.arc(e.x, e.y, r, -0.8 + t * 1.2, 0.8 + t * 1.2).stroke({ width: lw * 2, color: c, alpha: a });
        break;
      }
      case "nova":
      default: {
        const r = R * ease;
        g.circle(e.x, e.y, r).fill({ color: c, alpha: a * 0.22 });
        g.circle(e.x, e.y, r).stroke({ width: lw * 1.5, color: c, alpha: a * 0.9 });
        const spokes = e.intensity * 4;
        for (let k = 0; k < spokes; k++) {
          const ang = k / spokes * Math.PI * 2;
          g.moveTo(e.x, e.y).lineTo(e.x + Math.cos(ang) * r, e.y + Math.sin(ang) * r).stroke({ width: lw * 0.6, color: c, alpha: a * 0.5 });
        }
        break;
      }
    }
  }
  function destroy() {
    for (const e of active) {
      try {
        e.g.destroy();
      } catch {
      }
    }
    active.length = 0;
    try {
      layer.destroy({ children: true });
    } catch {
    }
  }
  return { play, update, destroy };
}

// ../auto-battler/src/render/comboBattler.js
var TILE8 = 8;
var SKILL_YELLOW = 16769357;
var FEED = { "no-target": "no target", "need-adrenaline": "need adrenaline", "need-energy": "need energy" };
var SPRITE_TILES = 0.95;
var STEP = 0.05;
var SPAWN_TILES = 22;
var SPAWN_JITTER = 6;
var DESPAWN_TILES = 52;
var MAX_FOES = 12;
var DEATH_LINGER = 1.6;
async function contentHeight(url) {
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const cell = Math.round(img.naturalHeight / 4);
    const cv = document.createElement("canvas");
    cv.width = cell;
    cv.height = cell;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cell, cell, 0, 0, cell, cell);
    const d = ctx.getImageData(0, 0, cell, cell).data;
    let minY = cell, maxY = -1;
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) if (d[(y * cell + x) * 4 + 3] > 40) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return maxY < 0 ? cell : maxY + 1 - minY;
  } catch {
    return 16;
  }
}
function mountComboBattler(pixi, host, opts = {}) {
  const { Graphics, Container } = pixi;
  const seed = (opts.seed ?? 1) >>> 0;
  const G = opts.groundScale ?? 0.3;
  const ARENA = { ox: 0, oy: 0 };
  const fieldToWorld = (fx, fy) => ({ x: ARENA.ox + fx * G, y: ARENA.oy + fy * G });
  const worldToField = (wx, wy) => ({ x: (wx - ARENA.ox) / G, y: (wy - ARENA.oy) / G });
  const FSTEP_C = TILE8 / G;
  const CINE_SPRITE_MUL = 4;
  const map = createGameWorld(pixi, host, { seed, keyboardPan: false });
  const roamWalkable = gameWorldWalkable(seed);
  const world = { walkable: (fx, fy) => {
    const w = fieldToWorld(fx, fy);
    return roamWalkable(Math.round(w.x / TILE8), Math.round(w.y / TILE8));
  } };
  const navPath = gameWorldPath(seed);
  const rosters = opts.rosters || (() => {
    const e = opts.enemies || [];
    return { forgottenPlains: e, orc: e, necropolis: e };
  })();
  let battle = null, R = null, combatRoot = null, rings = null, markers = null, navDbg = null, spawnFn = null, dead = false;
  let cinematic = false, cineActors = null;
  let emoteLayer = null;
  let skillVfxLayer = null;
  const emoPrev = /* @__PURE__ */ new Map();
  let idleEmoAcc = 0;
  let runState = { time: 0, kills: 0, diff: 1 };
  let paused = false;
  let hitstopT = 0;
  const shake = { t: 0, mag: 0 };
  const addShake = (dur, mag) => {
    shake.t = Math.max(shake.t, dur);
    shake.mag = Math.max(shake.mag, mag);
  };
  const depthScale = { v: 2 };
  let offTick = null, keyHandlers = null, tapHandlers = null, controlsEl = null, alive = true;
  const keys = { x: 0, y: 0 };
  const joy = { x: 0, y: 0, active: false };
  const req = { attack: false, skill: 0, dodge: false };
  let dash = null, dodgeCdUntil = 0, dodgeBtn = null;
  const DODGE_IFRAMES = 0.4, DODGE_DASH = 0.16, DODGE_CD = 1.1, DODGE_BOOST = 3.4;
  const norm = (x, y) => {
    const m = Math.hypot(x, y) || 1;
    return { x: x / m, y: y / m };
  };
  const moveDir = () => {
    if (joy.active && (joy.x || joy.y)) return norm(joy.x, joy.y);
    if (keys.x || keys.y) return norm(keys.x, keys.y);
    const p = pa();
    return p ? norm(p.faceX || 1, p.faceY || 0) : { x: 1, y: 0 };
  };
  function tryDodge() {
    const p = pa();
    if (!p || !p.alive || !battle || battle.t < dodgeCdUntil) return;
    const dir = moveDir();
    p._dashBase = p.moveSpeed;
    p.moveSpeed = p._dashBase * DODGE_BOOST;
    p.invulnUntil = battle.t + DODGE_IFRAMES;
    dash = { until: battle.t + DODGE_DASH, x: dir.x, y: dir.y };
    dodgeCdUntil = battle.t + DODGE_CD;
  }
  let moveTarget = null;
  let navTarget = null, navRoute = null;
  let routePath = null, routeIdx = 0;
  const acc = { t: 0 };
  const cursor = { logIdx: 0 };
  const listeners = /* @__PURE__ */ new Set();
  const pa = () => battle?.actors.find((a) => a.id === "P0") || null;
  const ea = () => battle?.actors.filter((a) => a.team === "enemy") || [];
  const wtile = (fx, fy) => {
    const w = fieldToWorld(fx, fy);
    return { wx: Math.round(w.x / TILE8), wy: Math.round(w.y / TILE8) };
  };
  const snap = () => ({
    player: pa() ? { x: pa().x, y: pa().y, hp: pa().hp, ...wtile(pa().x, pa().y) } : null,
    enemies: ea().map((a) => ({ x: a.x, y: a.y, hp: Math.round(a.hp), alive: a.alive, ...wtile(a.x, a.y) })),
    over: dead || !!battle?.over
  });
  const emit = () => listeners.forEach((fn) => fn(snap()));
  const KEYMAP = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], arrowup: [0, -1], arrowdown: [0, 1], arrowleft: [-1, 0], arrowright: [1, 0] };
  const held = {};
  const applyKeys = () => {
    let x = 0, y = 0;
    for (const k in held) if (held[k]) {
      x += KEYMAP[k][0];
      y += KEYMAP[k][1];
    }
    keys.x = Math.sign(x);
    keys.y = Math.sign(y);
  };
  function bindKeys() {
    const onDown = (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.code === "Space" || e.key === " ") {
        req.attack = true;
        e.preventDefault();
        return;
      }
      if (e.key === "Shift" || e.code === "ShiftLeft" || e.code === "ShiftRight") {
        req.dodge = true;
        e.preventDefault();
        return;
      }
      if (e.key >= "1" && e.key <= "9") {
        req.skill = +e.key;
        e.preventDefault();
        return;
      }
      const k = e.key.toLowerCase();
      if (KEYMAP[k]) {
        held[k] = true;
        applyKeys();
        e.preventDefault();
      }
    };
    const onUp = (e) => {
      const k = e.key.toLowerCase();
      if (KEYMAP[k]) {
        held[k] = false;
        applyKeys();
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    keyHandlers = () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }
  function bindTap() {
    const canvas = map.getApp().canvas;
    let downAt = null;
    const onDown = (e) => {
      downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onUp = (e) => {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y), elapsed = performance.now() - downAt.t;
      downAt = null;
      if (moved > 8 || elapsed > 500) return;
      const r = canvas.getBoundingClientRect(), w = map.screenToWorld(e.clientX - r.left, e.clientY - r.top);
      moveTarget = worldToField(w.x, w.y);
      navTarget = { x: w.x, y: w.y };
      const p = pa();
      if (p) {
        const pw = fieldToWorld(p.x, p.y);
        const tiles = navPath(Math.round(pw.x / TILE8), Math.round(pw.y / TILE8), Math.round(w.x / TILE8), Math.round(w.y / TILE8));
        navRoute = tiles ? tiles.map(([tx, ty]) => [(tx + 0.5) * TILE8, (ty + 0.5) * TILE8]) : null;
        routePath = navRoute ? navRoute.map(([wx, wy]) => worldToField(wx, wy)) : null;
        routeIdx = 0;
      }
    };
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    tapHandlers = () => {
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
  }
  let skillRowEl = null, adrFill = null, threatBadge = null;
  const skillBtns = [];
  let aimSkill = null, aimIdx = 0;
  const BTN_CSS = (s, big) => `pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;width:${s}px;height:${s}px;border-radius:50%;border:1px solid #20262e;background:rgba(20,24,33,.78);color:#e8e8e8;font:600 ${big ? 22 : 15}px monospace;cursor:pointer;display:flex;align-items:center;justify-content:center`;
  const btnLabel = (text) => {
    const s = document.createElement("span");
    s.textContent = text;
    s.style.cssText = "pointer-events:none;user-select:none;-webkit-user-select:none";
    return s;
  };
  function skillReady(a, s) {
    if (!a || !s) return false;
    if (s.cost?.adrenaline && a.adrenaline < s.cost.adrenaline) return false;
    if (s.cost?.energy && a.energy < s.cost.energy) return false;
    const rc = a.recharge?.[s.id];
    if (rc && battle && rc > battle.t) return false;
    return true;
  }
  function roundBtn(label, on, big) {
    const b = document.createElement("button");
    b.style.cssText = BTN_CSS(big ? 70 : 46, big);
    b.appendChild(btnLabel(label));
    b.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      on();
    });
    return b;
  }
  function holdBtn(label, onDown) {
    const b = document.createElement("button");
    b.style.cssText = BTN_CSS(46, false);
    b.appendChild(btnLabel(label));
    b.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      onDown();
    });
    return b;
  }
  function rebuildSkillButtons() {
    if (!skillRowEl) return;
    skillRowEl.replaceChildren();
    skillBtns.length = 0;
    const bar = pa()?.bar || [];
    bar.forEach((s, i) => {
      const cost = s.cost?.adrenaline ? `${s.cost.adrenaline}adr` : s.cost?.energy ? `${s.cost.energy}en` : "";
      const b = holdBtn(String(i + 1), () => {
        aimSkill = s;
        aimIdx = i + 1;
      });
      b.title = `${s.name || ""}${cost ? " \xB7 " + cost : ""}`;
      skillRowEl.appendChild(b);
      skillBtns.push({ el: b, skill: s });
    });
    skillRowEl.style.display = bar.length ? "flex" : "none";
  }
  function updateHud() {
    const p = pa();
    if (adrFill) adrFill.style.width = (p ? Math.round(p.adrenaline / 25 * 100) : 0) + "%";
    for (const sb of skillBtns) {
      const ok = skillReady(p, sb.skill);
      sb.el.style.opacity = ok ? "1" : "0.4";
      sb.el.style.borderColor = ok ? "#c9a227" : "#20262e";
    }
    if (threatBadge) threatBadge.textContent = `\u2694 ${runState.kills}    THREAT ${runState.diff.toFixed(1)}\xD7`;
    if (dodgeBtn) dodgeBtn.style.opacity = battle && battle.t >= dodgeCdUntil ? "1" : "0.4";
  }
  function setHeroSkills(skills) {
    const p = pa();
    if (!p) return;
    p.bar = (skills || []).map((s) => s && typeof s === "object" ? s : skillById(s)).filter(Boolean);
    rebuildSkillButtons();
    emit();
  }
  function buildControls() {
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:5;font-family:monospace";
    const BASE = 116, KNOB = 54, R2 = (BASE - KNOB) / 2, DEAD = 0.22;
    const base = document.createElement("div");
    base.dataset.tut = "move";
    base.style.cssText = `position:absolute;left:20px;bottom:20px;width:${BASE}px;height:${BASE}px;border-radius:50%;background:rgba(20,24,33,.32);border:2px solid rgba(232,232,232,.32);pointer-events:auto;touch-action:none`;
    const knob = document.createElement("div");
    knob.style.cssText = `position:absolute;left:${(BASE - KNOB) / 2}px;top:${(BASE - KNOB) / 2}px;width:${KNOB}px;height:${KNOB}px;border-radius:50%;background:rgba(232,232,232,.85);border:1px solid #20262e;transition:transform .05s linear`;
    base.appendChild(knob);
    let jid = null;
    const place = (dx, dy) => {
      knob.style.transform = `translate(${dx}px,${dy}px)`;
    };
    const move = (e) => {
      if (jid === null) return;
      const r = base.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > R2) {
        dx = dx / d * R2;
        dy = dy / d * R2;
      }
      place(dx, dy);
      if (d / R2 > DEAD) {
        const m = Math.hypot(dx, dy) || 1;
        joy.x = dx / m;
        joy.y = dy / m;
        joy.active = true;
      } else {
        joy.x = joy.y = 0;
        joy.active = false;
      }
    };
    const down = (e) => {
      jid = e.pointerId;
      try {
        base.setPointerCapture(e.pointerId);
      } catch {
      }
      move(e);
      e.preventDefault();
    };
    const up = (e) => {
      if (jid !== null && (e.pointerId === void 0 || e.pointerId === jid)) {
        jid = null;
        joy.x = joy.y = 0;
        joy.active = false;
        place(0, 0);
      }
    };
    base.addEventListener("pointerdown", down);
    base.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    wrap.appendChild(base);
    const pad = document.createElement("div");
    pad.style.cssText = "position:absolute;right:20px;bottom:20px;display:flex;flex-direction:column;align-items:flex-end;gap:10px;pointer-events:none";
    const skills = document.createElement("div");
    skills.style.cssText = "display:flex;gap:8px;align-items:flex-end";
    skillRowEl = skills;
    rebuildSkillButtons();
    const adrWrap = document.createElement("div");
    adrWrap.style.cssText = "width:150px;pointer-events:none";
    const adrLab = document.createElement("div");
    adrLab.textContent = "ADRENALINE";
    adrLab.style.cssText = "font:600 8px monospace;letter-spacing:.12em;color:#c9a227;text-align:right;margin-bottom:2px";
    const adrTrack = document.createElement("div");
    adrTrack.style.cssText = "height:6px;border-radius:4px;background:rgba(20,24,33,.7);border:1px solid #20262e;overflow:hidden";
    adrFill = document.createElement("div");
    adrFill.style.cssText = "height:100%;width:0%;background:linear-gradient(90deg,#c9a227,#ffe082);transition:width .1s linear";
    adrTrack.append(adrFill);
    adrWrap.append(adrLab, adrTrack);
    pad.appendChild(adrWrap);
    pad.appendChild(skills);
    const actionRow = document.createElement("div");
    actionRow.style.cssText = "display:flex;gap:10px;align-items:flex-end";
    dodgeBtn = roundBtn("\u27F2", () => {
      req.dodge = true;
    }, false);
    dodgeBtn.title = "Dodge roll (Shift)";
    dodgeBtn.dataset.tut = "dodge";
    const atkBtn = roundBtn("\u2694", () => {
      req.attack = true;
    }, true);
    atkBtn.dataset.tut = "attack";
    actionRow.append(dodgeBtn, atkBtn);
    pad.appendChild(actionRow);
    wrap.appendChild(pad);
    threatBadge = document.createElement("div");
    threatBadge.style.cssText = "position:absolute;top:14px;left:50%;transform:translateX(-50%);pointer-events:none;padding:5px 12px;border-radius:999px;background:rgba(20,24,33,.8);border:1px solid #2a3340;color:#e8e8e8;font:700 12px monospace;letter-spacing:.04em";
    wrap.appendChild(threatBadge);
    const castOnRelease = () => {
      if (aimSkill) {
        req.skill = aimIdx;
        aimSkill = null;
      }
    };
    const cancelAim = () => {
      aimSkill = null;
    };
    window.addEventListener("pointerup", castOnRelease);
    window.addEventListener("pointercancel", cancelAim);
    wrap._cleanup = () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("pointerup", castOnRelease);
      window.removeEventListener("pointercancel", cancelAim);
    };
    host.appendChild(wrap);
    controlsEl = wrap;
  }
  const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const nearestFoeDist = () => {
    const p = pa();
    if (!p) return Infinity;
    let m = Infinity;
    for (const e of ea()) if (e.alive) m = Math.min(m, dist3(p, e));
    return m;
  };
  const nearestFoeTo = (a) => {
    if (!a) return null;
    let m = Infinity, best = null;
    for (const e of ea()) if (e.alive) {
      const d = dist3(a, e);
      if (d < m) {
        m = d;
        best = e;
      }
    }
    return best;
  };
  function tick(ticker) {
    if (!battle || !R) return;
    if (paused) return;
    const dtMS = ticker.deltaMS, dt = dtMS / 1e3;
    const p = pa();
    if (req.dodge) {
      req.dodge = false;
      tryDodge();
    }
    let dashing = false;
    if (dash) {
      if (p && p.alive && battle.t < dash.until) dashing = true;
      else {
        if (p && p._dashBase) {
          p.moveSpeed = p._dashBase;
          p._dashBase = 0;
        }
        dash = null;
      }
    }
    const clearNav = () => {
      moveTarget = null;
      navTarget = navRoute = routePath = null;
      routeIdx = 0;
    };
    if (dashing) {
      setInput(battle, "P0", { moveX: dash.x, moveY: dash.y });
    } else if (joy.active) {
      clearNav();
      setInput(battle, "P0", { moveX: joy.x, moveY: joy.y });
    } else if (keys.x || keys.y) {
      clearNav();
      setInput(battle, "P0", { moveX: keys.x, moveY: keys.y });
    } else if (routePath && p) {
      const wpReach = TILE8 / G * 0.9;
      while (routeIdx < routePath.length && Math.hypot(routePath[routeIdx].x - p.x, routePath[routeIdx].y - p.y) < wpReach) routeIdx++;
      if (routeIdx >= routePath.length) {
        clearNav();
        setInput(battle, "P0", { moveX: 0, moveY: 0 });
      } else {
        const wp = routePath[routeIdx], dx = wp.x - p.x, dy = wp.y - p.y, d = Math.hypot(dx, dy) || 1;
        setInput(battle, "P0", { moveX: dx / d, moveY: dy / d });
      }
    } else if (moveTarget && p) {
      const dx = moveTarget.x - p.x, dy = moveTarget.y - p.y, d = Math.hypot(dx, dy);
      if (d < Math.max(10, p.radius * 0.5)) {
        clearNav();
        setInput(battle, "P0", { moveX: 0, moveY: 0 });
      } else setInput(battle, "P0", { moveX: dx / d, moveY: dy / d });
    } else setInput(battle, "P0", { moveX: 0, moveY: 0 });
    if (req.attack) {
      req.attack = false;
      if (p) {
        const why = playerActionReason(battle, p, "basic");
        if (why === "no-target") R.floatText(p.id, "no target", SKILL_YELLOW);
        else setInput(battle, "P0", { action: "basic" });
      }
    }
    if (req.skill) {
      const s = p?.bar?.[req.skill - 1];
      req.skill = 0;
      if (p && s) {
        const why = playerActionReason(battle, p, s.id);
        if (why && why !== "recharging") R.floatText(p.id, FEED[why] || "cannot use", SKILL_YELLOW);
        else setInput(battle, "P0", { action: s.id });
      }
    }
    if (hitstopT > 0) hitstopT = Math.max(0, hitstopT - dt);
    else {
      acc.t += Math.min(dt, 0.1);
      while (acc.t >= STEP) {
        step(battle, STEP);
        acc.t -= STEP;
      }
    }
    if (!dead && p && !p.alive) {
      dead = true;
    }
    if (joy.active && p && p.alive) {
      const cam = map.getCamera(), w = fieldToWorld(p.x, p.y), k = 1 - Math.exp(-dt / 0.12);
      map.panTo(cam.x + (w.x - cam.x) * k, cam.y + (w.y - cam.y) * k);
    }
    spawnFn && spawnFn(dt);
    R.syncActors(battle, dtMS, battle.t);
    R.updateFloats(dtMS);
    R.drawProjectiles(battle);
    R.processLog(battle, cursor, {
      onCast: (e) => {
        const caster = battle.actors.find((x) => x.id === e.who);
        const skill = caster?.bar?.find((s) => s && s.id === e.skillId);
        if (skill?.visual && skillVfxLayer) {
          const aoe = (skill.effects || []).find((x) => x.scope === "area_around_caster");
          const radius = aoe?.range || 110;
          let aim = null;
          if (skill.visual.shape === "beam" || skill.visual.shape === "projectile") {
            const f = nearestFoeTo(caster);
            if (f) aim = { x: f.x, y: f.y };
          }
          skillVfxLayer.play(skill.visual, caster.x, caster.y, radius, battle.t, { aim });
          const inten = skill.visual.intensity || 2;
          addShake(0.1 + inten * 0.05, 2 + inten * 1.5);
        }
        return {};
      },
      onHit: (e) => {
        const p2 = pa();
        if (!p2) return;
        if (e.who === p2.id) {
          addShake(0.16, 5);
          hitstopT = Math.max(hitstopT, 0.03);
        } else if (e.src === p2.id) {
          if (e.amount >= 12) hitstopT = Math.max(hitstopT, 0.035);
          if (e.amount >= 28) addShake(0.1, 3);
        }
      },
      onDeath: (e) => {
        const p2 = pa();
        if (!p2) return;
        if (e.who === p2.id) {
          addShake(0.45, 11);
          hitstopT = Math.max(hitstopT, 0.07);
        } else {
          addShake(0.2, 6);
          hitstopT = Math.max(hitstopT, 0.06);
        }
      }
    });
    {
      const app = map.getApp?.();
      if (app?.stage) {
        if (shake.t > 0) {
          shake.t = Math.max(0, shake.t - dt);
          const m = shake.mag * (shake.t / 0.2);
          app.stage.position.set((Math.random() * 2 - 1) * m, (Math.random() * 2 - 1) * m);
          if (shake.t === 0) app.stage.position.set(0, 0);
        }
      }
    }
    updateEmotes(dt);
    skillVfxLayer?.update(battle.t);
    updateHud();
    drawRings();
    drawMarkers();
    drawNav();
    emit();
  }
  const AFFLICT = ["bleeding", "poison", "burning", "deepWound"];
  function updateEmotes(dt) {
    if (!emoteLayer || !battle) return;
    const now = battle.t;
    for (const a of battle.actors) {
      const prev = emoPrev.get(a.id) || { hp: a.hp, low: false, conds: /* @__PURE__ */ new Set(), kd: 0, alive: true };
      if (a.alive) {
        if (a.hp < prev.hp - 0.5) emoteLayer.show(a.id, "angry", now, 0.85);
        const low = a.maxHp ? a.hp / a.maxHp < 0.33 : false;
        if (low && !prev.low) emoteLayer.show(a.id, "sweat", now, 1.4);
        const conds = new Set((a.conds || []).map((c) => c.type));
        for (const t of conds) if (!prev.conds.has(t) && AFFLICT.includes(t)) {
          emoteLayer.show(a.id, "sick", now, 1.2);
          break;
        }
        if (a.kd > now && a.kd > prev.kd) emoteLayer.show(a.id, "dizzy", now, 1);
        emoPrev.set(a.id, { hp: a.hp, low, conds, kd: a.kd, alive: true });
      } else {
        if (prev.alive) emoteLayer.show(a.id, "dizzy", now, 1.3);
        emoPrev.set(a.id, { ...prev, alive: false, hp: a.hp, conds: /* @__PURE__ */ new Set() });
      }
    }
    const p = pa();
    if (p && p.alive && nearestFoeDist() === Infinity) {
      idleEmoAcc += dt;
      if (idleEmoAcc > 6) {
        emoteLayer.show(p.id, "sleepy", now, 1.6);
        idleEmoAcc = 0;
      }
    } else idleEmoAcc = 0;
    emoteLayer.update(now, (id) => {
      const a = battle.actors.find((x) => x.id === id);
      return a ? { x: a.x, y: a.y } : null;
    });
  }
  function heroEmote(key) {
    const p = pa();
    if (emoteLayer && p && battle) emoteLayer.show(p.id, key, battle.t, 1.6);
  }
  function buffHero({ hpMul = 1, dmgMul = 1, speedMul = 1, rankUp = true, heal = false } = {}) {
    const p = pa();
    if (!p) return;
    if (rankUp) p.rank = Math.min(20, (p.rank || 12) + 1);
    p.baseMaxHp = Math.round(p.baseMaxHp * hpMul);
    p.maxHp = Math.round(p.maxHp * hpMul);
    p.weapon.min = Math.round(p.weapon.min * dmgMul);
    p.weapon.max = Math.max(p.weapon.min + 1, Math.round(p.weapon.max * dmgMul));
    p.moveSpeed = Math.round(p.moveSpeed * speedMul);
    if (heal) p.hp = p.maxHp;
    emit();
  }
  function setPaused(v) {
    paused = !!v;
  }
  function drawRings() {
    const p = pa();
    rings.clear();
    if (!p) return;
    const r = p.weapon.range;
    if (aimSkill) {
      const inRange = nearestFoeDist() <= r + p.radius;
      rings.ellipse(p.x, p.y, r, r * 0.6).stroke({ width: 2.5 / G, color: inRange ? 3461208 : 16738922, alpha: 0.7 });
      return;
    }
    rings.ellipse(p.x, p.y, r, r * 0.6).stroke({ width: 1.5 / G, color: 16777215, alpha: 0.25 });
  }
  function drawMarkers() {
    if (!markers) return;
    markers.clear();
    const a = 1 - Math.max(0, Math.min(1, (map.getCamera().zoom - 0.5) / (0.9 - 0.5)));
    if (a <= 0) return;
    const dot = (fx, fy, color) => {
      const w = fieldToWorld(fx, fy), s = map.worldToScreen(w.x, w.y);
      markers.circle(s.x, s.y, 4.5).fill({ color, alpha: a }).stroke({ width: 1.5, color: 1053723, alpha: a });
    };
    for (const e of ea()) if (e.alive) dot(e.x, e.y, 16726832);
    const p = pa();
    if (p) dot(p.x, p.y, 16766474);
  }
  function drawNav() {
    if (!navDbg) return;
    navDbg.clear();
    if (!navTarget) return;
    const z = map.getCamera().zoom || 1, lw = 2 / z, hasRoute = !!(navRoute && navRoute.length > 1);
    const p = pa(), pw = p ? fieldToWorld(p.x, p.y) : null;
    if (hasRoute) {
      const start = Math.min(routeIdx, navRoute.length - 1);
      if (pw) navDbg.moveTo(pw.x, pw.y).lineTo(navRoute[start][0], navRoute[start][1]);
      else navDbg.moveTo(navRoute[start][0], navRoute[start][1]);
      for (let i = start + 1; i < navRoute.length; i++) navDbg.lineTo(navRoute[i][0], navRoute[i][1]);
      navDbg.stroke({ width: lw, color: 3461208, alpha: 0.95 });
    } else if (pw) {
      navDbg.moveTo(pw.x, pw.y).lineTo(navTarget.x, navTarget.y).stroke({ width: lw, color: 16726832, alpha: 0.9 });
    }
    if (pw) {
      const ang = Math.atan2(navTarget.y - pw.y, navTarget.x - pw.x), ah = 12 / z;
      navDbg.moveTo(navTarget.x - Math.cos(ang - 0.42) * ah, navTarget.y - Math.sin(ang - 0.42) * ah).lineTo(navTarget.x, navTarget.y).lineTo(navTarget.x - Math.cos(ang + 0.42) * ah, navTarget.y - Math.sin(ang + 0.42) * ah).stroke({ width: lw, color: 16766474, alpha: 0.95 });
    }
    navDbg.circle(navTarget.x, navTarget.y, 11).stroke({ width: lw, color: 16766474, alpha: 0.95 });
    navDbg.circle(navTarget.x, navTarget.y, 2.5).fill({ color: 16766474, alpha: 0.95 });
  }
  const sd = (o) => ({ idle: o?.idle, walk: o?.walk, attack: o?.attack, dmg: o?.dmg, die: o?.die });
  function teardownCombat() {
    try {
      offTick?.();
    } catch {
    }
    offTick = null;
    try {
      keyHandlers?.();
    } catch {
    }
    keyHandlers = null;
    try {
      tapHandlers?.();
    } catch {
    }
    tapHandlers = null;
    try {
      controlsEl?._cleanup?.();
      controlsEl?.remove();
    } catch {
    }
    controlsEl = null;
    skillRowEl = null;
    adrFill = null;
    threatBadge = null;
    dodgeBtn = null;
    skillBtns.length = 0;
    dash = null;
    dodgeCdUntil = 0;
    aimSkill = null;
    try {
      markers?.destroy();
    } catch {
    }
    markers = null;
    try {
      navDbg?.destroy();
    } catch {
    }
    navDbg = null;
    try {
      emoteLayer?.destroy();
    } catch {
    }
    emoteLayer = null;
    emoPrev.clear();
    try {
      skillVfxLayer?.destroy();
    } catch {
    }
    skillVfxLayer = null;
    hitstopT = 0;
    shake.t = 0;
    shake.mag = 0;
    try {
      map.getApp()?.stage?.position.set(0, 0);
    } catch {
    }
    try {
      combatRoot?.destroy({ children: true });
    } catch {
    }
    combatRoot = null;
    R = null;
    rings = null;
    battle = null;
    spawnFn = null;
    dead = false;
    acc.t = 0;
    cursor.logIdx = 0;
    moveTarget = null;
    navTarget = null;
    navRoute = null;
    routePath = null;
    routeIdx = 0;
  }
  function cineSnapWorld(wx, wy) {
    const f = worldToField(wx, wy);
    for (let r = 0; r <= 18; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = f.x + dx * FSTEP_C, y = f.y + dy * FSTEP_C;
      if (world.walkable(x, y)) return fieldToWorld(x, y);
    }
    return { x: wx, y: wy };
  }
  async function startCinematic({ groups = [] } = {}) {
    if (!alive) return [];
    if (battle || combatRoot) teardownCombat();
    const bnds = map.getBounds();
    ARENA.ox = bnds.x0;
    ARENA.oy = bnds.y0;
    const field = { w: (bnds.x1 - bnds.x0) / G, h: (bnds.y1 - bnds.y0) / G };
    battle = makeTeamBattle({ seed, players: [], enemies: [], sandbox: true, freeCast: false, world, field });
    cinematic = true;
    cineActors = [];
    combatRoot = new Container();
    combatRoot.scale.set(G);
    combatRoot.position.set(ARENA.ox, ARENA.oy);
    const units = new Container();
    units.sortableChildren = true;
    const fx = new Container();
    const proj = new Graphics();
    combatRoot.addChild(units, proj, fx);
    map.getEntityLayer().addChild(combatRoot);
    const firstSheet = groups[0]?.units?.[0]?.sheets;
    const ch = await contentHeight(firstSheet?.idle || firstSheet?.walk);
    if (!alive || !cinematic) {
      teardownCombat();
      return [];
    }
    depthScale.v = SPRITE_TILES * TILE8 / ((ch || 24) * G) * CINE_SPRITE_MUL;
    R = await createCombatRenderer({ pixi, defsById: {}, layers: { units, fx, projLayer: proj }, coords: { mapX: (x) => x, mapY: (y) => y, depthOf: () => depthScale.v }, getBattle: () => battle });
    if (!alive || !cinematic) {
      teardownCombat();
      return [];
    }
    let n = 0;
    const anchors = [];
    for (const g of groups) {
      const anchor = cineSnapWorld(g.world.x, g.world.y);
      anchors.push(anchor);
      const center = worldToField(anchor.x, anchor.y);
      const list = g.units || [];
      const GOLDEN = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < list.length; i++) {
        const entry = list[i];
        const ang = i * GOLDEN;
        const rad = (0.6 + Math.sqrt(i) * 0.85) * FSTEP_C * CINE_SPRITE_MUL;
        let pos = { x: center.x + Math.cos(ang) * rad, y: center.y + Math.sin(ang) * rad };
        if (!world.walkable(pos.x, pos.y)) pos = center;
        const id = "C" + n++;
        const a = spawnActor(battle, { ...entry.unit || {}, name: entry.name }, "enemy", id);
        a.x = pos.x;
        a.y = pos.y;
        a.decor = true;
        a.faceX = Math.cos(ang) < 0 ? -1 : 1;
        a.faceY = 0;
        a.home = { x: pos.x, y: pos.y };
        a.wander = { tx: pos.x, ty: pos.y, wait: Math.random() * 2 };
        if (alive && cinematic) await R.addActor(id, { name: entry.name, ...sd(entry.sheets) });
        cineActors.push(a);
      }
    }
    if (!alive || !cinematic) {
      stopCinematic();
      return [];
    }
    offTick = map.onTick(cineTick);
    return anchors;
  }
  function cineTick(ticker) {
    if (!cinematic || !battle || !R || paused) return;
    const dtMS = ticker.deltaMS, dt = Math.min(dtMS / 1e3, 0.1);
    battle.t += dt;
    const SPEED = 8 * FSTEP_C * CINE_SPRITE_MUL;
    for (const a of cineActors || []) {
      const w = a.wander;
      const dx = w.tx - a.x, dy = w.ty - a.y, d = Math.hypot(dx, dy);
      if (d < 1 || w.wait > 0) {
        a.moving = false;
        w.wait -= dt;
        if (w.wait <= 0) {
          const ang = Math.random() * Math.PI * 2, rr = (0.5 + Math.random() * 1.6) * FSTEP_C * CINE_SPRITE_MUL;
          const nx = a.home.x + Math.cos(ang) * rr, ny = a.home.y + Math.sin(ang) * rr;
          if (world.walkable(nx, ny)) {
            w.tx = nx;
            w.ty = ny;
          }
          w.wait = 0.8 + Math.random() * 2.5;
        }
      } else {
        const s = Math.min(d, SPEED * dt);
        a.x += dx / d * s;
        a.y += dy / d * s;
        a.faceX = dx < 0 ? -1 : 1;
        a.faceY = dy < 0 ? -1 : 1;
        a.moving = true;
      }
    }
    R.syncActors(battle, dtMS, battle.t);
  }
  function stopCinematic() {
    if (!cinematic && !cineActors) return;
    cinematic = false;
    cineActors = null;
    teardownCombat();
  }
  function getCineAnchors(count = 6) {
    const out = [];
    const push = (tx, ty) => {
      if (!roamWalkable(tx, ty)) return false;
      const x = (tx + 0.5) * TILE8, y = (ty + 0.5) * TILE8;
      if (out.some((a) => Math.hypot(a.x - x, a.y - y) < 60 * TILE8)) return false;
      out.push({ x, y, biome: map.biomeAt(tx, ty) || "forgottenPlains" });
      return true;
    };
    try {
      const sw = gameWorldSpawn(seed);
      push(Math.round(sw.x / TILE8), Math.round(sw.y / TILE8));
    } catch {
    }
    const bnds = map.getBounds();
    const tx0 = Math.round(bnds.x0 / TILE8), ty0 = Math.round(bnds.y0 / TILE8);
    const tw = Math.round((bnds.x1 - bnds.x0) / TILE8), th = Math.round((bnds.y1 - bnds.y0) / TILE8);
    let guard = 0;
    while (out.length < count && guard++ < 4e3) push(tx0 + (8 + Math.random() * (tw - 16) | 0), ty0 + (8 + Math.random() * (th - 16) | 0));
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.random() * (i + 1) | 0;
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  async function spawnHero(player) {
    if (!alive || !player) return;
    cinematic = false;
    cineActors = null;
    const bnds = map.getBounds();
    ARENA.ox = bnds.x0;
    ARENA.oy = bnds.y0;
    const field = { w: (bnds.x1 - bnds.x0) / G, h: (bnds.y1 - bnds.y0) / G };
    const FSTEP = TILE8 / G;
    const snapField = (fx2, fy) => {
      for (let r = 0; r <= 24; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = fx2 + dx * FSTEP, y = fy + dy * FSTEP;
        if (x >= 0 && x <= field.w && y >= 0 && y <= field.h && world.walkable(x, y)) return { x, y };
      }
      return { x: Math.max(0, Math.min(field.w, fx2)), y: Math.max(0, Math.min(field.h, fy)) };
    };
    const players = [{ ...player?.unit || {}, name: player?.name || "Hero", control: "player", skills: player?.unit?.skills || [] }];
    battle = makeTeamBattle({ seed, players, enemies: [], sandbox: true, freeCast: false, world, field });
    const sw = getSpawnWorld();
    const start = worldToField(sw.x, sw.y);
    const p0 = snapField(start.x, start.y);
    const P = pa();
    if (P) {
      P.x = p0.x;
      P.y = p0.y;
    }
    try {
      map.flyTo(sw.x, sw.y, 1.4, 350);
    } catch {
    }
    const defsById = {};
    defsById.P0 = { name: players[0].name, profession: players[0].profession, ...sd(player?.sheets) };
    combatRoot = new Container();
    combatRoot.scale.set(G);
    combatRoot.position.set(ARENA.ox, ARENA.oy);
    rings = new Graphics();
    combatRoot.addChild(rings);
    const units = new Container();
    units.sortableChildren = true;
    const fx = new Container();
    const proj = new Graphics();
    combatRoot.addChild(units, proj, fx);
    map.getEntityLayer().addChild(combatRoot);
    navDbg = new Graphics();
    navDbg.zIndex = 1e9;
    map.getEntityLayer().addChild(navDbg);
    markers = new Graphics();
    map.getApp().stage.addChild(markers);
    const ch = await contentHeight(player?.sheets?.idle || player?.sheets?.walk);
    if (!alive) return;
    depthScale.v = SPRITE_TILES * TILE8 / (ch * G);
    R = await createCombatRenderer({ pixi, defsById, layers: { units, fx, projLayer: proj }, coords: { mapX: (x) => x, mapY: (y) => y, depthOf: () => depthScale.v }, getBattle: () => battle });
    if (!alive) return;
    for (const a of battle.actors) a.attackTimer = 0;
    emoPrev.clear();
    idleEmoAcc = 0;
    if (opts.emoteSheetUrl) {
      try {
        emoteLayer = await createEmoteLayer(pixi, combatRoot, { url: opts.emoteSheetUrl, unit: TILE8 / G });
      } catch {
        emoteLayer = null;
      }
    }
    try {
      skillVfxLayer = createSkillVfx(pixi, combatRoot, { gScale: G });
    } catch {
      skillVfxLayer = null;
    }
    if (!alive) {
      emoteLayer?.destroy();
      emoteLayer = null;
      skillVfxLayer?.destroy();
      skillVfxLayer = null;
      return;
    }
    let foeN = 0;
    const deadAt = /* @__PURE__ */ new Map();
    const spawnAcc = { t: 99 };
    let nextEliteAt = 8, nextBossAt = 24;
    runState = { time: 0, kills: 0, diff: 1 };
    const TIER = {
      // hp/dmg multipliers relative to the current difficulty; bosses are tanky, not one-shotters
      elite: { hp: 2.4, dmg: 1.4, scale: 1.4 },
      boss: { hp: 4.6, dmg: 1.8, scale: 1.95 }
    };
    const rosterAt = (fx2, fy2) => {
      const w = fieldToWorld(fx2, fy2);
      const b = map.biomeAt(Math.round(w.x / TILE8), Math.round(w.y / TILE8)) || "forgottenPlains";
      const r = rosters[b];
      return r && r.length ? r : rosters.forgottenPlains || [];
    };
    const addFoe = async (entry, pos, { hpMul = 1, dmgMul = 1, tier = null } = {}) => {
      const id = "R" + foeN++;
      const name = tier === "boss" ? `${entry.name} the Champion` : tier === "elite" ? `Elite ${entry.name}` : entry.name;
      const a = spawnActor(battle, { ...entry.unit || {}, name, hpMul, dmgMul }, "enemy", id);
      a.x = pos.x;
      a.y = pos.y;
      if (tier) a.tier = tier;
      if (alive) await R.addActor(id, { name, ...sd(entry.sheets) });
      if (tier && TIER[tier]) {
        const v = R.view?.[id];
        if (v?.container) v.container.scale.set(TIER[tier].scale);
      }
      if (tier) {
        try {
          emoteLayer?.show(id, "angry", battle.t, 1.6);
        } catch {
        }
      }
    };
    spawnFn = (dt) => {
      if (dead || !battle) return;
      const p = pa();
      if (!p) return;
      runState.time += dt;
      runState.diff = Math.min(4, 1 + runState.time / 80 + runState.kills * 0.03);
      for (const a of ea()) {
        if (!a.alive) {
          if (!deadAt.has(a.id)) {
            deadAt.set(a.id, battle.t);
            runState.kills++;
            heroEmote("happy");
            try {
              opts.onEnemyDefeated?.({ id: a.id, name: a.name, profession: a.profession, tier: a.tier, x: a.x, y: a.y, t: battle.t });
            } catch {
            }
          } else if (battle.t - deadAt.get(a.id) > DEATH_LINGER) {
            R.removeActor(a.id);
            removeActor(battle, a.id);
            deadAt.delete(a.id);
          }
        } else if (dist3(a, p) > DESPAWN_TILES * FSTEP) {
          R.removeActor(a.id);
          removeActor(battle, a.id);
        }
      }
      spawnAcc.t += dt;
      const diff = runState.diff;
      const waveInterval = Math.max(0.8, 3 / diff);
      if (spawnAcc.t < waveInterval) return;
      spawnAcc.t = 0;
      if (ea().filter((a) => a.alive).length >= MAX_FOES) return;
      const count = 1 + (Math.random() < Math.min(0.7, (diff - 1) / 3) ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const rr = (SPAWN_TILES + (Math.random() * 2 - 1) * SPAWN_JITTER) * FSTEP;
        const pos = snapField(p.x + Math.cos(ang) * rr, p.y + Math.sin(ang) * rr);
        const roster = rosterAt(pos.x, pos.y);
        if (!roster.length) continue;
        const entry = roster[Math.random() * roster.length | 0];
        let opt = { hpMul: diff * (0.85 + Math.random() * 0.3), dmgMul: diff * (0.85 + Math.random() * 0.3) };
        if (i === 0 && runState.kills >= nextBossAt) {
          opt = { hpMul: diff * TIER.boss.hp, dmgMul: diff * TIER.boss.dmg, tier: "boss" };
          nextBossAt += 26 + (Math.random() * 10 | 0);
        } else if (i === 0 && runState.kills >= nextEliteAt) {
          opt = { hpMul: diff * TIER.elite.hp, dmgMul: diff * TIER.elite.dmg, tier: "elite" };
          nextEliteAt += 8 + (Math.random() * 6 | 0);
        }
        addFoe(entry, pos, opt);
      }
    };
    bindKeys();
    bindTap();
    buildControls();
    offTick = map.onTick(tick);
    emit();
  }
  async function selectHero(player) {
    if (!alive || !player) return;
    if (battle || combatRoot) teardownCombat();
    await spawnHero(player);
  }
  const ready = (async () => {
    await map.ready;
    if (!alive) return;
    if (opts.player) await spawnHero(opts.player);
  })();
  function getSnapshot() {
    return snap();
  }
  function resize() {
    try {
      map.getApp()?.resize();
    } catch {
    }
  }
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function destroy() {
    alive = false;
    try {
      offTick?.();
    } catch {
    }
    try {
      keyHandlers?.();
    } catch {
    }
    try {
      tapHandlers?.();
    } catch {
    }
    try {
      controlsEl?._cleanup?.();
      controlsEl?.remove();
    } catch {
    }
    try {
      markers?.destroy();
    } catch {
    }
    try {
      navDbg?.destroy();
    } catch {
    }
    try {
      map.destroy();
    } catch {
    }
    battle = null;
    R = null;
    combatRoot = null;
    listeners.clear();
  }
  function getSpawnWorld() {
    return gameWorldSpawn(seed);
  }
  function getHero() {
    const p = pa();
    return p ? { name: p.name, profession: p.profession, hp: Math.round(p.hp), maxHp: Math.round(p.maxHp), skills: (p.bar || []).map((s) => s.name) } : null;
  }
  const ctrl = { ready, selectHero, startCinematic, stopCinematic, getCineAnchors, getSpawnWorld, getSnapshot, getHero, heroEmote, buffHero, setPaused, setHeroSkills, getThreat: () => ({ ...runState }), resize, onChange, destroy, map, walkable: (wx, wy) => roamWalkable(wx, wy) };
  if (typeof window !== "undefined") {
    window.__comboSnap = () => ctrl.getSnapshot();
    window.__combo = ctrl;
  }
  return ctrl;
}
export {
  mountComboBattler
};
