// ../auto-battler/src/render/chunkedMap.js
function createChunkedMap(pixi, host, config) {
  const { Application, Assets, Sprite, Container, Texture, Rectangle, RenderTexture } = pixi;
  const TILE11 = config.tile ?? 8;
  const CHUNK10 = config.chunk ?? 32;
  const CHUNKPX = CHUNK10 * TILE11;
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
    x0: config.bounds.x0 * TILE11,
    y0: config.bounds.y0 * TILE11,
    x1: config.bounds.x1 * TILE11,
    y1: config.bounds.y1 * TILE11,
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
  const getSnapshot = () => ({ seed, zoom, cx: Math.round(camera.x / TILE11), cy: Math.round(camera.y / TILE11), chunks: chunks.size });
  function tex(source, c, r) {
    const k = source.uid + ":" + c + "," + r;
    let t = texCache.get(k);
    if (!t) {
      t = new Texture({ source, frame: new Rectangle(c * TILE11, r * TILE11, TILE11, TILE11) });
      texCache.set(k, t);
    }
    return t;
  }
  function texFrame(source, x, y, w, h2) {
    const k = source.uid + ":f" + x + "," + y + "," + w + "," + h2;
    let t = texCache.get(k);
    if (!t) {
      t = new Texture({ source, frame: new Rectangle(x, y, w, h2) });
      texCache.set(k, t);
    }
    return t;
  }
  function makeChunk(cx, cy) {
    const x0 = cx * CHUNK10, y0 = cy * CHUNK10;
    const tmp = new Container();
    const add = (source, c, r, tx, ty) => {
      const sp = new Sprite(tex(source, c, r));
      sp.x = tx * TILE11;
      sp.y = ty * TILE11;
      tmp.addChild(sp);
      return sp;
    };
    const res = config.bake({ cx, cy, x0, y0, seed, chunk: CHUNK10, tile: TILE11, ctx, tmp, app, Sprite, Container, Texture, Rectangle, tex, texFrame, add }) || {};
    const rt = RenderTexture.create({ width: CHUNKPX, height: CHUNKPX, autoGenerateMipmaps: true, scaleMode: "nearest" });
    rt.source.minFilter = "linear";
    rt.source.mipmapFilter = "linear";
    app.renderer.render({ container: tmp, target: rt });
    rt.source.updateMipmaps();
    tmp.destroy({ children: true });
    const sprite = new Sprite(rt);
    sprite.x = x0 * TILE11;
    sprite.y = y0 * TILE11;
    return { sprite, rt, meta: res.meta ?? null, live: res.live ?? null };
  }
  function chooseMacroLevel(z) {
    return Math.max(0, Math.min(MACRO_LEVEL_MAX, Math.round(Math.log2(MACRO_TEXEL_PX / (TILE11 * z)))));
  }
  function makeMacroChunk(L, mcx, mcy) {
    const step = 1 << L, t0x = mcx * MCHUNK * step, t0y = mcy * MCHUNK * step;
    const cv = document.createElement("canvas");
    cv.width = MCHUNK;
    cv.height = MCHUNK;
    const g = cv.getContext("2d");
    const img = g.createImageData(MCHUNK, MCHUNK), d = img.data;
    for (let j = 0; j < MCHUNK; j++) for (let i = 0; i < MCHUNK; i++) {
      const [r, gg, b] = config.macroColor(seed, t0x + i * step + (step >> 1), t0y + j * step + (step >> 1));
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
    sprite.x = t0x * TILE11;
    sprite.y = t0y * TILE11;
    sprite.width = sprite.height = MCHUNK * step * TILE11;
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
      c0 = Math.max(c0, Math.floor(bounds.tx0 / CHUNK10));
      c1 = Math.min(c1, Math.floor((bounds.tx1 - 1) / CHUNK10));
      r0 = Math.max(r0, Math.floor(bounds.ty0 / CHUNK10));
      r1 = Math.min(r1, Math.floor((bounds.ty1 - 1) / CHUNK10));
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
    const px = MCHUNK * (1 << L) * TILE11;
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
      const step = 0.12 * ticker.deltaTime;
      for (const sp of fading) {
        sp.alpha = Math.min(1, sp.alpha + step);
        if (sp.alpha >= 1) fading.delete(sp);
      }
    }
    if (cameraDirty || genPending) {
      reconcile();
      cameraDirty = false;
      const tk2 = Math.round(camera.x / TILE11) + "," + Math.round(camera.y / TILE11) + "," + zoom.toFixed(3);
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
    const cx = Math.floor(wx / CHUNK10), cy = Math.floor(wy / CHUNK10);
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
  return { ready, regenerate, destroy, onChange, getSnapshot, getCamera, tileIndexAt, biomeAt: biomeAt2, getBounds, zoomBy, flyTo, panTo, setEnabled, onTick, getEntityLayer, getApp, screenToWorld, worldToScreen, tile: TILE11 };
}

// ../auto-battler/src/engine/rng.js
function makeGenRng(seed) {
  let s = Math.imul(seed >>> 0 ^ 2654435769, 2654435761) >>> 0 || 1;
  s = (s ^ s >>> 15) >>> 0;
  const rnd2 = () => {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0;
    return s / 4294967296;
  };
  const ri = (a, b) => a + Math.floor(rnd2() * (b - a + 1));
  return { rnd: rnd2, ri };
}

// ../auto-battler/src/engine/worldgen.js
function hash2(seed, x, y) {
  let h2 = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2654435761);
  h2 = Math.imul(h2 ^ h2 >>> 13, 1274126177);
  h2 ^= h2 >>> 16;
  return (h2 >>> 0) / 4294967296;
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

// ../auto-battler/src/engine/biomeMap.js
var sub = (seed, salt) => (Math.imul(seed | 0, 2654435761) ^ (salt | 0)) >>> 0;
var SCALE = 5e-3;
var REGION_OCTAVES = 3;
var WARP_SCALE = 0.012;
var WARP_AMP = 40;
var BIOMES = [
  { id: "forgottenPlains", salt: 985505 },
  // green meadow
  { id: "orc", salt: 11281 },
  // dirt / grass plains
  { id: "necropolis", salt: 966869 }
  // corrupted swamp
  // { id: 'lostJungle', salt: 0x10573e },  // prehistoric mossy jungle — standalone-page only for now
];
var OVERWORLD_BIOMES = BIOMES.map((b) => b.id);
function weights(seed, x, y, out) {
  const wx = x + WARP_AMP * (fbm(sub(seed, 1441), x * WARP_SCALE, y * WARP_SCALE) - 0.5);
  const wy = y + WARP_AMP * (fbm(sub(seed, 1442), x * WARP_SCALE, y * WARP_SCALE) - 0.5);
  for (let i = 0; i < BIOMES.length; i++) out[i] = fbm(sub(seed, BIOMES[i].salt), wx * SCALE, wy * SCALE, REGION_OCTAVES);
  return out;
}
var _w = new Array(BIOMES.length);
function biomeRegion(seed, x, y) {
  const w = weights(seed, x, y, _w);
  let i1 = 0;
  for (let i = 1; i < w.length; i++) if (w[i] > w[i1]) i1 = i;
  let i2 = -1;
  for (let i = 0; i < w.length; i++) {
    if (i === i1) continue;
    if (i2 < 0 || w[i] > w[i2]) i2 = i;
  }
  return { id: BIOMES[i1].id, id2: BIOMES[i2]?.id ?? BIOMES[i1].id, edge: w[i1] - w[i2] };
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
function boundaryCase(N, E, S, W, NW, NE, SW2, SE) {
  const card = N + E + S + W;
  if (card === 0) {
    const diag = NW + NE + SW2 + SE;
    if (diag === 0) return null;
    if (NW) return "cNW";
    if (NE) return "cNE";
    if (SW2) return "cSW";
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
  let h2 = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h2 ^= s.charCodeAt(i);
    h2 = Math.imul(h2, 16777619);
  }
  return h2 >>> 0;
}

// ../auto-battler/src/engine/orcGen.js
var sub2 = (seed, salt) => (Math.imul(seed | 0, 2654435761) ^ (salt | 0)) >>> 0;
var DDIRT_SCALE = 0.045;
var DDIRT_THRESHOLD = 0.55;
function isDarkerDirt(seed, x, y) {
  return fbm(sub2(seed, 56599), x * DDIRT_SCALE, y * DDIRT_SCALE) > DDIRT_THRESHOLD;
}
var GRASS_SCALE = 0.04;
var GRASS_THRESHOLD = 0.58;
function isGrass(seed, x, y) {
  return fbm(sub2(seed, 27221), x * GRASS_SCALE, y * GRASS_SCALE) > GRASS_THRESHOLD;
}
var ROCK_SCALE = 0.12;
var ROCK_THRESHOLD = 0.64;
function isRock(seed, x, y) {
  return fbm(sub2(seed, 16588), x * ROCK_SCALE, y * ROCK_SCALE) > ROCK_THRESHOLD;
}

// ../auto-battler/src/render/tileAutotile.js
var rect = (c, r, w, h2) => {
  const a = [];
  for (let j = 0; j < h2; j++) for (let i = 0; i < w; i++) a.push([c + i, r + j]);
  return a;
};
var offset = (t, col) => [t[0] + col, t[1]];
var rhash = (x, y, salt, seed) => Math.imul(x * 73856093 ^ y * 19349663 ^ seed + (salt | 0), 2654435761) >>> 0;
function hashU32(a, b, c) {
  let h2 = Math.imul((a | 0) ^ 2654435769, 2654435761);
  h2 = Math.imul(h2 ^ (b | 0) ^ 2246822507, 2246822519);
  h2 = Math.imul(h2 ^ (c | 0) ^ 3266489909, 3266489917);
  h2 ^= h2 >>> 15;
  return h2 >>> 0;
}
var sparse = (base, vars, x, y, salt, rate, seed) => {
  if (!vars.length) return base;
  const h2 = rhash(x, y, salt, seed);
  return h2 % rate === 0 ? vars[(h2 >>> 5) % vars.length] : base;
};
var lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function nineSlice(set, top, bot, left, right) {
  if (top) return left ? set.nw : right ? set.ne : set.n;
  if (bot) return left ? set.sw : right ? set.se : set.s;
  if (left) return set.w;
  if (right) return set.e;
  return set.c;
}
function autotile(set, N, E, S, W, NW, NE, SW2, SE) {
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
  const diag = NW + NE + SW2 + SE;
  if (diag === 0) return null;
  if (diag === 1) return NW ? set.cNW : NE ? set.cNE : SW2 ? set.cSW : set.cSE;
  if (NW && SE && !NE && !SW2) return set.dNWSE;
  if (NE && SW2 && !NW && !SE) return set.dSWNE;
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

// ../auto-battler/src/render/orcKingdom.js
var ORC = "/assets/minifantasy/Minifantasy_Orc_Kingdom_v1.0/Minifantasy_Orc_Kingdom_Assets";
var TILES = `${ORC}/Tileset/Tiles.png`;
var ORC_MAP_ASSETS = [TILES];
var TILE2 = 8;
var CHUNK = 32;
var DIRT_BASE = [7, 51];
var DIRT_VARS = rect(13, 51, 2, 6);
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
var COL_DIRT = [150, 128, 95];
var COL_DDIRT = [106, 90, 79];
var COL_GRASS = [96, 132, 58];
function chunkFields(seed, x0, y0) {
  const M = 6, SZ = CHUNK + 2 * M;
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
  { key: "dirt", url: TILES, tile: DIRT_BASE },
  { key: "ddirt", url: TILES, tile: DDIRT.fill },
  { key: "grass", url: TILES, tile: GRASS.fill }
];
function orcGroundFillKey(seed, x, y) {
  if (isDarkerDirt(seed, x, y)) return "ddirt";
  if (isGrass(seed, x, y)) return "grass";
  return "dirt";
}
var orcConfig = (seed) => ({
  seed,
  tile: TILE2,
  chunk: CHUNK,
  background: "#69636f",
  async load({ Assets }) {
    const t = await Assets.load(TILES);
    t.source.scaleMode = "nearest";
    return { tiles: t.source };
  },
  // `accept(tx,ty)` (chunk-local) gates which tiles this biome paints — defaults to all, so the
  // standalone map is unchanged; the multi-biome overworld passes a per-biome dither mask.
  bake({ x0, y0, seed: seed2, ctx, add, accept = () => true }) {
    const f = chunkFields(seed2, x0, y0);
    const { dd, gr, rock, M, SZ } = f;
    const idx = (i, j) => j * SZ + i;
    const at = (fld, lx, ly) => fld[idx(lx + M, ly + M)] === 1;
    const atRock = (lx, ly) => rock[idx(lx + M, ly + M)] === 1;
    const place = (coord, tx, ty) => add(ctx.tiles, coord[0], coord[1], tx, ty);
    const drawLayer = (field, set, tx, ty) => {
      if (!at(field, tx, ty)) return;
      const N = !at(field, tx, ty - 1), E = !at(field, tx + 1, ty), S = !at(field, tx, ty + 1), W = !at(field, tx - 1, ty);
      const NW = !at(field, tx - 1, ty - 1), NE = !at(field, tx + 1, ty - 1), SW2 = !at(field, tx - 1, ty + 1), SE = !at(field, tx + 1, ty + 1);
      const t = autotile(set, N, E, S, W, NW, NE, SW2, SE);
      place(t || sparse(set.fill, set.vars, x0 + tx, y0 + ty, set === GRASS ? 1 : 2, OVERLAY_RATE, seed2), tx, ty);
    };
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        if (!accept(tx, ty)) continue;
        place(sparse(DIRT_BASE, DIRT_VARS, x0 + tx, y0 + ty, 0, DIRT_RATE, seed2), tx, ty);
        drawLayer(dd, DDIRT, tx, ty);
        drawLayer(gr, GRASS, tx, ty);
        if (atRock(tx, ty)) {
          const h2 = rhash(x0 + tx, y0 + ty, 3, seed2);
          const interior = atRock(tx, ty - 1) && atRock(tx + 1, ty) && atRock(tx, ty + 1) && atRock(tx - 1, ty);
          const pool = interior ? ROCK_DENSE : ROCK_SPARSE;
          place(offset(pool[(h2 >>> 2) % pool.length], ROCK_COLOR_OFF[h2 % 3]), tx, ty);
        } else if (!at(dd, tx, ty) && !at(gr, tx, ty)) {
          const h2 = rhash(x0 + tx, y0 + ty, 7, seed2);
          if (h2 % ROCK_STONE_RATE === 0) place(offset(STONE_SIZES[(h2 >>> 3) % STONE_SIZES.length], ROCK_COLOR_OFF[(h2 >>> 6) % 3]), tx, ty);
          else if ((h2 >>> 8) % ROCK_FOLIAGE_RATE === 0) place(offset(ROCK_FOLIAGE[(h2 >>> 11) % ROCK_FOLIAGE.length], ROCK_COLOR_OFF[(h2 >>> 14) % 3]), tx, ty);
        }
      }
    }
    return { meta: f };
  },
  macroColor(seed2, tx, ty) {
    if (isDarkerDirt(seed2, tx, ty)) return COL_DDIRT;
    if (isGrass(seed2, tx, ty)) return COL_GRASS;
    return COL_DIRT;
  },
  // Top-most ground tile [c,r] at world (wx,wy) for the grid overlay (rocks omitted).
  tileIndexAt(wx, wy, meta) {
    if (!meta) return null;
    const { dd, gr, M, SZ, x0, y0 } = meta;
    const lx = wx - x0, ly = wy - y0;
    if (lx < 0 || ly < 0 || lx >= CHUNK || ly >= CHUNK) return null;
    const at = (f, x, y) => f[(y + M) * SZ + (x + M)] === 1;
    for (const [field, set] of [[gr, GRASS], [dd, DDIRT]]) {
      if (!at(field, lx, ly)) continue;
      const N = !at(field, lx, ly - 1), E = !at(field, lx + 1, ly), S = !at(field, lx, ly + 1), W = !at(field, lx - 1, ly);
      const NW = !at(field, lx - 1, ly - 1), NE = !at(field, lx + 1, ly - 1), SW2 = !at(field, lx - 1, ly + 1), SE = !at(field, lx + 1, ly + 1);
      return autotile(set, N, E, S, W, NW, NE, SW2, SE) || set.fill;
    }
    return DIRT_BASE;
  }
});
function createOrcMap(pixi, host, opts = {}) {
  return createChunkedMap(pixi, host, orcConfig(opts.seed ?? 1));
}

// ../auto-battler/src/engine/fpGen.js
var sub3 = (seed, salt) => (Math.imul(seed | 0, 2654435761) ^ (salt | 0)) >>> 0;
var DIRT_SCALE = 0.04;
var DIRT_THRESHOLD = 0.56;
function isDirt(seed, x, y) {
  return fbm(sub3(seed, 53543), x * DIRT_SCALE, y * DIRT_SCALE) > DIRT_THRESHOLD;
}
var STONE_SCALE = 0.085;
var STONE_THRESHOLD = 0.66;
function isStone(seed, x, y) {
  return fbm(sub3(seed, 22286), x * STONE_SCALE, y * STONE_SCALE) > STONE_THRESHOLD;
}
var FOREST_SCALE = 0.05;
function forestField(seed, x, y) {
  return fbm(sub3(seed, 15740503), x * FOREST_SCALE, y * FOREST_SCALE);
}
var STONE_CLUMP_SCALE = 0.11;
function stoneClumpField(seed, x, y) {
  return fbm(sub3(seed, 5702849), x * STONE_CLUMP_SCALE, y * STONE_CLUMP_SCALE);
}
var ELEV_SCALE = 0.025;
var ELEV_THRESHOLD = 0.6;
function isRaised(seed, x, y) {
  return fbm(sub3(seed, 57836), x * ELEV_SCALE, y * ELEV_SCALE) > ELEV_THRESHOLD;
}
var RIVER_SCALE = 0.022;
var RIVER_WIDTH = 0.035;
var WARP_SCALE2 = 0.03;
var WARP_AMP2 = 22;
function isRiver(seed, x, y) {
  const wx = x + WARP_AMP2 * (fbm(sub3(seed, 1297), x * WARP_SCALE2, y * WARP_SCALE2) - 0.5);
  const wy = y + WARP_AMP2 * (fbm(sub3(seed, 1298), x * WARP_SCALE2, y * WARP_SCALE2) - 0.5);
  return Math.abs(fbm(sub3(seed, 8654), wx * RIVER_SCALE, wy * RIVER_SCALE) - 0.5) < RIVER_WIDTH;
}

// ../auto-battler/src/render/forgottenPlains.js
var FP = "/assets/minifantasy/Minifantasy_ForgottenPlains_v3.6_Commercial_Version/Minifantasy_ForgottenPlains_Assets";
var TILES2 = `${FP}/Tileset/Minifantasy_ForgottenPlainsTiles.png`;
var SHADOW = `${FP}/Tileset/Minifantasy_ForgottenPlainsTilesShadows.png`;
var PROPS = `${FP}/props/Minifantasy_ForgottenPlainsProps.png`;
var PROP_SHADOW = `${FP}/props/Minifantasy_ForgottenPlainsPropsShadows.png`;
var FP_TILES_URL = TILES2;
var FP_PROPS_URL = PROPS;
var FP_MOCKUP_URL = `${FP}/Minifantasy_ForgottenPlainsMockup.png`;
var FP_MAP_ASSETS = [TILES2, SHADOW, PROPS, PROP_SHADOW];
var TILE3 = 8;
var CHUNK2 = 32;
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
var COL_STONE = [120, 120, 122];
var COL_WATER = [74, 116, 196];
function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
async function buildShadowMask(url) {
  const img = await loadImg(url);
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
function chunkFields2(seed, x0, y0) {
  const WATER_BUFFER = 2;
  const M = WATER_BUFFER + 4, SZ = CHUNK2 + 2 * M;
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
  { key: "grass", url: TILES2, tile: GRASS_BASE },
  { key: "dirt", url: TILES2, tile: DIRT_FILL },
  { key: "stone", url: TILES2, tile: STONE_FILL }
];
function fpGroundFillKey(seed, x, y) {
  if (isStone(seed, x, y) && !isDirt(seed, x, y)) return "stone";
  if (isDirt(seed, x, y)) return "dirt";
  return "grass";
}
var FP_TILE_CATALOG = [
  {
    role: "surface",
    name: "Grass (base)",
    frame: [1, 1, 4, 1],
    used: true,
    note: "base ground \u2014 [37,11] + tuft variants (row 1) & the 3\xD75 detail block [2,3], via sparse()"
  },
  {
    role: "surface",
    name: "Dirt (patches)",
    frame: [7, 7, 3, 5],
    used: true,
    note: "autotile blob (blockTile/centerTile) \u2190isDirt \u2014 block [7,3], fill [8,4]"
  },
  {
    role: "surface",
    name: "Stone (patches)",
    frame: [12, 7, 3, 5],
    used: true,
    note: "autotile blob \u2190isStone \u2014 block [12,3], fill [13,4]"
  },
  {
    role: "surface",
    name: "Lake water",
    frame: [25, 7, 3, 5],
    used: true,
    note: "water blob (FP-format) \u2190isRiver \u2014 block [25,3], grass-shored, 2 animated frames"
  },
  {
    role: "face",
    name: "Cliff (plateau)",
    frame: [24, 20, 3, 5],
    used: true,
    note: "2.5D plateau via bakeCliffs \u2014 grass LIP_T [25,16]+corners, E/W WALLs [24/26,17], south LIP [25,18], 2-row overhang FACE [25,19-20]. THE template for the desert mesas."
  },
  {
    role: "structure",
    name: "Stairs / ladders",
    frame: [2, 20, 5, 6],
    used: true,
    note: "cliff stair exits (bakeCliffs STAIR) \u2014 narrow cross cols 2-6, wide cross cols 8-14, per-direction S/N/W/E descents. Drop-in reusable for any cliff biome."
  },
  {
    role: "surface",
    name: "Stone (alt)",
    frame: [16, 7, 3, 5],
    used: false,
    note: "autotile blob \u2014 a second grey-stone material; same blockTile/centerTile, not wired"
  },
  {
    role: "surface",
    name: "Rocky ground",
    frame: [19, 7, 3, 5],
    used: false,
    note: "autotile blob \u2014 grey + dirt rocky patch; unused"
  },
  {
    role: "face",
    name: "Cliff (other heights)",
    frame: [28, 19, 3, 5],
    used: false,
    note: "2.5D cliff at other heights (cols 16-18 short, 20-22, 28-30 tall) \u2014 same bakeCliffs, extra wall rows; not wired"
  },
  {
    role: "surface",
    name: "Water (variants)",
    frame: [29, 7, 3, 5],
    used: false,
    note: "alt grass-shored & dirt-shored lake blobs (cols 29-31, and rows 9-12) \u2014 unused"
  },
  {
    role: "structure",
    name: "Grass hills",
    frame: [34, 12, 4, 4],
    used: false,
    note: "raised grass mounds w/ dirt edges (cols 34-69) \u2014 decorative; unused"
  }
];
var FP_PROP_CATALOG = [
  // Boulders (sheet row 3) — scattered in rocky clumps (stoneClumpField). All used.
  { name: "Boulder (big a)", frame: [0, 3, 2, 4], used: true, note: "large boulder" },
  { name: "Boulder (big b)", frame: [2, 3, 2, 4], used: true, note: "large boulder" },
  { name: "Boulder (knobbly)", frame: [4, 3, 2, 4], used: true, note: "large knobbly boulder" },
  { name: "Boulder (medium)", frame: [6, 3, 2, 3], used: true, note: "medium boulder" },
  { name: "Rock a", frame: [8, 3, 2, 2], used: true, note: "small rock" },
  { name: "Rock b", frame: [10, 3, 2, 2], used: true, note: "small rock" },
  { name: "Rock (flat)", frame: [12, 3, 2, 2], used: true, note: "small flat rock" },
  { name: "Rock c", frame: [14, 3, 2, 2], used: true, note: "small rock" },
  { name: "Rock d", frame: [16, 3, 2, 2], used: true, note: "small rock" },
  // Foliage (baked on grass) — tufts, reeds, flowers.
  { name: "Grass tuft a", frame: [9, 6, 1, 1], used: true, note: "grass tuft" },
  { name: "Grass tuft b", frame: [10, 6, 1, 1], used: true, note: "grass tuft" },
  { name: "Grass tuft c", frame: [11, 6, 1, 1], used: true, note: "grass tuft" },
  { name: "Small reed a", frame: [12, 6, 1, 1], used: true, note: "small reed" },
  { name: "Small reed b", frame: [13, 6, 1, 1], used: true, note: "small reed" },
  { name: "Flower (red)", frame: [9, 9, 1, 1], used: true, note: "red flower" },
  { name: "Flower (purple)", frame: [10, 9, 1, 1], used: true, note: "purple flowers" },
  { name: "Flower (daisy)", frame: [11, 9, 1, 1], used: true, note: "white daisy" },
  { name: "Small grass a", frame: [12, 9, 1, 1], used: true, note: "small grass" },
  { name: "Small grass b", frame: [13, 9, 1, 1], used: true, note: "small grass" },
  // Tall foliage (live, depth-sorted sprites).
  { name: "Tall reed", frame: [14, 6, 1, 3], used: true, note: "tall reed (1\xD73)" },
  { name: "Wide reed a", frame: [15, 6, 2, 3], used: true, note: "wide reed (2\xD73)" },
  { name: "Wide reed b", frame: [17, 6, 2, 3], used: true, note: "wide reed (2\xD73)" },
  { name: "Cattail", frame: [14, 9, 1, 2], used: true, note: "cattail (1\xD72)" },
  { name: "Water reed", frame: [15, 9, 1, 2], used: true, note: "reed \u2014 spawned in water only" },
  // Trees (live, in groves via forestField). Pixel-bbox crops → tile-approx frames here.
  { name: "Tree (plain)", frame: [19, 3, 3, 4], used: true, note: "plain tree" },
  { name: "Tree (fruited)", frame: [19, 7, 3, 4], used: true, note: "fruited tree (2 variants)" },
  // Unused — bigger rock formations + a standing stone (cf. the desert standing stones).
  { name: "Rock mound (large)", frame: [0, 7, 6, 3], used: false, note: "large rock outcrop \u2014 unused" },
  { name: "Rock mound (dirt base)", frame: [0, 9, 6, 2], used: false, note: "rock outcrop on dirt \u2014 unused" },
  { name: "Stone pillar", frame: [9, 9, 1, 5], used: false, note: "tall standing stone \u2014 unused" }
];
var fpConfig = (seed, opts = {}) => ({
  seed,
  tile: TILE3,
  chunk: CHUNK2,
  background: "#5a7b3a",
  async load({ Assets }) {
    const ctx = { tiles: null, shadow: null, shadowSet: null, props: null, propShadow: null };
    const t = await Assets.load(TILES2);
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
    const f = chunkFields2(seed2, x0, y0);
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
    for (let ty = 0; ty < CHUNK2; ty++) for (let tx = 0; tx < CHUNK2; tx++) {
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
    if (ctx.props) for (let ty = 0; ty < CHUNK2; ty++) for (let tx = 0; tx < CHUNK2; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      if (atW(wx, wy)) {
        if (hashU32(seed2 ^ 24301, wx, wy) % WATER_FOLIAGE_RATE === 0) live.push({ sprite: propSprite(WATER_FOLIAGE, wx, wy), shadow: null });
        continue;
      }
      if (atD(wx, wy) || atS(wx, wy)) continue;
      const h2 = hashU32(seed2 ^ 15733114, wx, wy);
      if (h2 % FOLIAGE_RATE !== 0) continue;
      let pick2 = (h2 >>> 8) % FOLIAGE_WEIGHT, g = FOLIAGE[0];
      for (const grp of FOLIAGE) {
        if (pick2 < grp.weight) {
          g = grp;
          break;
        }
        pick2 -= grp.weight;
      }
      if (g.sprite) {
        live.push({ sprite: propSprite(g.sprite, wx, wy), shadow: null });
        continue;
      }
      const [c, r] = g.tiles[(h2 >>> 16) % g.tiles.length];
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
    bakeCliffs(FP_CLIFF, { chunk: CHUNK2, x0, y0, seed: seed2, raised: isRaisedAt, place, accept, stairAt, stairAtV });
    if (ctx.props) {
      const inGrove = (wx, wy) => forestRegion[idx(wx - x0 + M, wy - y0 + M)] === 1;
      const bx0 = Math.floor(x0 / FOREST_BLOCK_X), bx1 = Math.floor((x0 + CHUNK2 - 1) / FOREST_BLOCK_X);
      const by0 = Math.floor(y0 / FOREST_BLOCK_Y), by1 = Math.floor((y0 + CHUNK2 - 1) / FOREST_BLOCK_Y);
      for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
        const h2 = hashU32(seed2 ^ 15748695, bx, by);
        const wx = bx * FOREST_BLOCK_X + h2 % FOREST_BLOCK_X, wy = by * FOREST_BLOCK_Y + (h2 >>> 4) % FOREST_BLOCK_Y;
        if (wx < x0 || wx >= x0 + CHUNK2 || wy < y0 || wy >= y0 + CHUNK2) continue;
        if (!accept(wx - x0, wy - y0)) continue;
        if (!inGrove(wx, wy)) continue;
        if ((h2 >>> 8 & 65535) / 65536 >= FOREST_FILL) continue;
        if (atW(wx, wy) || atS(wx, wy)) continue;
        if (!isRaisedAt(wx, wy)) {
          let onFace = false;
          for (let k = 1; k <= FP_CLIFF.FACE_H; k++) if (isRaisedAt(wx, wy - k)) {
            onFace = true;
            break;
          }
          if (onFace) continue;
        }
        const T = TREES[(h2 >>> 24) % TREES.length];
        const flip = (h2 >>> 20 & 255) / 256 < TREE_FLIP_RATE;
        const sc = TREE_SCALE_BASE * (1 + ((h2 >>> 12 & 255) / 256 - 0.5) * 2 * TREE_SCALE_JITTER);
        const px = wx * TILE3 + TILE3 / 2 + ((h2 >>> 16 & 15) / 16 - 0.5) * 2 * TREE_JITTER;
        const py = wy * TILE3 + TILE3 / 2 + ((h2 >>> 28 & 15) / 16 - 0.5) * 2 * TREE_JITTER;
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
      const sbx0 = Math.floor(x0 / STONE_BLOCK_X), sbx1 = Math.floor((x0 + CHUNK2 - 1) / STONE_BLOCK_X);
      const sby0 = Math.floor(y0 / STONE_BLOCK_Y), sby1 = Math.floor((y0 + CHUNK2 - 1) / STONE_BLOCK_Y);
      for (let by = sby0; by <= sby1; by++) for (let bx = sbx0; bx <= sbx1; bx++) {
        const h2 = hashU32(seed2 ^ 5702885, bx, by);
        const wx = bx * STONE_BLOCK_X + h2 % STONE_BLOCK_X, wy = by * STONE_BLOCK_Y + (h2 >>> 4) % STONE_BLOCK_Y;
        if (wx < x0 || wx >= x0 + CHUNK2 || wy < y0 || wy >= y0 + CHUNK2) continue;
        if (!accept(wx - x0, wy - y0)) continue;
        if (!inClump(wx, wy)) continue;
        if ((h2 >>> 8 & 65535) / 65536 >= STONE_CLUMP_FILL) continue;
        if (atW(wx, wy)) continue;
        if (!isRaisedAt(wx, wy)) {
          let onFace = false;
          for (let k = 1; k <= FP_CLIFF.FACE_H; k++) if (isRaisedAt(wx, wy - k)) {
            onFace = true;
            break;
          }
          if (onFace) continue;
        }
        let pick2 = (h2 >>> 20) % STONE_WEIGHT, st = STONES[0];
        for (const s of STONES) {
          if (pick2 < s.weight) {
            st = s;
            break;
          }
          pick2 -= s.weight;
        }
        live.push({ sprite: propSprite(st, wx, wy), shadow: null });
      }
    }
    return { meta: f, live };
  },
  macroColor(seed2, tx, ty) {
    const raised = isRaised(seed2, tx, ty);
    if (!raised && isRiver(seed2, tx, ty)) return COL_WATER;
    let c = isStone(seed2, tx, ty) && !isDirt(seed2, tx, ty) ? COL_STONE : isDirt(seed2, tx, ty) ? COL_DIRT2 : COL_GRASS2;
    if (raised) c = lerp3(c, COL_CLIFF, 0.25);
    return c;
  },
  tileIndexAt(wx, wy, meta) {
    if (!meta) return null;
    const { waterF, dirt, stone, M, SZ, x0, y0 } = meta;
    if (wx - x0 < 0 || wy - y0 < 0 || wx - x0 >= CHUNK2 || wy - y0 >= CHUNK2) return null;
    const idx = (i, j) => j * SZ + i;
    const pick2 = (fld, BLOCK, fill) => {
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
    if (waterF[idx(wx - x0 + M, wy - y0 + M)] === 1) return pick2(waterF, WATER_BLOCK, WATER_FILL);
    if (stone[idx(wx - x0 + M, wy - y0 + M)] === 1) return pick2(stone, STONE_BLOCK, STONE_FILL);
    if (dirt[idx(wx - x0 + M, wy - y0 + M)] === 1) return pick2(dirt, DIRT_BLOCK, DIRT_FILL);
    return GRASS_BASE;
  }
});
function createForgottenPlainsMap(pixi, host, opts = {}) {
  return createChunkedMap(pixi, host, { ...fpConfig(opts.seed ?? 1, { props: opts.props }), keyboardPan: opts.keyboardPan });
}

// ../auto-battler/src/engine/necropolisGen.js
var sub4 = (seed, salt) => (Math.imul(seed | 0, 2654435761) ^ (salt | 0)) >>> 0;
var RIVER_SCALE2 = 0.045;
var RIVER_WIDTH2 = 0.05;
var WARP_SCALE3 = 0.03;
var WARP_AMP3 = 16;
var DARK_SCALE = 0.06;
var DARK_THRESHOLD = 0.6;
function isDark(seed, x, y) {
  return fbm(sub4(seed, 55852), x * DARK_SCALE, y * DARK_SCALE) > DARK_THRESHOLD;
}
var ELEV_SCALE2 = 0.025;
var ELEV_THRESHOLD2 = 0.6;
function isRaised2(seed, x, y) {
  return fbm(sub4(seed, 57836), x * ELEV_SCALE2, y * ELEV_SCALE2) > ELEV_THRESHOLD2;
}
var BONE_SCALE = 0.055;
var BONE_THRESHOLD = 0.62;
function isBone(seed, x, y) {
  return fbm(sub4(seed, 45134), x * BONE_SCALE, y * BONE_SCALE) > BONE_THRESHOLD;
}
var FOREST_SCALE2 = 0.05;
function forestField2(seed, x, y) {
  return fbm(sub4(seed, 15740503), x * FOREST_SCALE2, y * FOREST_SCALE2);
}
function isRiver2(seed, x, y) {
  const wx = x + WARP_AMP3 * (fbm(sub4(seed, 1297), x * WARP_SCALE3, y * WARP_SCALE3) - 0.5);
  const wy = y + WARP_AMP3 * (fbm(sub4(seed, 1298), x * WARP_SCALE3, y * WARP_SCALE3) - 0.5);
  return Math.abs(fbm(sub4(seed, 8654), wx * RIVER_SCALE2, wy * RIVER_SCALE2) - 0.5) < RIVER_WIDTH2;
}

// ../auto-battler/src/render/necropolis.js
var NECRO = "/assets/minifantasy/Minifantasy_Necropolis_v1.0/Minifantasy_Necropolis_Assets";
var EXT_DIR = `${NECRO}/PremadeScenes/Exterior/SeparateLayers`;
var BIOME = `${NECRO}/Tileset/Biome/CorruptedBiome.png`;
var SHADOW2 = `${NECRO}/Tileset/Biome/CorruptedBiomeShadows.png`;
var PROPS2 = `${NECRO}/Props/Props.png`;
var PROP_SHADOW2 = `${NECRO}/Props/PropShadows.png`;
var NECRO_MAP_ASSETS = [BIOME, SHADOW2, PROPS2, PROP_SHADOW2];
var TILE4 = 8;
var CHUNK3 = 32;
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
var WATER_BLOCK2 = [4, 2];
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
var COL_WATER2 = [74, 142, 48];
var COL_BONE = [180, 156, 126];
var COL_CLIFF2 = [175, 146, 109];
var COL_FOREST = [96, 101, 70];
var NECRO_LAYERS = [
  ["m-bg", "Background", "ground"],
  ["l-corruptedland", "Corrupted land", "ground"],
  ["k-coruptewater", "Corrupted water", "ground"],
  ["j-bonepiles", "Bone piles", "scatter"],
  ["i-perimeter", "Perimeter", "structure"],
  ["h-path2", "Path (under)", "paths"],
  ["g-path", "Path", "paths"],
  ["f-ziggurat", "Ziggurat", "structure"],
  ["e-walls", "Walls", "structure"],
  ["d-cliff", "Cliff", "structure"],
  ["c-props", "Props", "scatter"],
  ["b-shadows", "Shadows", "lighting"],
  ["a-undeadflames", "Undead flames", "lighting"]
];
var NECRO_EXT_DIR = EXT_DIR;
var NECRO_SCENE = 360;
function corruptTile(N, E, S, W, NW, NE, SW2, SE) {
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
  const diag = (NW ? 1 : 0) + (NE ? 1 : 0) + (SW2 ? 1 : 0) + (SE ? 1 : 0);
  if (diag === 0) return null;
  if (diag === 1) return NW ? CONC_NW : NE ? CONC_NE : SW2 ? CONC_SW : CONC_SE;
  if (NW && SE && !NE && !SW2) return CONC_NWSE;
  if (NE && SW2 && !NW && !SE) return CONC_NESW;
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
  if (!raised && isRiver2(seed, tx, ty)) return COL_WATER2;
  if (isBone(seed, tx, ty)) return COL_BONE;
  let c = isDark(seed, tx, ty) ? COL_DARK : COL_LIGHT;
  if (forestField2(seed, tx, ty) > FOREST_THRESHOLD2) c = lerp3(c, COL_FOREST, 0.5);
  if (raised) c = lerp3(c, COL_CLIFF2, 0.22);
  return c;
}
function loadImg2(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
async function buildShadowMask2(url) {
  const img = await loadImg2(url);
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const cols = img.naturalWidth / TILE4 | 0, rows = img.naturalHeight / TILE4 | 0, set = /* @__PURE__ */ new Set();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const d = g.getImageData(c * TILE4, r * TILE4, TILE4, TILE4).data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 8) {
        set.add(c + "," + r);
        break;
      }
    }
  }
  return set;
}
function chunkFields3(seed, x0, y0) {
  const WATER_BUFFER = 2;
  const ELEV_BUFFER = 3;
  const M = Math.max(WATER_BUFFER, ELEV_BUFFER) + 4, SZ = CHUNK3 + 2 * M;
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
  tile: TILE4,
  chunk: CHUNK3,
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
  // `accept(tx,ty)` (chunk-local) gates which tiles this biome paints — defaults to all, so the
  // standalone map is unchanged; the multi-biome overworld passes a per-biome dither mask.
  bake({ x0, y0, seed: seed2, ctx, tmp, Sprite, tex, texFrame, add, accept = () => true }) {
    const f = chunkFields3(seed2, x0, y0);
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
        sh.x = tx * TILE4;
        sh.y = ty * TILE4;
        tmp.addChild(sh);
      }
    };
    for (let ty = 0; ty < CHUNK3; ty++) for (let tx = 0; tx < CHUNK3; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      if (!isLight(wx, wy)) {
        place(CORRUPT_DARK, tx, ty);
        continue;
      }
      const N = !isLight(wx, wy - 1), E = !isLight(wx + 1, wy), S = !isLight(wx, wy + 1), Wf = !isLight(wx - 1, wy);
      const NW = !isLight(wx - 1, wy - 1), NE = !isLight(wx + 1, wy - 1), SW2 = !isLight(wx - 1, wy + 1), SE = !isLight(wx + 1, wy + 1);
      const t = corruptTile(N, E, S, Wf, NW, NE, SW2, SE);
      if (!t) {
        place(sparse(CORRUPT_LIGHT, LIGHT_VARIANTS, wx, wy, 0, LIGHT_SPARSE_RATE, seed2), tx, ty);
        continue;
      }
      place(CORRUPT_DARK, tx, ty);
      place(t, tx, ty);
    }
    for (let ty = 0; ty < CHUNK3; ty++) for (let tx = 0; tx < CHUNK3; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      if (!isWater(wx, wy)) continue;
      const N = !isWater(wx, wy - 1), E = !isWater(wx + 1, wy), S = !isWater(wx, wy + 1), Wf = !isWater(wx - 1, wy);
      if (N && E && S && Wf) continue;
      let cr;
      if (!N && !E && !S && !Wf) cr = centerTile(WATER_BLOCK2, !isWater(wx - 1, wy - 1), !isWater(wx + 1, wy - 1), !isWater(wx - 1, wy + 1), !isWater(wx + 1, wy + 1));
      else cr = blockTile(WATER_BLOCK2, N, E, S, Wf);
      place(cr, tx, ty);
    }
    for (let ty = 0; ty < CHUNK3; ty++) for (let tx = 0; tx < CHUNK3; tx++) {
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
    if (ctx.props) for (let ty = 0; ty < CHUNK3; ty++) for (let tx = 0; tx < CHUNK3; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      if (isWater(wx, wy) || boneAt(wx, wy)) continue;
      const h2 = hashU32(seed2 ^ 15733114, wx, wy);
      if (h2 % FOLIAGE_RATE2 !== 0) continue;
      let pick2 = (h2 >>> 8) % FOLIAGE_WEIGHT2, g = FOLIAGE2[0];
      for (const grp of FOLIAGE2) {
        if (pick2 < grp.weight) {
          g = grp;
          break;
        }
        pick2 -= grp.weight;
      }
      const [c, r] = g.tiles[(h2 >>> 16) % g.tiles.length];
      if (g.shadow && ctx.propShadow) {
        const sh = new Sprite(texFrame(ctx.propShadow, c * TILE4, r * TILE4, TILE4, TILE4));
        sh.x = tx * TILE4;
        sh.y = ty * TILE4;
        tmp.addChild(sh);
      }
      const sp = new Sprite(texFrame(ctx.props, c * TILE4, r * TILE4, TILE4, TILE4));
      sp.x = tx * TILE4;
      sp.y = ty * TILE4;
      tmp.addChild(sp);
    }
    bakeCliffs(NECRO_CLIFF, { chunk: CHUNK3, x0, y0, seed: seed2, raised: isRaisedAt, place, accept });
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
      const bx0 = Math.floor(x0 / FOREST_BLOCK_X2), bx1 = Math.floor((x0 + CHUNK3 - 1) / FOREST_BLOCK_X2);
      const by0 = Math.floor(y0 / FOREST_BLOCK_Y2), by1 = Math.floor((y0 + CHUNK3 - 1) / FOREST_BLOCK_Y2);
      for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
        const h2 = hashU32(seed2 ^ 15748695, bx, by);
        const wx = bx * FOREST_BLOCK_X2 + h2 % FOREST_BLOCK_X2, wy = by * FOREST_BLOCK_Y2 + (h2 >>> 4) % FOREST_BLOCK_Y2;
        if (wx < x0 || wx >= x0 + CHUNK3 || wy < y0 || wy >= y0 + CHUNK3) continue;
        if (!accept(wx - x0, wy - y0)) continue;
        if (forestRegion[idx(wx - x0 + M, wy - y0 + M)] !== 1) continue;
        if ((h2 >>> 8 & 65535) / 65536 >= FOREST_FILL2) continue;
        if (nearWater(wx, wy) || boneAt(wx, wy) || nearCliff(wx, wy)) continue;
        const T = TREES2[(h2 >>> 24) % TREES2.length];
        const flip = (h2 >>> 20 & 255) / 256 < TREE_FLIP_RATE2;
        const sc = TREE_SCALE_BASE2 * (1 + ((h2 >>> 12 & 255) / 256 - 0.5) * 2 * TREE_SCALE_JITTER2);
        const px = wx * TILE4 + TILE4 / 2 + ((h2 >>> 16 & 15) / 16 - 0.5) * 2 * TREE_JITTER2;
        const py = wy * TILE4 + TILE4 / 2 + ((h2 >>> 28 & 15) / 16 - 0.5) * 2 * TREE_JITTER2;
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
    if (wx - x0 < 0 || wy - y0 < 0 || wx - x0 >= CHUNK3 || wy - y0 >= CHUNK3) return null;
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
function createNecropolisMap(pixi, host, opts = {}) {
  return createChunkedMap(pixi, host, necropolisConfig(opts.seed ?? 1, { props: opts.props }));
}

// ../auto-battler/src/engine/lostJungleGen.js
var sub5 = (seed, salt) => (Math.imul(seed | 0, 2654435761) ^ (salt | 0)) >>> 0;
var PLAIN_SCALE = 0.045;
var PLAIN_THRESHOLD = 0.62;
function isPlain(seed, x, y) {
  return fbm(sub5(seed, 49642), x * PLAIN_SCALE, y * PLAIN_SCALE) > PLAIN_THRESHOLD;
}
var BLOOM_SCALE = 0.05;
var BLOOM_THRESHOLD = 0.68;
function isBloom(seed, x, y) {
  return fbm(sub5(seed, 45324), x * BLOOM_SCALE, y * BLOOM_SCALE) > BLOOM_THRESHOLD;
}
var DEEP_SCALE = 0.055;
var DEEP_THRESHOLD = 0.6;
function isDeep(seed, x, y) {
  return fbm(sub5(seed, 57065), x * DEEP_SCALE, y * DEEP_SCALE) > DEEP_THRESHOLD;
}
var ELEV_SCALE3 = 0.05;
var ELEV_THRESHOLD3 = 0.6;
function isRaised3(seed, x, y) {
  return fbm(sub5(seed, 57836), x * ELEV_SCALE3, y * ELEV_SCALE3) > ELEV_THRESHOLD3;
}
var DIRT_SCALE2 = 0.05;
var DIRT_THRESHOLD2 = 0.66;
function isDirt2(seed, x, y) {
  return fbm(sub5(seed, 53655), x * DIRT_SCALE2, y * DIRT_SCALE2) > DIRT_THRESHOLD2;
}
var GOLD_SCALE = 0.06;
var GOLD_THRESHOLD = 0.72;
function isGold(seed, x, y) {
  return fbm(sub5(seed, 36893), x * GOLD_SCALE, y * GOLD_SCALE) > GOLD_THRESHOLD;
}
var FOREST_SCALE3 = 0.05;
function forestField3(seed, x, y) {
  return fbm(sub5(seed, 15760983), x * FOREST_SCALE3, y * FOREST_SCALE3);
}

// ../auto-battler/src/render/lostJungle.js
var LJ = "/assets/minifantasy/Minifantasy_Lost_Jungle_v1.0/Minifantasy_Lost_Jungle_Assets";
var TILES3 = `${LJ}/Tileset/Tileset.png`;
var SHADOW3 = `${LJ}/Tileset/Tileset_shadows.png`;
var PROPS3 = `${LJ}/Props/Props.png`;
var PROP_SHADOW3 = `${LJ}/Props/PropsShadows.png`;
var LJ_TILES_URL = TILES3;
var LJ_PROPS_URL = PROPS3;
var LJ_MOCKUP_URL = `${LJ}/_Mockup/LostJungleMockup.png`;
var LJ_MAP_ASSETS = [TILES3, SHADOW3, PROPS3, PROP_SHADOW3];
var TILE5 = 8;
var CHUNK4 = 32;
var ring = (rB) => ({
  N: [10, rB + 2],
  E: [9, rB + 1],
  S: [10, rB],
  W: [11, rB + 1],
  cNW: [11, rB + 2],
  cNE: [9, rB + 2],
  cSW: [11, rB],
  cSE: [9, rB],
  vNW: [10, rB + 4],
  vNE: [9, rB + 4],
  vSW: [10, rB + 3],
  vSE: [9, rB + 3],
  dNWSE: [11, rB + 4],
  dSWNE: [11, rB + 3]
});
var MOSS_BASE = [7, 19];
var MOSS_VARS = [[1, 19], [3, 19], [4, 19], [5, 19], [3, 20], [4, 20], [5, 20], [7, 20]];
var MOSS_RATE = 5;
var PLAIN_FILL = [7, 11];
var PLAIN_RING = ring(11);
var DARK_FILL = [7, 27];
var DARK_RING = ring(27);
var DARK_VARS = [[1, 27], [3, 27], [4, 27], [5, 27], [3, 28], [4, 28], [5, 28], [7, 28]];
var BLOOM_FILL = [7, 35];
var BLOOM_RING = ring(35);
var BLOOM_VARS = [[1, 35], [3, 35], [4, 35], [5, 35], [3, 36], [4, 36], [5, 36], [7, 36]];
var FILL_RATE2 = 5;
var CROWN_FILL = [66, 14];
var CROWN_VARS = [
  // clean light cells only (the demo's corner cells are shade gradients)
  [67, 14],
  [66, 15],
  [67, 15],
  [66, 16],
  [67, 16],
  [64, 18],
  [65, 18],
  [68, 18],
  [69, 18],
  [66, 30],
  [67, 30]
];
var CROWN_RATE = 2;
var SHADE_FILL = [60, 24];
var SHADE_VARS = [[61, 24], [72, 24], [73, 24], [66, 20], [67, 20], [68, 20]];
var CE = {
  N: { ax: "row", L: [[66, 25], [67, 25]], D: [] },
  S: { ax: "row", L: [], D: [[66, 21], [67, 21]] },
  W: { ax: "col", L: [[65, 14], [65, 15], [59, 22], [59, 23], [65, 31]], D: [[59, 24], [65, 32]] },
  E: { ax: "col", L: [[68, 14], [68, 15], [74, 22], [74, 23], [68, 31]], D: [[74, 24], [68, 32]] },
  // edge runs ending toward a corner (edge + ONE matching diagonal)
  W_NW: { ax: "col", L: [[65, 16], [62, 19], [69, 24]], D: [] },
  W_SW: { ax: "col", L: [[69, 22], [65, 30]], D: [[62, 27]] },
  E_NE: { ax: "col", L: [[68, 16], [71, 19], [64, 24]], D: [] },
  E_SE: { ax: "col", L: [[64, 22], [68, 30]], D: [[71, 27]] },
  N_NW: { ax: "row", L: [[64, 17], [61, 20], [68, 25]], D: [] },
  N_NE: { ax: "row", L: [[69, 17], [72, 20], [65, 25]], D: [] },
  S_SW: { ax: "row", L: [], D: [[68, 21], [61, 26], [64, 29]] },
  S_SE: { ax: "row", L: [], D: [[65, 21], [72, 26], [69, 29]] },
  // Convex corners are TWO-CELL arcs in the demo: a CURVE cell + a FINISHER cell on the
  // adjacent staircase step, distinguished by which extra diagonal is outside. Mixing the
  // halves breaks the line — pick by the mask, never at random across the pair.
  NW_c: { L: [[66, 12], [63, 17], [60, 20]], D: [] },
  NW_f: { L: [[65, 13], [62, 18], [59, 21]], D: [] },
  NE_c: { L: [[67, 12], [70, 17], [73, 20]], D: [] },
  NE_f: { L: [[68, 13], [71, 18], [74, 21]], D: [] },
  SW_c: { L: [], D: [[59, 25], [62, 28], [65, 33]] },
  SW_f: { L: [], D: [[60, 26], [63, 29], [66, 34]] },
  SE_c: { L: [], D: [[74, 25], [71, 28], [68, 33]] },
  SE_f: { L: [], D: [[73, 26], [70, 29], [67, 34]] },
  // concave notches (one foreign diagonal)
  cNW: { L: [[66, 13], [65, 17], [63, 18], [62, 20], [60, 21], [69, 25]], D: [] },
  cNE: { L: [[67, 13], [68, 17], [70, 18], [71, 20], [73, 21], [64, 25]], D: [] },
  cSE: { L: [[64, 21], [71, 26], [68, 29]], D: [[73, 25], [70, 28], [67, 33]] },
  cSW: { L: [[69, 21], [62, 26], [65, 29]], D: [[60, 25], [63, 28], [66, 33]] }
};
function crownTile(N, E, S, W, NW, NE, SW2, SE) {
  const card = N + E + S + W;
  if (card >= 2) {
    if (N && W) return SW2 && !NE ? CE.NW_f : CE.NW_c;
    if (N && E) return SE && !NW ? CE.NE_f : CE.NE_c;
    if (S && W) return SE && !NW ? CE.SW_f : CE.SW_c;
    if (S && E) return SW2 && !NE ? CE.SE_f : CE.SE_c;
    return N ? CE.N : CE.E;
  }
  if (card === 1) {
    if (N) return NW && !NE ? CE.N_NW : NE && !NW ? CE.N_NE : CE.N;
    if (S) return SW2 && !SE ? CE.S_SW : SE && !SW2 ? CE.S_SE : CE.S;
    if (W) return NW && !SW2 ? CE.W_NW : SW2 && !NW ? CE.W_SW : CE.W;
    return NE && !SE ? CE.E_NE : SE && !NE ? CE.E_SE : CE.E;
  }
  const diag = NW + NE + SW2 + SE;
  if (diag === 0) return null;
  if (NW && SE && !NE && !SW2) return CE.cNW;
  if (NE && SW2 && !NW && !SE) return CE.cNE;
  if (diag === 1) return NW ? CE.cNW : NE ? CE.cNE : SW2 ? CE.cSW : CE.cSE;
  return null;
}
var TRUNK_H = 3;
var TRUNK_COLS = [[497, 312, 23, 32], [520, 312, 32, 32], [552, 312, 23, 32]];
var SKIRT_K = [4, 5];
var VINES = [{ f: [89, 8, 14, 20] }, { f: [89, 40, 14, 15] }, { f: [99, 64, 3, 20] }];
var VINE_RATE = 6;
var GOLD_BLOCK = [14, 41];
var GOLD_FILL = [15, 42];
var GOLD_VARS = [[19, 42]];
var GOLD_LONE = [[15, 39], [19, 39]];
var MOSSY_RING = ring(19);
var DIRT_FILLS = [[15, 3], [16, 3], [15, 4], [16, 4]];
var DIRT_VARS3 = [[7, 3], [9, 3], [10, 3], [11, 3], [9, 4], [10, 4], [11, 4]];
var DIRT_VAR_RATE = 4;
var PAL_CAP = [[34, 41], [35, 41], [36, 41], [37, 41]];
var PAL_SHAFT_L = [34, 42];
var PAL_SHAFT_R = [37, 42];
var PAL_SHAFT = [[35, 42], [36, 42]];
var PAL_FEET = [[34, 43], [35, 43], [36, 43], [37, 43]];
var PAL_MIN_RUN = 3;
var PILLARS = [
  // single standing pillars, px frames (bases included)
  { f: [432, 312, 8, 64], weight: 1 },
  // tall menhir
  { f: [448, 333, 8, 43], weight: 2 }
  // short menhir
];
var PILLAR_WEIGHT = PILLARS.reduce((s, p) => s + p.weight, 0);
var PILLAR_FILL = 0.22;
var CANOPIES = [
  // round canopy-tree props — grove scatter (also on crown tops)
  { f: [24, 48, 16, 16], weight: 4 },
  // big round canopy
  { f: [48, 48, 8, 8], weight: 3 },
  // small round canopy
  { f: [178, 34, 12, 12], weight: 2 },
  // leafy canopy
  { f: [179, 51, 9, 9], weight: 2 }
  // small leafy canopy
];
var CANOPY_WEIGHT = CANOPIES.reduce((s, p) => s + p.weight, 0);
var GROVE_BLOCK_X = 2;
var GROVE_BLOCK_Y = 2;
var GROVE_THRESHOLD = 0.62;
var GROVE_MIN_NB = 2;
var GROVE_FILL = 0.5;
var TREES3 = [
  // solitary trees — sparse
  { f: [179, 65, 26, 30], weight: 2 },
  // big jungle tree
  { f: [145, 16, 13, 15], weight: 3 },
  // small standing tree
  { f: [145, 66, 14, 13], weight: 2 },
  // palm A
  { f: [161, 65, 14, 14], weight: 2 },
  // palm B
  { f: [11, 5, 20, 22], weight: 2 },
  // dead snag (large)
  { f: [49, 6, 22, 21], weight: 2 },
  // dead snag (wide)
  { f: [36, 12, 10, 15], weight: 1 }
  // dead snag (small)
];
var TREE_WEIGHT = TREES3.reduce((s, p) => s + p.weight, 0);
var TREE_BLOCK_X = 7;
var TREE_BLOCK_Y = 6;
var TREE_FILL = 0.3;
var PLANTS = [
  // mid-size flora — bushes, ferns, tropical flowers
  { f: [146, 36, 13, 11], weight: 2 },
  { f: [161, 36, 13, 11], weight: 2 },
  // fern trees
  { f: [146, 52, 13, 11], weight: 2 },
  { f: [161, 52, 13, 11], weight: 2 },
  // drooping plants
  { f: [146, 84, 13, 11], weight: 2 },
  { f: [161, 84, 13, 11], weight: 2 },
  // big leafy plants
  { f: [162, 22, 12, 9], weight: 2 },
  // bush pair
  { f: [121, 67, 14, 12], weight: 1 },
  // giant red bloom
  { f: [122, 84, 13, 11], weight: 1 },
  // blue spread bloom
  { f: [123, 36, 11, 11], weight: 1 },
  // orange tropical plant
  { f: [122, 49, 10, 14], weight: 1 },
  // blue-orange flower
  { f: [120, 16, 8, 16], weight: 1 },
  // red flower
  { f: [128, 16, 8, 16], weight: 1 }
  // purple flower
];
var PLANT_WEIGHT = PLANTS.reduce((s, p) => s + p.weight, 0);
var PLANT_BLOCK_X = 5;
var PLANT_BLOCK_Y = 4;
var PLANT_FILL = 0.18;
var DEBRIS = [
  // fallen logs, branches, stumps — live (multi-tile)
  { f: [2, 56, 15, 8], weight: 2 },
  { f: [63, 56, 15, 8], weight: 2 },
  // fallen logs
  { f: [5, 66, 12, 5], weight: 2 },
  { f: [63, 66, 12, 5], weight: 2 },
  // thin logs
  { f: [5, 41, 12, 15], weight: 1 },
  { f: [63, 41, 12, 15], weight: 1 },
  // dead branches
  { f: [24, 78, 8, 15], weight: 1 },
  { f: [33, 78, 14, 12], weight: 1 },
  { f: [50, 78, 6, 12], weight: 1 }
  // roots/stumps
];
var DEBRIS_WEIGHT = DEBRIS.reduce((s, p) => s + p.weight, 0);
var DEBRIS_BLOCK_X = 9;
var DEBRIS_BLOCK_Y = 7;
var DEBRIS_FILL = 0.25;
var CLUTTER = [
  // tiny baked ground cover (≤1 tile): fern fronds + twigs
  { f: [120, 8, 8, 8] },
  { f: [128, 8, 8, 8] },
  { f: [136, 8, 8, 8] },
  // fern fronds
  { f: [25, 34, 6, 7] },
  { f: [49, 35, 6, 6] }
  // twigs
];
var CLUTTER_RATE = 13;
var LJ_TILE_CATALOG = [
  // ── ground variations (flat fills picked via sparse()) ─────────────────────────────
  {
    role: "surface",
    name: "Mossy floor (band 3)",
    frame: [1, 20, 7, 2],
    used: true,
    note: "THE base ground \u2014 fill [7,19] + speckle variants (cols 1\u20135, rows 19\u201320)"
  },
  {
    role: "surface",
    name: "Plain green (band 2)",
    frame: [7, 11, 1, 1],
    used: true,
    note: "plain-green material \u2014 drawn as ground PATCHES with its own ring (below)"
  },
  {
    role: "surface",
    name: "Dark moss (band 4)",
    frame: [1, 28, 7, 2],
    used: true,
    note: "darker fills \u2014 the deep-undergrowth patch interiors"
  },
  {
    role: "surface",
    name: "Yellow blooms (band 5)",
    frame: [1, 36, 7, 2],
    used: true,
    note: "flowering-meadow fills \u2014 rare bloom patches with their own ring"
  },
  {
    role: "surface",
    name: "Terracotta rubble (band 1)",
    frame: [7, 4, 5, 2],
    used: true,
    note: "loose dirt/rubble fills sprinkled inside the dirt patches"
  },
  {
    role: "surface",
    name: "Tree-crown canopy (light)",
    frame: [64, 18, 6, 1],
    used: true,
    note: "the giant-tree CROWN texture \u2014 17 dappled-leaf variants from the blob-demo interior"
  },
  {
    role: "surface",
    name: "Tree-crown canopy (shaded)",
    frame: [60, 24, 2, 1],
    used: true,
    note: "the crown\u2019s self-shadow cells \u2014 a 2-row band along every canopy south edge (as on every mockup tree)"
  },
  {
    role: "surface",
    name: "Golden soil (isolated)",
    frame: [15, 39, 5, 1],
    tiles: [[15, 39], [19, 39]],
    used: true,
    note: "single-cell golden-soil tiles for isolated pit cells"
  },
  // ── transitions (autotile edges between materials) ─────────────────────────────────
  {
    role: "transition",
    name: "Canopy rim (blob demo)",
    frame: [59, 34, 17, 23],
    used: true,
    note: "the demo IS the autotile table: mask-classified \u2192 2\u20138 art variants per case. Heavy black organic rim around the tree crowns; S edges hand off to the trunk rows"
  },
  {
    role: "transition",
    name: "Ring \u2014 plain green (band 2)",
    frame: [9, 15, 3, 5],
    used: true,
    note: "necropolis-convention donut ring + tips \u2014 plain-green patch edges (terracotta-red rim, as in the mockup)"
  },
  {
    role: "transition",
    name: "Ring \u2014 dark moss (band 4)",
    frame: [9, 31, 3, 5],
    used: true,
    note: "deep-undergrowth patch edges"
  },
  {
    role: "transition",
    name: "Ring \u2014 blooms (band 5)",
    frame: [9, 39, 3, 5],
    used: true,
    note: "bloom-meadow patch edges"
  },
  {
    role: "transition",
    name: "Ring \u2014 mossy (band 3)",
    frame: [9, 23, 3, 5],
    used: true,
    note: "the base floor\u2019s ring rims patches cut INTO the moss \u2014 the terracotta dirt patches and trunk skirts use it (the mockup\u2019s dithered red arc), with band-1 fills inside"
  },
  {
    role: "transition",
    name: "Pillar-rimmed block (4\xD74, band 1)",
    frame: [14, 5, 4, 4],
    used: false,
    note: "terracotta block with grey pillar caps/feet on the N/S edges \u2014 a pillar-PLATFORM premade, not a patch edge (dirt patches rim with the mossy ring instead)"
  },
  {
    role: "transition",
    name: "Golden-soil pit (blob A)",
    frame: [14, 45, 3, 5],
    used: true,
    note: "FP-format blob \u2014 3\xD73 block [14,41] via blockTile + 2 concave rows via centerTile; fill [15,42]"
  },
  {
    role: "transition",
    name: "Golden-soil pit (blob B)",
    frame: [18, 45, 3, 5],
    used: true,
    note: "second blob variation \u2014 its fill [19,42] is mixed into blob A\u2019s interior"
  },
  // ── elevation kit: trunks, retaining walls, pillar structures ───────────────────────
  {
    role: "face",
    name: "Bark trunk wall",
    frame: [62, 39, 10, 4],
    used: true,
    note: "the canopy\u2019s south drop: 3 full bark rows 36\u201338 (row 36\u2019s top = the black canopy join) + root-fringe overhang row 39; L/R caps cols 62\u201363/70\u201371"
  },
  {
    role: "face",
    name: "Trunk columns (single)",
    frame: [62, 43, 10, 4],
    used: true,
    note: "4-row single-trunk px frames with root flares \u2014 drawn under NARROW (\u22642-wide) canopy south edges: small trees"
  },
  {
    role: "structure",
    name: "Retaining wall \u2014 wedge (small)",
    frame: [23, 7, 2, 6],
    used: false,
    note: "diagonal pillar retaining wall; L [23] / R [27] mirror pair; \xD75 material tops at the 8-row band pitch = the elevated ground above the wall. Intended as canopy-mass edging, not free-standing decor \u2014 not wired yet"
  },
  {
    role: "structure",
    name: "Retaining wall \u2014 wedge (medium)",
    frame: [31, 7, 4, 7],
    used: false,
    note: "L [31] / R [37]; \xD75 band tops \u2014 not wired (see small wedge note)"
  },
  {
    role: "structure",
    name: "Retaining wall \u2014 wedge (large)",
    frame: [43, 7, 6, 8],
    used: false,
    note: "L [43] / R [51]; \xD75 band tops \u2014 the mockup\u2019s big pillar terraces; not wired"
  },
  {
    role: "structure",
    name: "Pillar platform premade",
    frame: [14, 13, 4, 4],
    used: false,
    note: "raised pillar-edged platform, one per band (rows 10\u201313 / 18\u201321 / 26\u201329 / 34\u201337) \u2014 band 1\u2019s doubles as the dirt-patch rim above"
  },
  {
    role: "structure",
    name: "Mound premade (small)",
    frame: [19, 13, 2, 2],
    used: false,
    note: "small round raised mound, one per band (cols 19\u201320)"
  },
  {
    role: "structure",
    name: "Palisade strip A",
    frame: [24, 43, 4, 3],
    used: false,
    note: "4-wide pillar palisade premade \u2014 strip B is wired instead"
  },
  {
    role: "structure",
    name: "Palisade strip B",
    frame: [34, 44, 4, 4],
    used: true,
    note: "caps [34\u201337,41] / shafts row 42 (L/R end caps) / feet row 43 \u2014 drawn per-cell along dirt-patch north edges (runs \u22653)"
  },
  {
    role: "structure",
    name: "Pillar cluster",
    frame: [47, 45, 7, 6],
    used: false,
    note: "pre-assembled cluster (px 382,325) \u2014 not scattered (was too busy); available as a set-piece stamp"
  },
  {
    role: "structure",
    name: "Menhir (tall)",
    frame: [54, 46, 1, 8],
    used: true,
    note: "standing pillar + base \u2014 live sprite, dirt patches only"
  },
  {
    role: "structure",
    name: "Menhir (short)",
    frame: [56, 46, 1, 6],
    used: true,
    note: "standing pillar + base \u2014 live sprite, dirt patches only"
  },
  // ── void ────────────────────────────────────────────────────────────────────────────
  {
    role: "void",
    name: "Sinkhole pit",
    frame: [65, 24, 4, 6],
    used: true,
    note: "the blob demo\u2019s pit: shaded depression around a black hole; its gradient N/S cells double as the crown\u2019s straight-edge rim tiles"
  }
];
var LJ_PROP_CATALOG = [
  { role: "prop", name: "Big round canopy", frame: [3, 7, 2, 2], used: true, note: "grove scatter (also on crown tops)" },
  { role: "prop", name: "Small round canopy", frame: [6, 7, 1, 1], used: true, note: "grove scatter" },
  { role: "prop", name: "Leafy canopy", frame: [22, 5, 2, 2], used: true, note: "grove scatter" },
  { role: "prop", name: "Small leafy canopy", frame: [22, 7, 2, 2], used: true, note: "grove scatter" },
  { role: "prop", name: "Big jungle tree", frame: [22, 11, 4, 4], used: true, note: "solitary scatter" },
  { role: "prop", name: "Small tree", frame: [18, 3, 2, 2], used: true, note: "solitary scatter" },
  { role: "prop", name: "Palm A", frame: [18, 9, 2, 2], used: true, note: "solitary scatter" },
  { role: "prop", name: "Palm B", frame: [20, 9, 2, 2], used: true, note: "solitary scatter" },
  { role: "prop", name: "Dead snag (large)", frame: [1, 3, 3, 3], used: true, note: "solitary scatter" },
  { role: "prop", name: "Dead snag (wide)", frame: [6, 3, 3, 3], used: true, note: "solitary scatter" },
  { role: "prop", name: "Dead snag (small)", frame: [4, 3, 2, 2], used: true, note: "solitary scatter" },
  { role: "prop", name: "Fern tree A", frame: [18, 5, 2, 2], used: true, note: "mid-size flora scatter" },
  { role: "prop", name: "Fern tree B", frame: [20, 5, 2, 2], used: true, note: "mid-size flora scatter" },
  { role: "prop", name: "Drooping plant A", frame: [18, 7, 2, 2], used: true, note: "mid-size flora scatter" },
  { role: "prop", name: "Drooping plant B", frame: [20, 7, 2, 2], used: true, note: "mid-size flora scatter" },
  { role: "prop", name: "Big leafy plant A", frame: [18, 11, 2, 2], used: true, note: "mid-size flora scatter" },
  { role: "prop", name: "Big leafy plant B", frame: [20, 11, 2, 2], used: true, note: "mid-size flora scatter" },
  { role: "prop", name: "Bush pair", frame: [20, 3, 2, 2], used: true, note: "mid-size flora scatter" },
  { role: "prop", name: "Giant red bloom", frame: [15, 9, 2, 2], used: true, note: "rare tropical flower" },
  { role: "prop", name: "Blue spread bloom", frame: [15, 11, 2, 2], used: true, note: "rare tropical flower" },
  { role: "prop", name: "Orange tropical plant", frame: [15, 5, 2, 2], used: true, note: "rare tropical flower" },
  { role: "prop", name: "Blue-orange flower", frame: [15, 7, 2, 2], used: true, note: "rare tropical flower" },
  { role: "prop", name: "Red flower", frame: [15, 3, 1, 2], used: true, note: "rare tropical flower" },
  { role: "prop", name: "Purple flower", frame: [16, 3, 1, 2], used: true, note: "rare tropical flower" },
  { role: "prop", name: "Hanging vine (U, big)", frame: [11, 3, 2, 3], used: true, note: "draped over the wide trunk walls" },
  { role: "prop", name: "Hanging vine (U, small)", frame: [11, 6, 2, 2], used: true, note: "draped over the wide trunk walls" },
  { role: "prop", name: "Hanging vine (strand)", frame: [12, 10, 1, 3], used: true, note: "draped over the wide trunk walls" },
  { role: "decor", name: "Fern fronds \xD73", frame: [15, 1, 3, 1], used: true, note: "baked 1-tile ground clutter" },
  { role: "decor", name: "Twigs", frame: [3, 4, 1, 1], used: true, note: "baked 1-tile ground clutter" },
  { role: "prop", name: "Fallen logs / branches / stumps", frame: [0, 7, 2, 1], used: true, note: "live debris scatter (cols 0\u20139)" }
];
var COL_MOSS = [87, 116, 86];
var COL_CROWN = [123, 138, 85];
var COL_DARK2 = [76, 106, 84];
var COL_PLAIN = [72, 108, 88];
var COL_BLOOM = [110, 122, 78];
var COL_DIRT3 = [148, 86, 60];
var COL_GOLD = [203, 157, 76];
var COL_GROVE = [62, 92, 66];
var LJ_GROUND_FILLS = [
  { key: "moss", url: TILES3, tile: MOSS_BASE },
  { key: "plain", url: TILES3, tile: PLAIN_FILL },
  { key: "dark", url: TILES3, tile: DARK_FILL }
];
function ljGroundFillKey(seed, x, y) {
  if (isRaised3(seed, x, y) || isDeep(seed, x, y)) return "dark";
  if (isPlain(seed, x, y)) return "plain";
  return "moss";
}
function loadImg3(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
async function buildShadowMask3(url) {
  const img = await loadImg3(url);
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const cols = img.naturalWidth / TILE5 | 0, rows = img.naturalHeight / TILE5 | 0, set = /* @__PURE__ */ new Set();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const d = g.getImageData(c * TILE5, r * TILE5, TILE5, TILE5).data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 8) {
        set.add(c + "," + r);
        break;
      }
    }
  }
  return set;
}
function smoothSteps(field, SZ) {
  const idx = (i, j) => j * SZ + i;
  for (let pass = 0; pass < 4; pass++) {
    const F = field.slice();
    const at = (i, j) => F[idx(i, j)] === 1;
    let changed = false;
    for (let j = 2; j < SZ - 2; j++) for (let i = 2; i < SZ - 2; i++) {
      if (!at(i, j)) continue;
      const edgeW = !at(i - 1, j), edgeE = !at(i + 1, j), edgeN = !at(i, j - 1), edgeS = !at(i, j + 1);
      const loneV = (out, di) => out && !(at(i, j - 1) && !at(i + di, j - 1)) && !(at(i, j + 1) && !at(i + di, j + 1));
      const loneH = (out, dj) => out && !(at(i - 1, j) && !at(i - 1, j + dj)) && !(at(i + 1, j) && !at(i + 1, j + dj));
      if (loneV(edgeW, -1) || loneV(edgeE, 1) || loneH(edgeN, -1) || loneH(edgeS, 1)) {
        field[idx(i, j)] = 0;
        changed = true;
      }
    }
    if (!changed) break;
  }
}
function erodeSlivers(field, SZ) {
  const idx = (i, j) => j * SZ + i;
  for (let pass = 0; pass < 3; pass++) {
    const prev = field.slice();
    let changed = false;
    for (let j = 1; j < SZ - 1; j++) for (let i = 1; i < SZ - 1; i++) {
      if (!prev[idx(i, j)]) continue;
      const up = prev[idx(i, j - 1)], down = prev[idx(i, j + 1)], left = prev[idx(i - 1, j)], right = prev[idx(i + 1, j)];
      if (!up && !down || !left && !right) {
        field[idx(i, j)] = 0;
        changed = true;
      }
    }
    if (!changed) break;
  }
}
function chunkFields4(seed, x0, y0) {
  const CLIFF_BUF = 3;
  const M = 8, SZ = CHUNK4 + 2 * M;
  const idx = (i, j) => j * SZ + i;
  const raisedF = cleanField((lx, ly) => isRaised3(seed, x0 + lx, y0 + ly), M, SZ);
  erodeSlivers(raisedF, SZ);
  smoothSteps(raisedF, SZ);
  erodeSlivers(raisedF, SZ);
  const southE = (i, j) => raisedF[idx(i, j)] === 1 && raisedF[idx(i, j + 1)] !== 1;
  const trunkEdge = new Uint8Array(SZ * SZ);
  const stubEdge = new Uint8Array(SZ * SZ);
  for (let j = 1; j < SZ - 5; j++) for (let i = 1; i < SZ - 1; i++) {
    if (!southE(i, j) || southE(i - 1, j)) continue;
    let r = i;
    while (r + 1 < SZ - 1 && southE(r + 1, j)) r++;
    let clear = true;
    for (let x = i; x <= r && clear; x++) for (let d = 2; d <= 4; d++) if (raisedF[idx(x, j + d)]) {
      clear = false;
      break;
    }
    if (!clear) {
      i = r;
      continue;
    }
    const len = r - i + 1;
    if (len >= 3) {
      for (let x = i; x <= r; x++) trunkEdge[idx(x, j)] = 1;
    } else if (!raisedF[idx(i - 1, j)] && !raisedF[idx(r + 1, j)]) stubEdge[idx(i, j)] = 1;
    i = r;
  }
  const plainF = cleanField((lx, ly) => isPlain(seed, x0 + lx, y0 + ly) && !isRaised3(seed, x0 + lx, y0 + ly), M, SZ);
  const deepF = cleanField((lx, ly) => {
    const wx = x0 + lx, wy = y0 + ly;
    if (!isDeep(seed, wx, wy) || isRaised3(seed, wx, wy)) return false;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (isPlain(seed, wx + di, wy + dj)) return false;
    return true;
  }, M, SZ);
  const bloomF = cleanField((lx, ly) => {
    const wx = x0 + lx, wy = y0 + ly;
    if (!isBloom(seed, wx, wy) || isRaised3(seed, wx, wy) || isDeep(seed, wx, wy)) return false;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (isPlain(seed, wx + di, wy + dj)) return false;
    return true;
  }, M, SZ);
  const dirtNoise = cleanField((lx, ly) => {
    const wx = x0 + lx, wy = y0 + ly;
    if (!isDirt2(seed, wx, wy) || isRaised3(seed, wx, wy) || isPlain(seed, wx, wy)) return false;
    for (let dj = -CLIFF_BUF; dj <= CLIFF_BUF; dj++) for (let di = -CLIFF_BUF; di <= CLIFF_BUF; di++) if (isRaised3(seed, wx + di, wy + dj)) return false;
    return true;
  }, M, SZ);
  erodeSlivers(dirtNoise, SZ);
  const dirtF = dirtNoise.slice();
  for (let j = SKIRT_K[1]; j < SZ; j++) for (let i = 0; i < SZ; i++) {
    if (raisedF[idx(i, j)]) continue;
    for (let k = 1; k <= SKIRT_K[1]; k++) {
      if (!raisedF[idx(i, j - k)]) continue;
      if (k >= SKIRT_K[0] && trunkEdge[idx(i, j - k)]) dirtF[idx(i, j)] = 1;
      break;
    }
  }
  const goldF = cleanField((lx, ly) => {
    const wx = x0 + lx, wy = y0 + ly;
    if (!isGold(seed, wx, wy) || isDirt2(seed, wx, wy) || isPlain(seed, wx, wy) || isDeep(seed, wx, wy) || isBloom(seed, wx, wy)) return false;
    for (let dj = -CLIFF_BUF; dj <= CLIFF_BUF; dj++) for (let di = -CLIFF_BUF; di <= CLIFF_BUF; di++) if (isRaised3(seed, wx + di, wy + dj)) return false;
    return true;
  }, M, SZ);
  const graw = new Uint8Array(SZ * SZ);
  for (let j = 0; j < SZ; j++) for (let i = 0; i < SZ; i++) graw[idx(i, j)] = forestField3(seed, x0 + i - M, y0 + j - M) > GROVE_THRESHOLD ? 1 : 0;
  const groveRegion = new Uint8Array(SZ * SZ);
  for (let j = 1; j < SZ - 1; j++) for (let i = 1; i < SZ - 1; i++) {
    if (!graw[idx(i, j)]) continue;
    let c = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && graw[idx(i + di, j + dj)]) c++;
    groveRegion[idx(i, j)] = c >= GROVE_MIN_NB ? 1 : 0;
  }
  return { plainF, deepF, bloomF, dirtF, goldF, raisedF, trunkEdge, stubEdge, groveRegion, M, SZ, x0, y0 };
}
var ljConfig = (seed, opts = {}) => ({
  seed,
  tile: TILE5,
  chunk: CHUNK4,
  background: "#577356",
  async load({ Assets }) {
    const ctx = { tiles: null, shadow: null, shadowSet: null, props: null, propShadow: null };
    const t = await Assets.load(TILES3);
    t.source.scaleMode = "nearest";
    ctx.tiles = t.source;
    try {
      const s = await Assets.load(SHADOW3);
      s.source.scaleMode = "nearest";
      ctx.shadow = s.source;
    } catch {
    }
    try {
      ctx.shadowSet = await buildShadowMask3(SHADOW3);
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
  bake({ x0, y0, seed: seed2, ctx, tmp, Sprite, tex, texFrame, add, accept = () => true }) {
    const f = chunkFields4(seed2, x0, y0);
    const { plainF, deepF, bloomF, dirtF, goldF, raisedF, trunkEdge, stubEdge, groveRegion, M, SZ } = f;
    const idx = (i, j) => j * SZ + i;
    const at = (fld) => (wx, wy) => fld[idx(wx - x0 + M, wy - y0 + M)] === 1;
    const plainAt = at(plainF), deepAt = at(deepF), bloomAt = at(bloomF), dirtAt = at(dirtF), goldAt = at(goldF), raisedAt = at(raisedF);
    const trunkAt = at(trunkEdge), stubAt = at(stubEdge);
    const place = (coord, tx, ty) => {
      add(ctx.tiles, coord[0], coord[1], tx, ty);
      if (ctx.shadow && (!ctx.shadowSet || ctx.shadowSet.has(coord[0] + "," + coord[1]))) {
        const sh = new Sprite(tex(ctx.shadow, coord[0], coord[1]));
        sh.x = tx * TILE5;
        sh.y = ty * TILE5;
        tmp.addChild(sh);
      }
    };
    const pickVar = (list, wx, wy, salt) => list[rhash(wx, wy, salt, seed2) % list.length];
    const patch = (atFn, RING, fillBase, fillVars, salt, wx, wy, tx, ty) => {
      const N = !atFn(wx, wy - 1), E = !atFn(wx + 1, wy), S = !atFn(wx, wy + 1), W = !atFn(wx - 1, wy);
      const NW = !atFn(wx - 1, wy - 1), NE = !atFn(wx + 1, wy - 1), SW2 = !atFn(wx - 1, wy + 1), SE = !atFn(wx + 1, wy + 1);
      const t = autotile(RING, N, E, S, W, NW, NE, SW2, SE);
      place(t || sparse(fillBase, fillVars, wx, wy, salt, FILL_RATE2, seed2), tx, ty);
    };
    const southEdge = (wx, wy) => raisedAt(wx, wy) && !raisedAt(wx, wy + 1);
    const barkCol = (wx, ey) => {
      if (!trunkAt(wx - 1, ey)) return 63;
      if (!trunkAt(wx + 1, ey)) return 70;
      return 64 + rhash(wx, ey, 47692, seed2) % 6;
    };
    const onFace = (wx, wy) => {
      if (raisedAt(wx, wy)) return false;
      for (let k = 1; k <= TRUNK_H + 1; k++) if (raisedAt(wx, wy - k)) return true;
      return false;
    };
    for (let ty = 0; ty < CHUNK4; ty++) for (let tx = 0; tx < CHUNK4; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      place(sparse(MOSS_BASE, MOSS_VARS, wx, wy, 0, MOSS_RATE, seed2), tx, ty);
      if (plainAt(wx, wy)) patch(plainAt, PLAIN_RING, PLAIN_FILL, [], 194, wx, wy, tx, ty);
      else if (deepAt(wx, wy)) patch(deepAt, DARK_RING, DARK_FILL, DARK_VARS, 210, wx, wy, tx, ty);
      else if (bloomAt(wx, wy)) patch(bloomAt, BLOOM_RING, BLOOM_FILL, BLOOM_VARS, 178, wx, wy, tx, ty);
    }
    for (let ty = 0; ty < CHUNK4; ty++) for (let tx = 0; tx < CHUNK4; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      if (goldAt(wx, wy)) {
        const N = !goldAt(wx, wy - 1), E = !goldAt(wx + 1, wy), S = !goldAt(wx, wy + 1), W = !goldAt(wx - 1, wy);
        if (N && E && S && W) place(pickVar(GOLD_LONE, wx, wy, 144), tx, ty);
        else if (!N && !E && !S && !W) {
          const dNW = !goldAt(wx - 1, wy - 1), dNE = !goldAt(wx + 1, wy - 1), dSW = !goldAt(wx - 1, wy + 1), dSE = !goldAt(wx + 1, wy + 1);
          if (!dNW && !dNE && !dSW && !dSE) place(sparse(GOLD_FILL, GOLD_VARS, wx, wy, 145, FILL_RATE2, seed2), tx, ty);
          else place(centerTile(GOLD_BLOCK, dNW, dNE, dSW, dSE), tx, ty);
        } else place(blockTile(GOLD_BLOCK, N, E, S, W), tx, ty);
      }
      if (dirtAt(wx, wy)) {
        const N = !dirtAt(wx, wy - 1) && !onFace(wx, wy), E = !dirtAt(wx + 1, wy), S = !dirtAt(wx, wy + 1), W = !dirtAt(wx - 1, wy);
        const NW = !dirtAt(wx - 1, wy - 1) && !onFace(wx, wy), NE = !dirtAt(wx + 1, wy - 1) && !onFace(wx, wy);
        const SW2 = !dirtAt(wx - 1, wy + 1), SE = !dirtAt(wx + 1, wy + 1);
        const t = autotile(MOSSY_RING, N, E, S, W, NW, NE, SW2, SE);
        if (t) place(t, tx, ty);
        else place(sparse(DIRT_FILLS[rhash(wx, wy, 211, seed2) % DIRT_FILLS.length], DIRT_VARS3, wx, wy, 212, DIRT_VAR_RATE, seed2), tx, ty);
      }
    }
    const palAnchor = (wx, wy) => {
      if (!dirtAt(wx, wy) || dirtAt(wx, wy - 1)) return false;
      if (onFace(wx, wy) || onFace(wx, wy - 1)) return false;
      let run = 1;
      for (let d = 1; d <= 5 && dirtAt(wx - d, wy) && !dirtAt(wx - d, wy - 1); d++) run++;
      for (let d = 1; d <= 5 && dirtAt(wx + d, wy) && !dirtAt(wx + d, wy - 1); d++) run++;
      return run >= PAL_MIN_RUN;
    };
    for (let ty = 0; ty < CHUNK4; ty++) for (let tx = 0; tx < CHUNK4; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      if (palAnchor(wx, wy + 1)) place(pickVar(PAL_CAP, wx, wy, 161), tx, ty);
      if (palAnchor(wx, wy)) {
        const L = !palAnchor(wx - 1, wy), R = !palAnchor(wx + 1, wy);
        place(L ? PAL_SHAFT_L : R ? PAL_SHAFT_R : pickVar(PAL_SHAFT, wx, wy, 162), tx, ty);
      }
      if (palAnchor(wx, wy - 1) && dirtAt(wx, wy)) place(pickVar(PAL_FEET, wx, wy, 163), tx, ty);
    }
    for (let ty = 0; ty < CHUNK4; ty++) for (let tx = 0; tx < CHUNK4; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      if (raisedAt(wx, wy)) {
        const N = !raisedAt(wx, wy - 1), E = !raisedAt(wx + 1, wy), S = !raisedAt(wx, wy + 1), W = !raisedAt(wx - 1, wy);
        const shaded = !raisedAt(wx, wy + 1) || !raisedAt(wx, wy + 2);
        const rim = (v) => {
          const list = shaded ? v.D.length ? v.D : v.L : v.L.length ? v.L : v.D;
          const hx = v.ax === "col" ? wx : v.ax === "row" ? wy : wx;
          const hy = v.ax === "col" ? 7 : v.ax === "row" ? 11 : wy;
          return list[rhash(hx, hy, 231, seed2) % list.length];
        };
        place(shaded ? sparse(SHADE_FILL, SHADE_VARS, wx, wy, 225, CROWN_RATE, seed2) : sparse(CROWN_FILL, CROWN_VARS, wx, wy, 225, CROWN_RATE, seed2), tx, ty);
        if (S && !W && !E) {
          if (!trunkAt(wx, wy)) place(rim(CE.S), tx, ty);
        } else {
          const NW = !raisedAt(wx - 1, wy - 1), NE = !raisedAt(wx + 1, wy - 1);
          const SW2 = !raisedAt(wx - 1, wy + 1), SE = !raisedAt(wx + 1, wy + 1);
          const v = crownTile(N, E, S, W, NW, NE, SW2, SE);
          if (v) place(rim(v), tx, ty);
        }
      } else {
        let drawn = false;
        for (let k = 1; k <= TRUNK_H + 1; k++) {
          if (!raisedAt(wx, wy - k)) continue;
          if (trunkAt(wx, wy - k)) place([barkCol(wx, wy - k), 35 + k], tx, ty);
          drawn = true;
          break;
        }
        if (!drawn) for (let k = 2; k <= TRUNK_H; k++) {
          if (raisedAt(wx, wy - k)) break;
          if (trunkAt(wx + 1, wy - k)) {
            place([62, 35 + k], tx, ty);
            break;
          }
          if (trunkAt(wx - 1, wy - k)) {
            place([71, 35 + k], tx, ty);
            break;
          }
        }
      }
    }
    if (ctx.props) for (let ty = 0; ty < CHUNK4; ty++) for (let tx = 0; tx < CHUNK4; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      if (dirtAt(wx, wy) || goldAt(wx, wy) || onFace(wx, wy) || raisedAt(wx, wy)) continue;
      const h2 = hashU32(seed2 ^ 202405860, wx, wy);
      if (h2 % CLUTTER_RATE !== 0) continue;
      const [px, py, w, hh] = CLUTTER[(h2 >>> 8) % CLUTTER.length].f;
      const sp = new Sprite(texFrame(ctx.props, px, py, w, hh));
      sp.x = tx * TILE5 + (TILE5 - w >> 1);
      sp.y = ty * TILE5 + (TILE5 - hh);
      tmp.addChild(sp);
    }
    const live = [];
    const liveProp = (sheet, shadowSheet, [px, py, w, h2], wx, wy, hash, { flip = true, jitter = 2 } = {}) => {
      const fx = flip && (hash >>> 20 & 1) === 1;
      const jx = jitter ? ((hash >>> 16 & 15) / 16 - 0.5) * 2 * jitter : 0;
      const jy = jitter ? ((hash >>> 24 & 15) / 16 - 0.5) * 2 * jitter : 0;
      const X = wx * TILE5 + TILE5 / 2 + jx, Y = (wy + 1) * TILE5 + jy;
      const sp = new Sprite(texFrame(sheet, px, py, w, h2));
      sp.anchor.set(0.5, 1);
      sp.scale.set(fx ? -1 : 1, 1);
      sp.x = X;
      sp.y = Y;
      sp.zIndex = Y;
      let shadow = null;
      if (shadowSheet) {
        shadow = new Sprite(texFrame(shadowSheet, px, py, w, h2));
        shadow.anchor.set(0.5, 1);
        shadow.scale.set(fx ? -1 : 1, 1);
        shadow.x = X;
        shadow.y = Y;
      }
      return { sprite: sp, shadow };
    };
    const weighted = (list, weight, h2) => {
      let pick2 = h2 % weight;
      for (const it of list) {
        if (pick2 < it.weight) return it;
        pick2 -= it.weight;
      }
      return list[0];
    };
    for (let ty = 0; ty < CHUNK4; ty++) for (let tx = 0; tx < CHUNK4; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      if (raisedAt(wx, wy)) continue;
      if (stubAt(wx, wy - 1)) {
        const len = southEdge(wx + 1, wy - 1) ? 2 : 1;
        const h2 = hashU32(seed2 ^ 478284, wx, wy);
        const [px, py, w, hh] = TRUNK_COLS[h2 % TRUNK_COLS.length];
        const sp = new Sprite(texFrame(ctx.tiles, px, py, w, hh));
        sp.x = wx * TILE5 + (len * TILE5 - w >> 1);
        sp.y = wy * TILE5 - 1;
        sp.zIndex = (wy + 3) * TILE5;
        let shadow = null;
        if (ctx.shadow) {
          shadow = new Sprite(texFrame(ctx.shadow, px, py, w, hh));
          shadow.x = sp.x;
          shadow.y = sp.y;
        }
        live.push({ sprite: sp, shadow });
      } else if (trunkAt(wx, wy - 1) && opts.props !== false && ctx.props) {
        const h2 = hashU32(seed2 ^ 358989, wx, wy);
        if (h2 % VINE_RATE !== 0) continue;
        const [px, py, w, hh] = VINES[(h2 >>> 8) % VINES.length].f;
        const sp = new Sprite(texFrame(ctx.props, px, py, w, hh));
        sp.x = wx * TILE5 + (TILE5 - w >> 1);
        sp.y = wy * TILE5 - 3;
        sp.zIndex = (wy + TRUNK_H) * TILE5;
        let shadow = null;
        if (ctx.propShadow) {
          shadow = new Sprite(texFrame(ctx.propShadow, px, py, w, hh));
          shadow.x = sp.x;
          shadow.y = sp.y;
        }
        live.push({ sprite: sp, shadow });
      }
    }
    if (ctx.props) scatter(seed2 ^ 9701182, GROVE_BLOCK_X, GROVE_BLOCK_Y, x0, y0, accept, (wx, wy, h2) => {
      if (groveRegion[idx(wx - x0 + M, wy - y0 + M)] !== 1) return;
      if ((h2 >>> 8 & 65535) / 65536 >= GROVE_FILL) return;
      if (dirtAt(wx, wy) || goldAt(wx, wy) || onFace(wx, wy)) return;
      if (raisedAt(wx, wy) && (!raisedAt(wx, wy + 2) || !raisedAt(wx, wy - 1) || !raisedAt(wx - 1, wy) || !raisedAt(wx + 1, wy))) return;
      live.push(liveProp(ctx.props, ctx.propShadow, weighted(CANOPIES, CANOPY_WEIGHT, h2 >>> 12).f, wx, wy, h2));
    });
    if (ctx.props) scatter(seed2 ^ 474853, TREE_BLOCK_X, TREE_BLOCK_Y, x0, y0, accept, (wx, wy, h2) => {
      if ((h2 >>> 8 & 65535) / 65536 >= TREE_FILL) return;
      if (dirtAt(wx, wy) || goldAt(wx, wy) || onFace(wx, wy)) return;
      if (raisedAt(wx, wy) && (!raisedAt(wx, wy + 2) || !raisedAt(wx, wy - 1))) return;
      live.push(liveProp(ctx.props, ctx.propShadow, weighted(TREES3, TREE_WEIGHT, h2 >>> 12).f, wx, wy, h2));
    });
    if (ctx.props) scatter(seed2 ^ 987300, PLANT_BLOCK_X, PLANT_BLOCK_Y, x0, y0, accept, (wx, wy, h2) => {
      if ((h2 >>> 8 & 65535) / 65536 >= PLANT_FILL) return;
      if (dirtAt(wx, wy) || goldAt(wx, wy) || onFace(wx, wy) || raisedAt(wx, wy)) return;
      live.push(liveProp(ctx.props, ctx.propShadow, weighted(PLANTS, PLANT_WEIGHT, h2 >>> 12).f, wx, wy, h2));
    });
    if (ctx.props) scatter(seed2 ^ 14595093, DEBRIS_BLOCK_X, DEBRIS_BLOCK_Y, x0, y0, accept, (wx, wy, h2) => {
      if ((h2 >>> 8 & 65535) / 65536 >= DEBRIS_FILL) return;
      if (dirtAt(wx, wy) || goldAt(wx, wy) || onFace(wx, wy) || raisedAt(wx, wy)) return;
      live.push(liveProp(ctx.props, ctx.propShadow, weighted(DEBRIS, DEBRIS_WEIGHT, h2 >>> 12).f, wx, wy, h2));
    });
    if (opts.props !== false) scatter(seed2 ^ 9507236, 4, 4, x0, y0, accept, (wx, wy, h2) => {
      if (!dirtAt(wx, wy) || onFace(wx, wy) || palAnchor(wx, wy) || palAnchor(wx, wy + 1)) return;
      if ((h2 >>> 8 & 65535) / 65536 >= PILLAR_FILL) return;
      live.push(liveProp(ctx.tiles, ctx.shadow, weighted(PILLARS, PILLAR_WEIGHT, h2 >>> 12).f, wx, wy, h2, { jitter: 1 }));
    });
    return { meta: f, live };
  },
  // Pure (seed, tile) → [r,g,b] for the macro pyramid, approximating the detail priority.
  macroColor(seed2, tx, ty) {
    if (isRaised3(seed2, tx, ty)) return lerp3(COL_CROWN, COL_DARK2, 0.45);
    if (isDirt2(seed2, tx, ty) && !isPlain(seed2, tx, ty)) return COL_DIRT3;
    if (isGold(seed2, tx, ty) && !isPlain(seed2, tx, ty) && !isDeep(seed2, tx, ty)) return COL_GOLD;
    let c = isPlain(seed2, tx, ty) ? COL_PLAIN : isDeep(seed2, tx, ty) ? COL_DARK2 : isBloom(seed2, tx, ty) ? COL_BLOOM : COL_MOSS;
    if (forestField3(seed2, tx, ty) > GROVE_THRESHOLD) c = lerp3(c, COL_GROVE, 0.5);
    return c;
  },
  // The ground tile [c,r] at world (wx,wy) — for the debug grid overlay.
  tileIndexAt(wx, wy, meta) {
    if (!meta) return null;
    const { plainF, deepF, bloomF, dirtF, goldF, raisedF, M, SZ, x0, y0 } = meta;
    if (wx - x0 < 0 || wy - y0 < 0 || wx - x0 >= CHUNK4 || wy - y0 >= CHUNK4) return null;
    const idx = (i, j) => j * SZ + i;
    const at = (fld) => (x, y) => fld[idx(x - x0 + M, y - y0 + M)] === 1;
    const plainAt = at(plainF), deepAt = at(deepF), bloomAt = at(bloomF), dirtAt = at(dirtF), goldAt = at(goldF), raisedAt = at(raisedF);
    if (raisedAt(wx, wy)) {
      if (!raisedAt(wx, wy + 1) || !raisedAt(wx, wy + 2)) return SHADE_FILL;
      const v = crownTile(
        !raisedAt(wx, wy - 1),
        !raisedAt(wx + 1, wy),
        false,
        !raisedAt(wx - 1, wy),
        !raisedAt(wx - 1, wy - 1),
        !raisedAt(wx + 1, wy - 1),
        !raisedAt(wx - 1, wy + 1),
        !raisedAt(wx + 1, wy + 1)
      );
      return v ? v.L[0] || v.D[0] : CROWN_FILL;
    }
    if (goldAt(wx, wy)) return GOLD_FILL;
    if (dirtAt(wx, wy)) return DIRT_FILLS[0];
    if (plainAt(wx, wy)) return PLAIN_FILL;
    if (deepAt(wx, wy)) return DARK_FILL;
    if (bloomAt(wx, wy)) return BLOOM_FILL;
    return sparse(MOSS_BASE, MOSS_VARS, wx, wy, 0, MOSS_RATE, seed);
  }
});
function scatter(salt, bx, by, x0, y0, accept, place) {
  const bx0 = Math.floor(x0 / bx), bx1 = Math.floor((x0 + CHUNK4 - 1) / bx);
  const by0 = Math.floor(y0 / by), by1 = Math.floor((y0 + CHUNK4 - 1) / by);
  for (let gy = by0; gy <= by1; gy++) for (let gx = bx0; gx <= bx1; gx++) {
    const h2 = hashU32(salt, gx, gy);
    const wx = gx * bx + h2 % bx, wy = gy * by + (h2 >>> 4) % by;
    if (wx < x0 || wx >= x0 + CHUNK4 || wy < y0 || wy >= y0 + CHUNK4) continue;
    if (!accept(wx - x0, wy - y0)) continue;
    place(wx, wy, h2);
  }
}
function createLostJungleMap(pixi, host, opts = {}) {
  return createChunkedMap(pixi, host, { ...ljConfig(opts.seed ?? 1, { props: opts.props }), keyboardPan: opts.keyboardPan });
}

// ../auto-battler/src/render/biomeRegistry.js
var BIOME_FACTORIES = {
  forgottenPlains: fpConfig,
  orc: orcConfig,
  necropolis: necropolisConfig,
  lostJungle: ljConfig
};
var BIOME_GROUNDS = {
  forgottenPlains: { fills: FP_GROUND_FILLS, fillKey: fpGroundFillKey },
  orc: { fills: ORC_GROUND_FILLS, fillKey: orcGroundFillKey },
  necropolis: { fills: NECRO_GROUND_FILLS, fillKey: necroGroundFillKey },
  lostJungle: { fills: LJ_GROUND_FILLS, fillKey: ljGroundFillKey }
};

// ../auto-battler/src/render/transitionAtlas.js
var VARIANTS = 3;
function loadImg4(url) {
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
      img = await loadImg4(url);
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

// ../auto-battler/src/render/overworld.js
var TILE6 = 8;
var CHUNK5 = 32;
var MACRO_BLEND = 0.06;
var REGION_TINT = {
  forgottenPlains: [97, 150, 55],
  // meadow green
  orc: [150, 128, 95],
  // dirt tan
  necropolis: [120, 110, 128],
  // corrupted grey-purple
  lostJungle: [76, 110, 78]
  // deep jungle green
};
var TINT_MIX = 0.4;
var RANK = {};
OVERWORLD_BIOMES.forEach((id, i) => {
  RANK[id] = i;
});
var overworldConfig = (seed, opts = {}) => {
  const region = opts.regionFn ?? biomeRegion;
  const biomes = {};
  for (const id of OVERWORLD_BIOMES) {
    const factory = BIOME_FACTORIES[id];
    if (!factory) throw new Error(`overworld: no biome config registered for "${id}"`);
    biomes[id] = factory(seed);
  }
  return {
    seed,
    tile: TILE6,
    chunk: CHUNK5,
    background: "#2b2f3a",
    bounds: opts.bounds,
    initialCamera: opts.initialCamera,
    // Each biome loads its own sheets into its own ctx; then build the cross-biome transition atlas
    // from their base grounds. Key everything for bake to route to.
    async load(api) {
      const ctxById = {};
      for (const id of OVERWORLD_BIOMES) ctxById[id] = await biomes[id].load(api);
      const atlas = await buildTransitionAtlas({ grounds: BIOME_GROUNDS, ids: OVERWORLD_BIOMES });
      const texture = api.Texture.from(atlas.canvas);
      texture.source.scaleMode = "nearest";
      return { ctxById, trans: { source: texture.source, tileAt: atlas.tileAt, variants: atlas.variants } };
    },
    // Bake a chunk: assign each tile to its (crisp) region winner, let each present biome paint its
    // region, then overpaint the 1-tile border ring with generated transition tiles so neighbouring
    // biomes blend cleanly. Fast path: a single-biome chunk = one bake call, no mask, no seams.
    bake(api) {
      const { x0, y0, seed: seed2, ctx, add } = api;
      const GW = CHUNK5 + 2;
      const winner = new Array(GW * GW);
      const widx = (lx, ly) => (ly + 1) * GW + (lx + 1);
      for (let ly = -1; ly <= CHUNK5; ly++) for (let lx = -1; lx <= CHUNK5; lx++) {
        winner[widx(lx, ly)] = region(seed2, x0 + lx, y0 + ly).id;
      }
      const at = (lx, ly) => winner[widx(lx, ly)];
      const present = /* @__PURE__ */ new Set();
      for (let ty = 0; ty < CHUNK5; ty++) for (let tx = 0; tx < CHUNK5; tx++) present.add(at(tx, ty));
      const single = present.size === 1;
      const live = [];
      const metaById = {};
      for (const id of OVERWORLD_BIOMES) {
        if (!present.has(id)) continue;
        const accept = single ? void 0 : (tx, ty) => at(tx, ty) === id;
        const res = biomes[id].bake({ ...api, ctx: ctx.ctxById[id], accept }) || {};
        if (res.live) for (const l of res.live) live.push(l);
        if (res.meta) metaById[id] = res.meta;
      }
      const trans = ctx.trans;
      if (trans && !single) {
        for (let ty = 0; ty < CHUNK5; ty++) for (let tx = 0; tx < CHUNK5; tx++) {
          const A = at(tx, ty), rankA = RANK[A];
          const below = (lx, ly) => {
            const b = at(lx, ly);
            return b !== A && RANK[b] < rankA;
          };
          const key = boundaryCase(
            below(tx, ty - 1),
            below(tx + 1, ty),
            below(tx, ty + 1),
            below(tx - 1, ty),
            below(tx - 1, ty - 1),
            below(tx + 1, ty - 1),
            below(tx - 1, ty + 1),
            below(tx + 1, ty + 1)
          );
          if (!key) continue;
          const B = dominantForeign(at, tx, ty, A, rankA);
          if (!B) continue;
          const wx = x0 + tx, wy = y0 + ty;
          const fgKey = BIOME_GROUNDS[A].fillKey(seed2, wx, wy);
          const bgKey = BIOME_GROUNDS[B].fillKey(seed2, wx, wy);
          const variant = hashU32(seed2 ^ 1957, wx, wy) % trans.variants;
          const cr = trans.tileAt(A, fgKey, B, bgKey, key, variant);
          if (cr) add(trans.source, cr[0], cr[1], tx, ty);
        }
      }
      return { live, meta: { winner, GW, metaById } };
    },
    // Zoomed-out world map: a flat region tint (so lands stay legible at any zoom) modulated by a
    // little of the biome's internal terrain colour, cross-fading into the runner-up region across
    // a thin border band so regions read as soft-edged lands, not hard cells.
    macroColor(seed2, tx, ty) {
      const { id, id2, edge } = region(seed2, tx, ty);
      let tint = REGION_TINT[id];
      if (edge < MACRO_BLEND && id !== id2) tint = lerp3(tint, REGION_TINT[id2], 0.5 * (1 - edge / MACRO_BLEND));
      return lerp3(tint, biomes[id].macroColor(seed2, tx, ty), TINT_MIX);
    },
    // Which biome owns a world tile (no chunk meta needed) — for callers that key behaviour to the
    // land the player is on (free-roam enemy rosters, per-biome walkability).
    biomeAt(seed2, wx, wy) {
      return region(seed2, wx, wy).id;
    },
    // Debug grid overlay: dispatch to whichever biome owns the tile, with that biome's chunk meta.
    tileIndexAt(wx, wy, meta) {
      if (!meta) return null;
      const tx = (wx % CHUNK5 + CHUNK5) % CHUNK5, ty = (wy % CHUNK5 + CHUNK5) % CHUNK5;
      const id = meta.winner[(ty + 1) * meta.GW + (tx + 1)];
      const bm = meta.metaById[id];
      return bm ? biomes[id].tileIndexAt(wx, wy, bm) : null;
    }
  };
};
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
function createOverworldMap(pixi, host, opts = {}) {
  return createChunkedMap(pixi, host, overworldConfig(opts.seed ?? 1));
}

// ../auto-battler/src/render/medievalCity.js
var MC = "/assets/minifantasy/Minifantasy_Medieval_City_v1.1/Minifantasy_Medieval_City_Assets";
var MC_TILES_URL = `${MC}/Tileset/Tileset.png`;
var MC_TILES_SHADOWS_URL = `${MC}/Tileset/Shadows.png`;
var MC_PROPS_URL = `${MC}/Props/Props.png`;
var MC_PROPS_SHADOWS_URL = `${MC}/Props/Shadows.png`;
var MC_MOCKUP_URL = `${MC}/Mockup_Exterior_1.png`;
var MC_PREMADE_DIR = `${MC}/Premade/Premade_Exterior/Separate_Layers`;
var TILE7 = 8;
var CHUNK6 = 32;
var MC_REF = {
  dir: MC_PREMADE_DIR,
  w: 680,
  h: 552,
  bg: "#1a1714",
  layers: [
    ["Exterior_o-floor", "Floor", "ground"],
    ["Exterior_n-fences", "Fences", "structure"],
    ["Exterior_m-walls_1", "Walls 1", "structure"],
    ["Exterior_l-stairs_and_terraces_1", "Stairs & terraces 1", "structure"],
    ["Exterior_k-walls_2", "Walls 2", "structure"],
    ["Exterior_j-stairs_and_terraces_2", "Stairs & terraces 2", "structure"],
    ["Exterior_i-props", "Props", "scatter"],
    ["Exterior_h-roof", "Roof", "structure"],
    ["Exterior_g-turrets_and_annexes", "Turrets & annexes", "structure"],
    ["Exterior_f-chimneys", "Chimneys", "structure"],
    ["Exterior_e-city_walls", "City walls", "structure"],
    ["Exterior_d-props_on_city_walls", "Props on city walls", "scatter"],
    ["Exterior_c-shadows", "Shadows", "lighting"],
    ["Exterior_b-pennant_flags", "Pennant flags", "scatter"],
    ["Exterior_a-night_effect", "Night effect", "lighting"]
  ]
};
var DIRT_BASE2 = [4, 132];
var DIRT_VARS4 = [[6, 132], [8, 132], [10, 132], [6, 134], [8, 134], [10, 134], [6, 136], [8, 136]];
var COBBLE = [14, 132];
var WALLSTONE = [18, 130];
var COL_COBBLE = [150, 130, 100];
var COL_WALL = [120, 120, 125];
var COL_DIRT4 = [151, 116, 94];
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
  cont.x = bx * TILE7;
  cont.y = (by - H + 1) * TILE7;
  cont.zIndex = (by + 1) * TILE7;
  const tile = (c, r, x, y, z) => {
    const sp = new Sprite(tex(source, c, r));
    sp.x = x * TILE7;
    sp.y = y * TILE7;
    sp.zIndex = z;
    cont.addChild(sp);
    return sp;
  };
  const frame = (c, r, fw, fh, x, y, z) => {
    const sp = new Sprite(texFrame(source, c * TILE7, r * TILE7, fw * TILE7, fh * TILE7));
    sp.x = x * TILE7;
    sp.y = y * TILE7;
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
  const h2 = hashU32(seed ^ 264030, lc, lr);
  const bit = (n) => h2 >> n & 1;
  const pick2 = (n, arr) => arr[(h2 >> n) % arr.length];
  const colour = pick2(10, ["red", "green", "purple"]);
  const floors = bit(4) ? 2 : 1;
  const towers = [];
  if ((h2 >> 16) % 6 === 0) towers.push({ side: bit(17) ? "L" : "R", extra: 1 + (h2 >> 18) % 3, colour });
  return {
    w: pick2(0, [6, 8, 8]),
    // even widths (door/window centre cleanly)
    material: "stone",
    floors,
    colour,
    dormer: true,
    chimney: (h2 >> 26) % 3 === 0 ? 1 : 0,
    towers
  };
}
var PLOT_W = 64;
var PLOT_H = 52;
var WALL = 2;
var BLOCKW = 10;
var BLOCKH = 8;
var SW = 2;
function cityGroundKind(ix, iy, w, h2) {
  if (ix < 0 || iy < 0 || ix >= w || iy >= h2) return null;
  if (ix < WALL || iy < WALL || ix >= w - WALL || iy >= h2 - WALL) return "wall";
  const jx = ix - WALL, jy = iy - WALL;
  return jx % BLOCKW < SW || jy % BLOCKH < SW ? "street" : "dirt";
}
var cityKindTile = (k, wx, wy, seed) => k === "wall" ? WALLSTONE : k === "street" ? COBBLE : sparse(DIRT_BASE2, DIRT_VARS4, wx, wy, 0, 6, seed);
var cityKindMacro = (k) => k === "wall" ? COL_WALL : k === "street" ? COL_COBBLE : COL_DIRT4;
function planCity(seed, { ox = 0, oy = 0, w = PLOT_W, h: h2 = PLOT_H, salt = 0 } = {}) {
  const groundTile = (wx, wy) => {
    const k = cityGroundKind(wx - ox, wy - oy, w, h2);
    return k ? cityKindTile(k, wx, wy, seed) : null;
  };
  const macroAt = (wx, wy) => {
    const k = cityGroundKind(wx - ox, wy - oy, w, h2);
    return k ? cityKindMacro(k) : null;
  };
  const houses = [];
  const nCols = Math.floor((w - 2 * WALL) / BLOCKW), nRows = Math.floor((h2 - 2 * WALL) / BLOCKH);
  const innerW = BLOCKW - SW, innerH = BLOCKH - SW;
  for (let lr = 0; lr < nRows; lr++) for (let lc = 0; lc < nCols; lc++) {
    const lotX = ox + WALL + lc * BLOCKW + SW, lotY = oy + WALL + lr * BLOCKH + SW;
    const plan = planHouse((seed ^ salt) >>> 0, lc, lr);
    const bx = lotX + Math.floor((innerW - plan.w) / 2), by = lotY + innerH - 1;
    houses.push({ bx, by, plan });
  }
  return { ox, oy, w, h: h2, groundTile, macroAt, houses };
}
var MC_MAP_ASSETS = [MC_TILES_URL];
var medievalCityConfig = (seed) => ({
  seed,
  tile: TILE7,
  chunk: CHUNK6,
  background: "#5a7a3a",
  // grass beyond the walls
  bounds: { x0: 0, y0: 0, x1: PLOT_W, y1: PLOT_H },
  async load({ Assets }) {
    const ctx = { tiles: null };
    const t = await Assets.load(MC_TILES_URL);
    t.source.scaleMode = "nearest";
    ctx.tiles = t.source;
    return ctx;
  },
  bake({ x0, y0, seed: seed2, ctx, add, accept = () => true, Sprite, Container, tex, texFrame }) {
    const city = planCity(seed2, { w: PLOT_W, h: PLOT_H });
    for (let ty = 0; ty < CHUNK6; ty++) for (let tx = 0; tx < CHUNK6; tx++) {
      if (!accept(tx, ty)) continue;
      const t = city.groundTile(x0 + tx, y0 + ty);
      if (t) add(ctx.tiles, t[0], t[1], tx, ty);
    }
    const live = [];
    const houseApi = { Sprite, Container, tex, texFrame, source: ctx.tiles };
    for (const ho of city.houses) {
      const anchorX = ho.bx + (ho.plan.w >> 1);
      if (anchorX < x0 || anchorX >= x0 + CHUNK6 || ho.by < y0 || ho.by >= y0 + CHUNK6) continue;
      live.push(assembleHouse(houseApi, ho.bx, ho.by, ho.plan));
    }
    return { live };
  },
  macroColor(seed2, tx, ty) {
    const k = cityGroundKind(tx, ty, PLOT_W, PLOT_H);
    return k ? cityKindMacro(k) : COL_DIRT4;
  }
});
function createMedievalCityMap(pixi, host, opts = {}) {
  return createChunkedMap(pixi, host, { ...medievalCityConfig(opts.seed ?? 1), keyboardPan: opts.keyboardPan });
}
var MC_TILE_CATALOG = [
  // ── Ground (band at rows ~130-141) ──────────────────────────────────────────────────────────
  {
    name: "Outdoor floor (dirt base + speckle)",
    frame: [4, 140, 8, 9],
    tiles: [DIRT_BASE2, ...DIRT_VARS4],
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
var MC_PROP_CATALOG = [
  { name: "Crates & sacks", frame: [2, 8, 5, 3], tiles: [[2, 8]], used: false, note: "wooden crates + sack" },
  { name: "Market produce / small goods", frame: [8, 9, 10, 5], tiles: [[8, 9]], used: false, note: "small stall goods (food/wares)" },
  { name: "Barrel + lamp (stacked)", frame: [22, 9, 1, 7], tiles: [[22, 9]], used: false, note: "1-wide barrel + lantern" },
  { name: "Market stalls + well", frame: [24, 9, 19, 10], tiles: [[24, 9]], used: false, note: "awning shop stalls + a well/fountain" },
  { name: "Cloth / meat stalls", frame: [44, 9, 7, 4], tiles: [[44, 9]], used: false, note: "covered market tables" },
  { name: "Wooden beam", frame: [1, 17, 3, 3], tiles: [[1, 17]], used: false, note: "plank/beam" },
  { name: "Benches", frame: [3, 19, 2, 6], tiles: [[3, 19]], used: false, note: "wooden benches" },
  { name: "Post / plank", frame: [6, 17, 1, 3], tiles: [[6, 17]], used: false, note: "tall post" },
  { name: "Lamp posts", frame: [8, 20, 11, 9], tiles: [[8, 20]], used: false, note: "street lamp posts / torches" },
  { name: "Furniture & barrels (mixed)", frame: [22, 23, 26, 13], tiles: [[22, 23]], used: false, note: "barrels, tables, signs, cart wheel \u2014 general street/yard clutter" },
  { name: "Barrels (stacked)", frame: [49, 18, 1, 6], tiles: [[49, 18]], used: false, note: "two stacked barrels" },
  { name: "Bed / cart", frame: [51, 15, 2, 2], tiles: [[51, 15]], used: false, note: "small bed or hand-cart" }
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

// ../auto-battler/src/render/biomes.js
var FP2 = "/assets/minifantasy/Minifantasy_ForgottenPlains_v3.6_Commercial_Version/Minifantasy_ForgottenPlains_Assets";
var ORC2 = "/assets/minifantasy/Minifantasy_Orc_Kingdom_v1.0/Minifantasy_Orc_Kingdom_Assets";
var NECRO2 = "/assets/minifantasy/Minifantasy_Necropolis_v1.0/Minifantasy_Necropolis_Assets";
var DESERT = "/assets/minifantasy/Minifantasy_DesolateDesert_v2.0/Minifantasy_DesolateDesert_Assets";
var JUNGLE = "/assets/minifantasy/Minifantasy_Lost_Jungle_v1.0/Minifantasy_Lost_Jungle_Assets";
var COL_GRASS3 = [97, 150, 55];
var COL_DIRT5 = [118, 80, 38];
var COL_STONE2 = [120, 120, 122];
var COL_ORC = [150, 128, 95];
var COL_NECRO = [130, 119, 136];
var COL_SAND = [216, 146, 60];
var COL_JUNGLE = [87, 116, 86];
var GAME_BIOMES = {
  forgottenPlains: {
    id: "forgottenPlains",
    sheet: "fp",
    url: `${FP2}/Tileset/Minifantasy_ForgottenPlainsTiles.png`,
    ground: { base: [37, 11], vars: [...rect(1, 1, 4, 1), ...rect(2, 3, 3, 5)], rate: 9 },
    path: { base: [8, 4], vars: [[7, 1], [8, 1], [9, 1]], rate: 6 },
    // FP dirt (exact — same tiles the road used)
    macro: (seed, x, y) => isStone(seed, x, y) && !isDirt(seed, x, y) ? COL_STONE2 : isDirt(seed, x, y) ? COL_DIRT5 : COL_GRASS3
  },
  orc: {
    id: "orc",
    sheet: "orc",
    url: `${ORC2}/Tileset/Tiles.png`,
    ground: { base: [7, 51], vars: rect(13, 51, 2, 6), rate: 4 },
    path: { base: [13, 51], vars: [[14, 51], [13, 52], [14, 52]], rate: 5 },
    // darker packed dirt (approx — verify in inspector)
    macro: COL_ORC
  },
  necropolis: {
    id: "necropolis",
    sheet: "necro",
    url: `${NECRO2}/Tileset/Biome/CorruptedBiome.png`,
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
  const sub6 = (seed, salt) => (Math.imul(seed | 0, 2654435761) ^ (salt | 0)) >>> 0;
  function regionAt2(seed, x, y) {
    const warp = warpT * (fbm(sub6(seed, 1441), x * warpScale, y * warpScale) - 0.5) * 2;
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

// ../auto-battler/src/render/desolateDesert.js
var STAIR_SPACING2 = 14;
var DD = "/assets/minifantasy/Minifantasy_DesolateDesert_v2.0/Minifantasy_DesolateDesert_Assets";
var TILES4 = `${DD}/Tileset/Minifantasy_DesolateDesertTiles.png`;
var PROPS4 = `${DD}/Props/Minifantasy_DesolateDesertProps.png`;
var PROP_SHADOW4 = `${DD}/Props/Minifantasy_DesolateDesertPropsShadows.png`;
var DD_TILES_URL = TILES4;
var DD_PROPS_URL = PROPS4;
var DD_MOCKUP_URL = `${DD}/Minifantasy_DesolateDesertMockup.png`;
var DD_MAP_ASSETS = [TILES4, PROPS4, PROP_SHADOW4];
var TILE8 = 8;
var CHUNK7 = 32;
var SAND_BASE = [1, 3];
var SAND_VARS = [[2, 3], [3, 3], [4, 3], [5, 3]];
var SAND_RATE = 7;
var CRACK_BLOCK = [8, 5];
var CRACK_FILL = [9, 6];
var CRACK_VARS = [[8, 3], [9, 3], [10, 3]];
var GOLD_BLOCK2 = [14, 5];
var GOLD_FILL2 = [15, 6];
var GOLD_VARS2 = [[13, 3], [14, 3], [15, 3], [16, 3], [17, 3]];
var GOLD_CLIFF_BUF = 2;
var WATER_BLOCK3 = [20, 5];
var WATER_FILL2 = [21, 6];
var WATER_VARS2 = [[21, 6]];
var FILL_RATE3 = 6;
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
var DD_PROP_CATALOG = [
  // Pebbles — col 1, three shades (rows 1–3). Baked on sand.
  { name: "Pebble (light)", frame: [1, 1, 1, 1], used: true, note: "small grey rock" },
  { name: "Pebble (mid)", frame: [1, 2, 1, 1], used: true, note: "small grey rock" },
  { name: "Pebble (dark)", frame: [1, 3, 1, 1], used: true, note: "small grey rock" },
  // Bones — a skull + a ribcage, each with a mirrored copy on row 3 (cols swapped). All four spawn.
  { name: "Skull", frame: [3, 1, 1, 1], used: true, note: "bleached animal skull" },
  { name: "Ribcage", frame: [4, 1, 1, 1], used: true, note: "bleached rib bones" },
  { name: "Skull (flipped)", frame: [4, 3, 1, 1], used: true, note: "mirrored skull" },
  { name: "Ribcage (flipped)", frame: [3, 3, 1, 1], used: true, note: "mirrored ribs" },
  // Gravel — cols 6–7, scattered specks across rows 1–3. Baked on sand.
  { name: "Gravel a", frame: [6, 1, 1, 1], used: true, note: "orange pebble specks" },
  { name: "Gravel b", frame: [7, 1, 1, 1], used: true, note: "orange pebble specks" },
  { name: "Gravel c", frame: [6, 2, 1, 1], used: true, note: "orange pebble specks" },
  { name: "Gravel d", frame: [7, 2, 1, 1], used: true, note: "orange pebble specks" },
  { name: "Gravel e", frame: [6, 3, 1, 1], used: true, note: "orange pebble specks" },
  { name: "Gravel f", frame: [7, 3, 1, 1], used: true, note: "orange pebble specks" },
  // Small cacti — col 9 has three 1×1 variants (rows 1/2/3); barrel (col 11), aloe (cols 13–14),
  // prickly pear (cols 16–17) each have a flowering (row 1) and a plain (row 3) form.
  { name: "Small cactus a", frame: [9, 1, 1, 1], used: true, note: "round 1\xD71 cactus" },
  { name: "Small cactus b", frame: [9, 2, 1, 1], used: true, note: "round 1\xD71 cactus" },
  { name: "Small cactus c", frame: [9, 3, 1, 1], used: true, note: "round 1\xD71 cactus" },
  { name: "Barrel cactus", frame: [11, 1, 1, 1], used: true, note: "round green cactus" },
  { name: "Barrel cactus (flowering)", frame: [11, 3, 1, 1], used: true, note: "round cactus, pink bloom" },
  { name: "Aloe (flowering)", frame: [13, 1, 1, 1], used: true, note: "small cactus, yellow blooms" },
  { name: "Aloe (flowering) 2", frame: [14, 1, 1, 1], used: true, note: "small cactus, yellow blooms" },
  { name: "Aloe", frame: [13, 3, 1, 1], used: true, note: "small plain green cactus" },
  { name: "Aloe 2", frame: [14, 3, 1, 1], used: true, note: "small plain green cactus" },
  { name: "Prickly pear (fruit)", frame: [16, 1, 1, 1], used: true, note: "paddle cactus, red fruit" },
  { name: "Prickly pear (fruit) 2", frame: [17, 1, 1, 1], used: true, note: "paddle cactus, red fruit" },
  { name: "Prickly pear", frame: [16, 3, 1, 1], used: true, note: "plain paddle cactus" },
  { name: "Prickly pear 2", frame: [17, 3, 1, 1], used: true, note: "plain paddle cactus" },
  // Tall plants & rocks (live, depth-sorted) — each a 2×2 sprite, rows 5–10.
  { name: "Saguaro (arms up)", frame: [9, 6, 2, 2], used: true, note: "armed cactus, scattered on sand" },
  { name: "Saguaro (arms out)", frame: [9, 8, 2, 2], used: true, note: "armed cactus, scattered on sand" },
  { name: "Palm (top)", frame: [6, 6, 2, 2], used: true, note: "spawns on the oasis fringe" },
  { name: "Palm (mid)", frame: [6, 8, 2, 2], used: true, note: "spawns on the oasis fringe" },
  { name: "Palm (lean)", frame: [6, 10, 2, 2], used: true, note: "spawns on the oasis fringe" },
  { name: "Green shrub", frame: [13, 6, 2, 2], used: true, note: "small succulent, scattered on sand" },
  { name: "Agave", frame: [13, 8, 2, 2], used: true, note: "teal succulent, scattered on sand" },
  { name: "Boulder (small)", frame: [1, 6, 2, 2], used: true, note: "spawns in rocky clumps" },
  { name: "Boulder (large)", frame: [1, 8, 2, 2], used: true, note: "spawns in rocky clumps" }
];
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
    WATER_BLOCK3,
    WATER_FILL2,
    ...WATER_VARS2,
    ...GOLD_VARS2,
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
    [WATER_BLOCK3, WATER_FILL2],
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
var COL_WATER3 = [86, 134, 196];
var COL_GOLD2 = [228, 184, 92];
var COL_CLIFF3 = [196, 158, 104];
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
function chunkFields5(seed, x0, y0) {
  const WATER_BUFFER = 2, M = WATER_BUFFER + 5, SZ = CHUNK7 + 2 * M;
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
  { key: "sand", url: TILES4, tile: SAND_BASE },
  { key: "crack", url: TILES4, tile: CRACK_FILL },
  { key: "gold", url: TILES4, tile: GOLD_FILL2 }
];
function ddGroundFillKey(seed, x, y) {
  return isDirt(seed, x, y) ? "crack" : isStone(seed, x, y) ? "gold" : "sand";
}
var desolateDesertConfig = (seed, opts = {}) => ({
  seed,
  tile: TILE8,
  chunk: CHUNK7,
  background: "#c8923c",
  async load({ Assets }) {
    const ctx = { tiles: null, props: null, propShadow: null };
    const t = await Assets.load(TILES4);
    t.source.scaleMode = "nearest";
    ctx.tiles = t.source;
    if (opts.props !== false) {
      try {
        const p = await Assets.load(PROPS4);
        p.source.scaleMode = "nearest";
        ctx.props = p.source;
      } catch {
      }
      try {
        const p = await Assets.load(PROP_SHADOW4);
        p.source.scaleMode = "nearest";
        ctx.propShadow = p.source;
      } catch {
      }
    }
    return ctx;
  },
  bake({ x0, y0, seed: seed2, ctx, tmp, Sprite, tex, texFrame, add, accept = () => true }) {
    const f = chunkFields5(seed2, x0, y0);
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
        add(ctx.tiles, ...sparse(fillBase, fillVars, wx, wy, salt, FILL_RATE3, seed2), tx, ty);
        return;
      }
      let cr;
      if (!N && !E && !S && !W) {
        const dNW = !atFn(wx - 1, wy - 1), dNE = !atFn(wx + 1, wy - 1), dSW = !atFn(wx - 1, wy + 1), dSE = !atFn(wx + 1, wy + 1);
        if (!dNW && !dNE && !dSW && !dSE) {
          add(ctx.tiles, ...sparse(fillBase, fillVars, wx, wy, salt, FILL_RATE3, seed2), tx, ty);
          return;
        }
        cr = centerTile(BLOCK, dNW, dNE, dSW, dSE);
      } else cr = blockTile(BLOCK, N, E, S, W);
      add(ctx.tiles, cr[0], cr[1], tx, ty);
    };
    for (let ty = 0; ty < CHUNK7; ty++) for (let tx = 0; tx < CHUNK7; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      add(ctx.tiles, ...sparse(SAND_BASE, SAND_VARS, wx, wy, 0, SAND_RATE, seed2), tx, ty);
      if (atG(wx, wy)) blob(atG, GOLD_BLOCK2, GOLD_FILL2, GOLD_VARS2, 2, wx, wy, tx, ty);
      if (atC(wx, wy)) blob(atC, CRACK_BLOCK, CRACK_FILL, CRACK_VARS, 1, wx, wy, tx, ty);
      if (atW(wx, wy)) blob(atW, WATER_BLOCK3, WATER_FILL2, WATER_VARS2, 3, wx, wy, tx, ty);
    }
    const live = [];
    const propSprite = (spec, wx, wy) => {
      const sp = new Sprite(texFrame(ctx.props, spec.c * TILE8, (spec.r - spec.h + 1) * TILE8, spec.w * TILE8, spec.h * TILE8));
      sp.anchor.set(0.5, 1);
      sp.x = wx * TILE8 + TILE8 / 2;
      sp.y = (wy + 1) * TILE8;
      sp.zIndex = (wy + 1) * TILE8;
      return sp;
    };
    const propShadowSprite = (spec, wx, wy) => {
      if (!ctx.propShadow) return null;
      const sp = new Sprite(texFrame(ctx.propShadow, spec.c * TILE8, (spec.r - spec.h + 1) * TILE8, spec.w * TILE8, spec.h * TILE8));
      sp.anchor.set(0.5, 1);
      sp.x = wx * TILE8 + TILE8 / 2;
      sp.y = (wy + 1) * TILE8;
      return sp;
    };
    if (ctx.props) for (let ty = 0; ty < CHUNK7; ty++) for (let tx = 0; tx < CHUNK7; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      if (atW(wx, wy)) continue;
      const hh = hashU32(seed2 ^ 23197, wx, wy);
      if (hh % GROUND_RATE !== 0) continue;
      let pick2 = (hh >>> 8) % GROUND_WEIGHT, g = GROUND_PROPS[0];
      for (const grp of GROUND_PROPS) {
        if (pick2 < grp.weight) {
          g = grp;
          break;
        }
        pick2 -= grp.weight;
      }
      const [c, r] = g.tiles[(hh >>> 16) % g.tiles.length];
      const sp = new Sprite(texFrame(ctx.props, c * TILE8, r * TILE8, TILE8, TILE8));
      sp.x = tx * TILE8;
      sp.y = ty * TILE8;
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
      bakeCliffs(DESERT_CLIFF, { chunk: CHUNK7, x0, y0, seed: seed2, raised: isRaisedAt, place, accept, stairAt, stairAtV });
    }
    if (ctx.props) scatter2(seed2 ^ 51911, CACTUS_BLOCK_X, CACTUS_BLOCK_Y, x0, y0, accept, (wx, wy, h2) => {
      if (atW(wx, wy) || onCliffFace(wx, wy)) return;
      if ((h2 >>> 8 & 65535) / 65536 >= CACTUS_FILL) return;
      let pick2 = (h2 >>> 20) % CACTUS_WEIGHT, ca = CACTI[0];
      for (const c of CACTI) {
        if (pick2 < c.weight) {
          ca = c;
          break;
        }
        pick2 -= c.weight;
      }
      live.push({ sprite: propSprite(ca, wx, wy), shadow: propShadowSprite(ca, wx, wy) });
    });
    if (ctx.props) for (let ty = 0; ty < CHUNK7; ty++) for (let tx = 0; tx < CHUNK7; tx++) {
      if (!accept(tx, ty)) continue;
      const wx = x0 + tx, wy = y0 + ty;
      if (atW(wx, wy) || onCliffFace(wx, wy)) continue;
      if (!(atW(wx - 1, wy) || atW(wx + 1, wy) || atW(wx, wy - 1) || atW(wx, wy + 1))) continue;
      const h2 = hashU32(seed2 ^ 39454, wx, wy);
      if (h2 % PALM_RATE !== 0) continue;
      const pa = PALMS[(h2 >>> 8) % PALMS.length];
      live.push({ sprite: propSprite(pa, wx, wy), shadow: propShadowSprite(pa, wx, wy) });
    }
    if (ctx.props) {
      const inClump = (wx, wy) => boulderRegion[idx(wx - x0 + M, wy - y0 + M)] === 1;
      scatter2(seed2 ^ 11541986, BOULDER_BLOCK_X, BOULDER_BLOCK_Y, x0, y0, accept, (wx, wy, h2) => {
        if (!inClump(wx, wy) || atW(wx, wy) || onCliffFace(wx, wy)) return;
        if ((h2 >>> 8 & 65535) / 65536 >= BOULDER_CLUMP_FILL) return;
        let pick2 = (h2 >>> 20) % BOULDER_WEIGHT, b = BOULDERS[0];
        for (const s of BOULDERS) {
          if (pick2 < s.weight) {
            b = s;
            break;
          }
          pick2 -= s.weight;
        }
        live.push({ sprite: propSprite(b, wx, wy), shadow: propShadowSprite(b, wx, wy) });
      });
    }
    return { meta: f, live };
  },
  macroColor(seed2, tx, ty) {
    if (isRaised(seed2, tx, ty)) return COL_CLIFF3;
    if (isRiver(seed2, tx, ty)) return COL_WATER3;
    if (isDirt(seed2, tx, ty)) return COL_CRACK;
    if (isStone(seed2, tx, ty)) return COL_GOLD2;
    return COL_SAND2;
  },
  tileIndexAt(wx, wy, meta) {
    if (!meta) return null;
    const { waterF, crack, gold, M, SZ, x0, y0 } = meta;
    if (wx - x0 < 0 || wy - y0 < 0 || wx - x0 >= CHUNK7 || wy - y0 >= CHUNK7) return null;
    const idx = (i, j) => j * SZ + i;
    const pick2 = (fld, BLOCK, fill) => {
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
    if (waterF[idx(wx - x0 + M, wy - y0 + M)] === 1) return pick2(waterF, WATER_BLOCK3, WATER_FILL2);
    if (crack[idx(wx - x0 + M, wy - y0 + M)] === 1) return pick2(crack, CRACK_BLOCK, CRACK_FILL);
    if (gold[idx(wx - x0 + M, wy - y0 + M)] === 1) return pick2(gold, GOLD_BLOCK2, GOLD_FILL2);
    return SAND_BASE;
  }
});
function scatter2(salt, bx, by, x0, y0, accept, place) {
  const bx0 = Math.floor(x0 / bx), bx1 = Math.floor((x0 + CHUNK7 - 1) / bx);
  const by0 = Math.floor(y0 / by), by1 = Math.floor((y0 + CHUNK7 - 1) / by);
  for (let gy = by0; gy <= by1; gy++) for (let gx = bx0; gx <= bx1; gx++) {
    const h2 = hashU32(salt, gx, gy);
    const wx = gx * bx + h2 % bx, wy = gy * by + (h2 >>> 4) % by;
    if (wx < x0 || wx >= x0 + CHUNK7 || wy < y0 || wy >= y0 + CHUNK7) continue;
    if (!accept(wx - x0, wy - y0)) continue;
    place(wx, wy, h2);
  }
}
function createDesolateDesertMap(pixi, host, opts = {}) {
  return createChunkedMap(pixi, host, { ...desolateDesertConfig(opts.seed ?? 1, { props: opts.props }), keyboardPan: opts.keyboardPan });
}

// ../auto-battler/src/render/gameWorld.js
var TILE9 = 8;
var CHUNK8 = 32;
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
var MACRO_BLEND2 = 0.06;
var TINT_MIX2 = 0.55;
var RANK2 = {};
GW_BANDS.forEach((id, i) => {
  RANK2[id] = i;
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
    const h2 = hashU32(seed ^ 5340759, i, 7);
    const jx = (h2 % 2e3 / 2e3 - 0.5) * 300, jy = ((h2 >>> 11) % 2e3 / 2e3 - 0.5) * 300;
    sites.push({ x: clamp(bx + jx, 40, GW_W - 40), y: clamp(by + jy, 40, GW_H - 40), r: 7, kind: h2 >>> 22 & 1 ? "fortress" : "town" });
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
function dominantForeign2(at, tx, ty, A, rankA) {
  const tally = /* @__PURE__ */ new Map();
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const b = at(tx + dx, ty + dy);
    if (b !== A && RANK2[b] < rankA) tally.set(b, (tally.get(b) || 0) + 1);
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
    tile: TILE9,
    chunk: CHUNK8,
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
      const GWm = CHUNK8 + 2, widx = (lx, ly) => (ly + 1) * GWm + (lx + 1);
      const winner = new Array(GWm * GWm), pmask = new Uint8Array(GWm * GWm);
      const roadNet = getRoadNet(seed2);
      const pathRaw = (wx, wy) => {
        const na = nodeAt(skel, wx, wy);
        if (na.d < na.n.r) return true;
        if (roadNet.has(wx, wy)) return true;
        for (const v of villages) if (v.streetDist(wx, wy) < STREET_HALF) return true;
        return false;
      };
      for (let ly = -1; ly <= CHUNK8; ly++) for (let lx = -1; lx <= CHUNK8; lx++) {
        winner[widx(lx, ly)] = regionAt(seed2, x0 + lx, y0 + ly).id;
        pmask[widx(lx, ly)] = pathRaw(x0 + lx, y0 + ly) ? 1 : 0;
      }
      const at = (lx, ly) => winner[widx(lx, ly)];
      const isPath = (lx, ly) => pmask[widx(lx, ly)] === 1;
      const inClearing = (wx, wy) => villageClearing(seed2, villages, wx, wy);
      const present = /* @__PURE__ */ new Set();
      for (let ty = 0; ty < CHUNK8; ty++) for (let tx = 0; tx < CHUNK8; tx++) present.add(at(tx, ty));
      const live = [];
      for (const id of GW_BANDS) {
        if (!present.has(id)) continue;
        const accept = (tx, ty) => at(tx, ty) === id && !isPath(tx, ty) && !inClearing(x0 + tx, y0 + ty);
        const res = richBiomes[id].bake({ ...api, ctx: ctx.rich[id], accept }) || {};
        if (res.live) for (const l of res.live) live.push(l);
      }
      if (trans && present.size > 1) {
        for (let ty = 0; ty < CHUNK8; ty++) for (let tx = 0; tx < CHUNK8; tx++) {
          if (isPath(tx, ty) || inClearing(x0 + tx, y0 + ty)) continue;
          const A = at(tx, ty), rankA = RANK2[A];
          const below = (lx, ly) => {
            const b = at(lx, ly);
            return b !== A && RANK2[b] < rankA;
          };
          const key = boundaryCase(below(tx, ty - 1), below(tx + 1, ty), below(tx, ty + 1), below(tx - 1, ty), below(tx - 1, ty - 1), below(tx + 1, ty - 1), below(tx - 1, ty + 1), below(tx + 1, ty + 1));
          if (!key) continue;
          const B = dominantForeign2(at, tx, ty, A, rankA);
          if (!B) continue;
          const wx = x0 + tx, wy = y0 + ty;
          const fgKey = GW_GROUNDS[A].fillKey(seed2, wx, wy), bgKey = GW_GROUNDS[B].fillKey(seed2, wx, wy);
          const variant = hashU32(seed2 ^ 1957, wx, wy) % trans.variants;
          const cr = trans.tileAt(A, fgKey, B, bgKey, key, variant);
          if (cr) add(trans.source, cr[0], cr[1], tx, ty);
        }
      }
      for (let ty = 0; ty < CHUNK8; ty++) for (let tx = 0; tx < CHUNK8; tx++) {
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
          if (anchorX < x0 || anchorX >= x0 + CHUNK8 || ho.by < y0 || ho.by >= y0 + CHUNK8) continue;
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
      if (edge < MACRO_BLEND2 && id !== id2) tint = lerp3(tint, GW_TINT[id2], 0.5 * (1 - edge / MACRO_BLEND2));
      return lerp3(tint, richBiomes[id].macroColor(seed2, x, y), TINT_MIX2);
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

// ../auto-battler/src/render/mountainStrongholdAutotile.js
var MS_GREEN = {
  "2|22232323": [61, 6, 3, 11, 7, 2, 61, 49, 1, 83, 7, 1, 57, 6, 1],
  "2|22222222": [59, 6, 137, 61, 6, 86, 57, 6, 36, 59, 49, 24, 4, 14, 23, 61, 49, 12, 11, 6, 10, 57, 49, 9, 83, 7, 9, 6, 14, 9, 11, 7, 8, 12, 49, 3, 63, 49, 3, 39, 1, 3, 5, 14, 3, 12, 7, 1, 67, 49, 1, 31, 20, 1, 37, 5, 1, 29, 20, 1, 65, 16, 1, 49, 19, 1, 51, 20, 1, 3, 6, 1],
  "2|23223232": [61, 6, 1, 59, 6, 1, 4, 14, 1, 83, 7, 1],
  "2|22222212": [59, 6, 4, 43, 5, 1, 57, 6, 1, 83, 7, 1],
  "2|22122222": [12, 7, 5],
  "2|22222221": [11, 7, 18, 61, 6, 3, 59, 6, 2, 5, 14, 1],
  "2|23223231": [61, 6, 1],
  "2|22232313": [59, 6, 1],
  "2|21222222": [59, 6, 4, 57, 6, 2],
  "1|22222222": [12, 6, 5],
  "2|22212222": [61, 6, 2, 59, 6, 2],
  "2|23213232": [59, 6, 1],
  "2|21232323": [59, 6, 1],
  "2|22221212": [61, 6, 6, 59, 6, 4, 57, 6, 3],
  "2|12122212": [12, 7, 6],
  "2|22122111": [57, 6, 5],
  "2|22122211": [57, 6, 40, 59, 6, 21, 83, 7, 18, 61, 6, 11, 57, 49, 3, 39, 1, 2, 47, 88, 1, 3, 6, 1, 2, 6, 1, 5, 6, 1],
  "2|22122221": [59, 6, 6, 83, 7, 2, 110, 93, 1, 57, 6, 1, 61, 6, 1],
  "2|23123131": [57, 6, 2],
  "2|22231323": [61, 6, 1, 7, 14, 1],
  "2|12222212": [12, 7, 1],
  "2|22122112": [57, 6, 1],
  "2|21122211": [61, 6, 4, 59, 6, 3, 113, 94, 2, 116, 12, 1, 6, 7, 1, 57, 6, 1, 83, 7, 1],
  "1|21122211": [5, 4, 7, 2, 4, 3],
  "1|21112211": [2, 4, 30, 4, 4, 26, 3, 4, 23, 5, 4, 14],
  "1|22112211": [2, 4, 4, 5, 4, 3, 3, 4, 3, 4, 4, 1],
  "2|22112211": [101, 87, 11, 110, 94, 1, 57, 6, 1, 83, 7, 1],
  "1|21112221": [5, 4, 2, 12, 4, 1],
  "1|21212221": [1, 5, 2, 2, 5, 1],
  "1|22212212": [6, 5, 1],
  "2|22112212": [59, 6, 1],
  "1|23113231": [3, 4, 1, 12, 4, 1, 2, 4, 1],
  "2|22132313": [61, 6, 1, 101, 87, 1, 110, 94, 1],
  "1|21111211": [3, 4, 5, 2, 4, 5, 4, 4, 4, 5, 4, 1],
  "1|11111211": [2, 4, 12, 4, 4, 9, 3, 4, 5, 5, 4, 4, 12, 4, 3],
  "1|11111111": [2, 4, 143, 4, 4, 114, 3, 4, 86, 5, 4, 77, 12, 4, 7, 6, 5, 2, 11, 3, 1],
  "1|11112111": [2, 4, 9, 4, 4, 6, 5, 4, 5, 3, 4, 4, 4, 20, 1],
  "1|21112111": [4, 4, 6, 2, 4, 5, 5, 4, 3, 3, 4, 1],
  "1|12111121": [12, 5, 8, 3, 4, 6, 2, 4, 2, 5, 4, 1, 4, 4, 1],
  "2|12211121": [59, 6, 8, 1, 6, 3, 57, 6, 1, 1, 7, 1],
  "2|11222112": [86, 87, 1],
  "1|21122112": [3, 4, 1],
  "1|13113131": [6, 4, 5, 2, 4, 4, 5, 4, 3, 3, 4, 1, 12, 5, 1, 4, 20, 1],
  "1|21132313": [2, 4, 1, 5, 4, 1],
  "1|11111121": [12, 4, 9, 2, 4, 9, 5, 4, 2, 3, 4, 2, 12, 5, 1],
  "1|11211121": [4, 5, 5, 2, 4, 3, 2, 5, 2, 4, 4, 1, 1, 5, 1],
  "1|11211122": [2, 5, 26, 4, 5, 24, 5, 5, 20, 3, 5, 12],
  "1|11211112": [3, 5, 11, 4, 5, 7, 5, 5, 3, 2, 4, 2, 2, 5, 1, 3, 4, 1],
  "1|11111112": [11, 4, 22, 4, 4, 6, 3, 4, 4, 12, 5, 3, 2, 4, 2],
  "1|12112121": [12, 6, 3, 2, 4, 2, 5, 4, 1, 4, 4, 1, 3, 4, 1],
  "2|22212111": [1, 7, 2, 10, 6, 1],
  "2|21121212": [86, 88, 3, 13, 6, 1],
  "1|11121211": [2, 4, 6, 5, 4, 1],
  "1|11131313": [1, 4, 4, 2, 4, 3, 11, 4, 1, 12, 4, 1, 5, 4, 1, 4, 4, 1],
  "2|12221122": [83, 7, 32, 59, 6, 24, 57, 6, 23, 61, 6, 5, 31, 19, 1, 39, 87, 1],
  "2|11221122": [61, 6, 7, 83, 7, 6, 57, 6, 4, 59, 6, 1],
  "1|11221112": [11, 5, 11, 6, 6, 2, 3, 4, 1],
  "1|12112111": [3, 4, 3, 2, 4, 3, 5, 4, 1],
  "2|21112111": [1, 7, 4, 101, 87, 2],
  "1|21121211": [69, 12, 4, 5, 4, 4, 6, 4, 1],
  "1|11231323": [11, 5, 1, 4, 5, 1],
  "2|22212121": [61, 6, 3, 1, 7, 1, 10, 6, 1],
  "2|22221222": [59, 6, 12, 11, 7, 7, 83, 7, 3, 7, 14, 3, 57, 6, 1, 5, 6, 1],
  "2|11221222": [11, 6, 10, 59, 6, 1, 83, 7, 1],
  "1|11221122": [11, 5, 12, 4, 5, 1, 5, 5, 1, 3, 5, 1],
  "1|11211111": [2, 4, 3, 6, 6, 2, 3, 4, 2, 4, 5, 1, 4, 4, 1],
  "1|11112112": [11, 4, 1],
  "1|21111111": [2, 4, 3, 6, 4, 2, 3, 4, 1, 4, 4, 1],
  "2|12231323": [11, 6, 1, 59, 6, 1],
  "2|11221112": [59, 6, 3, 83, 7, 2, 86, 87, 2],
  "1|11121122": [12, 6, 3],
  "1|12212121": [12, 6, 8],
  "2|22212122": [83, 7, 4, 61, 6, 4, 59, 6, 2, 3, 6, 1],
  "2|12221222": [11, 6, 12, 83, 7, 2, 57, 6, 1, 59, 6, 1],
  "1|12111122": [12, 5, 4, 5, 4, 1],
  "2|11211121": [1, 6, 2, 61, 6, 1, 1, 7, 1, 10, 4, 1],
  "1|13213131": [3, 5, 1, 12, 6, 1],
  "2|21221222": [61, 6, 3, 59, 6, 2],
  "1|12221212": [12, 6, 3],
  "2|12112122": [12, 7, 3],
  "2|22222121": [57, 6, 2, 83, 7, 1],
  "2|22122212": [49, 20, 2, 12, 7, 1],
  "1|12122122": [12, 6, 2, 4, 4, 1],
  "2|22211121": [1, 7, 2, 10, 5, 2, 59, 6, 1],
  "2|13213131": [61, 6, 1],
  "2|11122212": [12, 7, 6, 43, 85, 1],
  "1|22122111": [5, 4, 1, 12, 6, 1, 108, 13, 1],
  "2|22112221": [101, 87, 7],
  "1|12222222": [12, 6, 2],
  "2|12112112": [12, 7, 2],
  "2|23213131": [59, 6, 1],
  "1|11112211": [4, 4, 1, 5, 4, 1],
  "1|22112111": [3, 4, 4, 5, 4, 3],
  "2|22122121": [57, 6, 1],
  "1|21122111": [5, 4, 2],
  "2|23213132": [59, 6, 1],
  "1|21132323": [4, 4, 1],
  "1|21212211": [5, 4, 1],
  "1|21112212": [2, 4, 1, 11, 4, 1],
  "1|12231323": [4, 5, 1],
  "2|11211122": [39, 1, 1],
  "1|11112121": [2, 4, 3, 12, 4, 1, 3, 4, 1, 5, 4, 1],
  "1|21212121": [3, 4, 1, 4, 5, 1],
  "1|21211212": [6, 6, 1, 6, 5, 1],
  "1|11111212": [2, 4, 2, 4, 4, 1, 3, 4, 1],
  "1|21212222": [5, 5, 1, 2, 5, 1],
  "1|21211222": [3, 5, 1],
  "1|11211222": [2, 5, 1],
  "1|21212212": [3, 5, 1],
  "2|12232323": [59, 6, 1],
  "2|22221122": [83, 7, 2, 39, 1, 1],
  "1|12222122": [12, 6, 1],
  "2|12211111": [3, 6, 1],
  "2|11121112": [6, 7, 2],
  "1|11121111": [2, 4, 5, 4, 4, 2, 12, 4, 1],
  "2|12222222": [12, 7, 1],
  "2|22222122": [5, 14, 3, 57, 6, 1, 59, 6, 1, 3, 7, 1],
  "1|12212122": [3, 5, 2, 5, 5, 1, 2, 4, 1],
  "2|21212122": [5, 6, 1, 64, 96, 1],
  "1|21221212": [69, 12, 1, 12, 6, 1, 6, 6, 1],
  "1|11111222": [12, 5, 1],
  "2|22211122": [64, 96, 1],
  "1|11111122": [12, 5, 5, 2, 4, 1, 4, 4, 1],
  "2|12222122": [59, 6, 2, 83, 7, 1, 5, 6, 1],
  "1|12221112": [12, 6, 3],
  "2|13113132": [12, 7, 1],
  "1|23123131": [12, 6, 1],
  "2|21222212": [57, 6, 1],
  "1|21121212": [12, 6, 1],
  "1|21221222": [1, 5, 1, 69, 12, 1],
  "1|11212212": [6, 5, 1],
  "1|21112112": [5, 4, 1],
  "1|13113232": [5, 4, 1, 4, 4, 1, 6, 5, 1],
  "2|21121211": [98, 89, 3, 57, 6, 1],
  "2|22121221": [57, 6, 1],
  "2|12221221": [1, 6, 1],
  "1|11121112": [4, 4, 3, 3, 4, 3, 5, 4, 1, 1, 4, 1],
  "2|22121211": [43, 85, 1],
  "2|11121211": [110, 93, 1],
  "1|13123131": [5, 4, 1],
  "1|22112221": [5, 4, 1],
  "2|22212211": [1, 7, 1],
  "1|13123132": [2, 4, 1],
  "1|13123231": [3, 4, 1],
  "1|13213232": [4, 5, 1],
  "1|12221122": [12, 6, 3],
  "2|12212122": [3, 14, 3],
  "2|13223132": [61, 6, 1, 57, 6, 1],
  "2|12222232": [3, 14, 3],
  "2|22322132": [3, 15, 3],
  "2|22322233": [5, 15, 19, 4, 15, 11, 6, 15, 7, 57, 6, 1],
  "2|22322223": [7, 15, 3, 5, 15, 1],
  "2|22222223": [7, 14, 3, 4, 14, 3],
  "2|22132323": [57, 6, 1],
  "2|22222232": [4, 14, 3],
  "2|23322232": [3, 15, 3],
  "3|23322233": [3, 16, 3],
  "3|23332233": [4, 16, 33],
  "3|22332233": [7, 16, 3],
  "2|22332223": [7, 15, 3],
  "3|23332223": [4, 16, 1],
  "3|23232213": [4, 16, 1],
  "3|23132232": [4, 16, 1],
  "3|23332231": [4, 16, 1],
  "1|22232333": [13, 4, 1],
  "2|22312232": [5, 15, 1],
  "2|23222213": [5, 15, 1],
  "3|23123232": [3, 16, 1],
  "3|33333231": [4, 16, 1],
  "3|33333333": [4, 16, 96],
  "3|33332333": [4, 16, 7],
  "3|22332333": [7, 16, 4],
  "2|22332233": [5, 15, 3],
  "2|23322233": [5, 15, 2],
  "3|23323233": [3, 16, 2],
  "3|33333233": [4, 16, 4],
  "3|32333313": [4, 16, 1],
  "2|31133313": [71, 18, 1],
  "1|33123331": [6, 3, 1],
  "3|33313331": [4, 16, 4],
  "2|23323233": [4, 15, 1],
  "2|13132333": [13, 6, 1],
  "3|23322131": [4, 16, 1],
  "3|22332213": [4, 16, 1],
  "2|21133213": [71, 18, 1],
  "1|33123231": [6, 3, 1],
  "3|23332333": [4, 16, 3],
  "3|23333233": [4, 16, 3],
  "3|31332323": [4, 16, 1],
  "1|21231313": [1, 5, 1],
  "3|33313131": [4, 16, 6],
  "1|23133313": [6, 4, 1],
  "3|33113211": [4, 16, 1],
  "3|33133311": [4, 16, 30],
  "3|31132321": [4, 16, 1],
  "1|21231311": [1, 5, 1],
  "1|13113212": [6, 5, 1],
  "3|33113111": [4, 16, 1],
  "3|33133331": [4, 16, 3],
  "3|33333331": [4, 16, 7],
  "3|33333313": [4, 16, 5],
  "3|33133313": [4, 16, 2],
  "3|32131321": [4, 16, 1],
  "2|11231321": [1, 6, 1],
  "1|13223112": [6, 6, 1],
  "3|33113112": [4, 16, 1],
  "1|11233313": [13, 4, 1],
  "1|31113122": [5, 20, 1],
  "1|31213311": [5, 20, 1],
  "1|32111322": [6, 20, 1],
  "2|11211321": [1, 6, 1],
  "1|11223112": [6, 6, 1],
  "1|31113112": [4, 20, 1, 12, 3, 1],
  "1|31113311": [5, 20, 21, 4, 20, 5, 6, 20, 3],
  "1|33113311": [6, 20, 2],
  "3|33113331": [2, 18, 4],
  "3|31133313": [8, 18, 3],
  "1|31133311": [4, 20, 1, 5, 20, 1],
  "1|32112321": [5, 20, 1],
  "2|22211311": [1, 7, 1],
  "2|11123212": [6, 7, 1],
  "1|31123111": [4, 20, 1],
  "1|33113331": [6, 20, 1],
  "2|11231313": [13, 5, 1],
  "1|12121112": [6, 20, 2],
  "2|11111111": [110, 93, 2, 6, 7, 1, 52, 98, 1],
  "1|12122121": [2, 4, 1, 5, 20, 1, 4, 4, 1, 6, 20, 1],
  "2|22211111": [1, 7, 1, 10, 6, 1],
  "2|11121212": [6, 7, 1, 13, 6, 1],
  "1|11113111": [5, 4, 4, 3, 4, 1],
  "1|33113111": [12, 3, 3],
  "1|31131311": [11, 3, 2],
  "1|11111311": [2, 4, 2, 3, 4, 2],
  "3|33113311": [2, 18, 1],
  "3|31133311": [8, 18, 1],
  "2|21131313": [13, 6, 1],
  "1|11122211": [2, 4, 2, 5, 4, 1],
  "1|12112211": [2, 4, 2, 5, 4, 1],
  "1|33113131": [6, 4, 2],
  "3|31333313": [4, 16, 1],
  "1|31131313": [1, 4, 1],
  "1|11213111": [4, 4, 1],
  "1|31111311": [11, 3, 1],
  "1|12111111": [2, 4, 4, 4, 4, 1, 3, 4, 1],
  "1|21131313": [69, 12, 1, 5, 4, 1],
  "3|31331313": [4, 16, 4],
  "2|11211111": [52, 98, 3, 13, 5, 1],
  "1|11212121": [2, 4, 1],
  "1|21211112": [6, 6, 1],
  "2|12111111": [43, 85, 3],
  "2|11121111": [110, 93, 3],
  "1|12112122": [3, 4, 2, 2, 4, 1],
  "2|21211121": [10, 4, 2],
  "1|11221212": [13, 4, 2],
  "1|12211121": [2, 4, 1],
  "2|12211112": [5, 6, 1],
  "1|21212111": [1, 5, 3],
  "1|21111212": [6, 5, 3],
  "1|11131323": [12, 5, 1],
  "1|12211111": [12, 6, 1, 2, 4, 1],
  "2|11111112": [6, 7, 1, 52, 98, 1, 43, 85, 1],
  "1|12121121": [2, 4, 1],
  "2|12212121": [4, 6, 1],
  "2|21222122": [5, 6, 1],
  "1|12231313": [12, 6, 1],
  "2|11112112": [12, 7, 1],
  "1|21121111": [69, 12, 2, 11, 3, 1],
  "1|12112221": [4, 4, 1],
  "2|11112111": [52, 98, 1],
  "2|11221212": [6, 7, 3, 13, 5, 1, 11, 6, 1],
  "1|13213132": [3, 5, 1],
  "2|11132313": [12, 7, 1],
  "1|21121121": [5, 4, 1],
  "1|11211211": [2, 4, 1, 13, 4, 1],
  "1|13113111": [12, 3, 1],
  "3|33113131": [2, 18, 1],
  "3|31331323": [4, 16, 1],
  "1|11231313": [11, 5, 1],
  "1|21211111": [1, 4, 1],
  "1|21111121": [12, 4, 1, 11, 3, 1],
  "2|21221212": [6, 7, 1],
  "1|11121212": [2, 4, 1, 1, 4, 1],
  "2|22112111": [1, 7, 4],
  "1|12111221": [2, 4, 1],
  "3|32331323": [4, 16, 1],
  "2|11231323": [11, 6, 1],
  "2|21211111": [10, 4, 1],
  "1|12122212": [13, 4, 1],
  "3|32332323": [4, 16, 1],
  "1|11121121": [4, 4, 1],
  "1|12222112": [12, 6, 1],
  "2|21111112": [13, 6, 1],
  "2|23123231": [59, 6, 1],
  "2|21111111": [101, 87, 1],
  "3|32332333": [4, 16, 1],
  "2|22332323": [7, 15, 1],
  "2|21221213": [7, 14, 1],
  "1|12211211": [12, 3, 1],
  "1|11331333": [2, 4, 1],
  "1|11312133": [2, 4, 1],
  "1|21311133": [2, 4, 1],
  "1|11311233": [2, 4, 1, 12, 4, 1],
  "1|11311133": [2, 4, 19, 4, 4, 9, 3, 4, 3, 11, 3, 1, 12, 5, 1, 6, 6, 1],
  "1|13313133": [6, 4, 1, 2, 4, 1],
  "3|33313133": [4, 16, 1],
  "2|21331233": [7, 15, 1],
  "1|11321233": [1, 4, 1],
  "1|12311133": [3, 4, 2],
  "2|11311133": [1, 6, 1],
  "1|11321133": [6, 6, 1],
  "2|11312133": [10, 4, 1],
  "1|21321133": [13, 4, 1],
  "1|12312233": [5, 4, 1],
  "2|22312133": [101, 87, 1],
  "2|21322233": [83, 7, 1],
  "1|21321233": [5, 4, 1]
};
var MS_ICY = {
  "1|11131313": [2, 47, 3, 17, 56, 2],
  "1|11112111": [19, 56, 2, 18, 56, 1, 2, 47, 1, 17, 56, 1],
  "1|21112111": [2, 47, 2, 19, 56, 1],
  "1|21112211": [2, 47, 6],
  "1|21110221": [2, 47, 1],
  "1|01211211": [2, 47, 1],
  "1|11111012": [2, 47, 1],
  "1|11111111": [2, 47, 71, 17, 56, 12, 19, 56, 7, 18, 56, 5, 12, 47, 3, 17, 64, 2],
  "1|12111121": [2, 47, 7, 19, 56, 3, 12, 48, 3],
  "2|11211121": [66, 4, 10, 44, 48, 3, 59, 49, 1],
  "1|11221112": [11, 48, 16, 31, 67, 3, 20, 64, 3],
  "1|11111112": [2, 47, 21, 19, 56, 2],
  "1|21110211": [2, 47, 1],
  "1|01111211": [2, 47, 1],
  "1|11111011": [2, 47, 1],
  "1|13113131": [2, 47, 3, 19, 56, 1, 17, 64, 1],
  "1|12112111": [2, 47, 7],
  "2|22111111": [66, 4, 7],
  "2|11121211": [66, 9, 7],
  "1|11121111": [2, 47, 4, 12, 47, 3],
  "1|11111121": [2, 47, 4, 17, 56, 2, 19, 56, 1, 12, 48, 1],
  "1|11211111": [19, 64, 4, 17, 64, 3, 18, 56, 2, 2, 47, 2, 2, 49, 1],
  "1|21111211": [2, 47, 1],
  "1|11111211": [2, 47, 1],
  "1|11111122": [12, 48, 3, 17, 64, 2, 20, 64, 2],
  "1|21112121": [19, 56, 2],
  "1|21211211": [2, 47, 2, 19, 64, 1],
  "1|11111212": [12, 48, 3, 2, 47, 2],
  "1|11212111": [19, 64, 1],
  "1|21112122": [17, 64, 1],
  "1|11111222": [20, 64, 1],
  "1|12221122": [2, 49, 4, 5, 49, 3],
  "2|11211122": [45, 5, 3, 63, 20, 3],
  "1|11112121": [19, 64, 2],
  "1|21212121": [17, 64, 3],
  "1|21211212": [19, 64, 3],
  "1|12112121": [12, 49, 3],
  "2|22211121": [61, 49, 3],
  "2|12222222": [59, 49, 6],
  "2|22221122": [61, 49, 3, 57, 49, 3],
  "2|11221222": [11, 49, 3, 4, 49, 3],
  "1|12112112": [19, 64, 3],
  "2|22111121": [151, 29, 3],
  "2|11221221": [64, 9, 3],
  "1|11231313": [11, 48, 1],
  "1|11112122": [19, 64, 1],
  "1|12211121": [2, 49, 1],
  "2|12211122": [44, 48, 3],
  "2|11221112": [4, 49, 3],
  "1|11121122": [12, 49, 3],
  "1|12212101": [63, 49, 3],
  "2|22012102": [59, 49, 3, 57, 49, 2],
  "2|22022200": [61, 49, 9, 57, 49, 7, 59, 49, 6, 61, 6, 3],
  "2|22021220": [67, 49, 3],
  "2|11221220": [11, 49, 3],
  "1|11222122": [5, 49, 3],
  "1|22212122": [5, 49, 3],
  "2|22211222": [57, 49, 3],
  "1|11211121": [2, 49, 1],
  "1|12211122": [2, 49, 1],
  "1|13213131": [2, 49, 1],
  "2|11231323": [11, 49, 1],
  "1|12111122": [12, 49, 1],
  "2|12212121": [59, 49, 1],
  "2|22222122": [61, 49, 6],
  "2|21221222": [57, 49, 3],
  "1|12221202": [63, 49, 3],
  "2|10012102": [116, 12, 3],
  "2|22001220": [67, 49, 3],
  "2|12221220": [59, 49, 3],
  "2|12222122": [59, 49, 4],
  "2|22221222": [57, 49, 3],
  "2|11221212": [11, 49, 3],
  "1|12121122": [12, 49, 3],
  "2|12211121": [59, 49, 1],
  "2|13213131": [59, 49, 1],
  "2|22031323": [67, 49, 1],
  "2|12222220": [59, 49, 1],
  "1|12222102": [63, 49, 1],
  "2|22021200": [61, 49, 3],
  "2|10022200": [116, 12, 4],
  "2|22002200": [57, 49, 4],
  "2|21021220": [67, 49, 3],
  "1|12222200": [63, 49, 3],
  "2|23013132": [57, 49, 1],
  "2|22011102": [57, 49, 1],
  "2|10002200": [116, 12, 3],
  "2|02200021": [59, 6, 2, 61, 6, 2],
  "2|02220022": [61, 6, 15, 61, 49, 9, 59, 49, 6, 59, 6, 5, 57, 49, 3],
  "2|00220022": [59, 6, 3],
  "2|03203031": [61, 6, 1],
  "2|01220012": [59, 6, 3, 59, 49, 1],
  "1|02122022": [12, 49, 3, 63, 49, 2],
  "2|22212021": [57, 49, 2, 61, 6, 2],
  "2|22222222": [59, 49, 51, 61, 49, 45, 59, 6, 43, 57, 49, 42, 61, 6, 36, 11, 7, 6, 11, 6, 5, 67, 49, 3, 57, 6, 3, 86, 17, 1],
  "2|22220222": [59, 6, 3],
  "2|02220222": [11, 6, 3],
  "2|23213031": [61, 6, 1],
  "2|01230313": [59, 49, 1],
  "2|21221212": [59, 6, 9, 61, 6, 6, 59, 49, 2, 61, 49, 1, 57, 49, 1],
  "1|12122222": [63, 49, 11, 12, 7, 9, 13, 49, 2, 12, 49, 1],
  "2|22212121": [61, 49, 6, 59, 49, 5, 57, 49, 4, 59, 6, 3],
  "2|23213131": [57, 49, 2, 61, 49, 1, 59, 49, 1, 59, 6, 1],
  "2|21231313": [59, 49, 2, 61, 49, 1, 57, 49, 1]
};

// ../auto-battler/src/render/mountainStronghold.js
var MS = "/assets/minifantasy/Minifantasy_Mountain_Stronghold_v1.0/Minifantasy_Mountain_Stronghold_Assets";
var MS_TILES_URL = `${MS}/Tileset/Tileset.png`;
var MS_PROPS_URL = `${MS}/Props/Props.png`;
var MS_MOCKUP_URL = `${MS}/Mockup_Exterior.png`;
var MS_PREMADE_DIR = `${MS}/Premade/Premade_Exterior/_Separate_Layers`;
var TILE10 = 8;
var CHUNK9 = 32;
var MS_REF = {
  dir: MS_PREMADE_DIR,
  w: 488,
  h: 592,
  bg: "#14171c",
  layers: [
    ["Exterior_l-bg", "Background", "ground"],
    ["Exterior_k-jagged_cliffs", "Jagged cliffs", "ground"],
    ["Exterior_j-snow_1", "Snow 1", "ground"],
    ["Exterior_i-structures_built_into_cliffs", "Structures in cliffs", "structure"],
    ["Exterior_h-props", "Props", "scatter"],
    ["Exterior_g-bridges", "Bridges", "structure"],
    ["Exterior_f-battlements_and_rooftops", "Battlements & rooftops", "structure"],
    ["Exterior_e-snow_2", "Snow 2", "ground"],
    ["Exterior_d-doors_windows", "Doors & windows", "structure"],
    ["Exterior_c-stairs", "Stairs", "structure"],
    ["Exterior_b-human", "Characters", "scatter"],
    ["Exterior_a-shadows", "Shadows", "lighting"]
  ]
};
var MS_SNOW = [2, 47];
var MS_PIT = [4, 16];
var MS_GBODY = [[57, 6], [59, 6], [61, 6], [83, 7]];
var MS_IBODY = [[57, 49], [59, 49], [61, 49], [67, 49]];
var FLOOR_BASE = [39, 85];
var FLOOR_VARS = [[40, 85], [39, 86], [40, 86]];
var COL_GRASS4 = [110, 140, 95];
var COL_FACE = [90, 95, 105];
var COL_SNOW = [200, 220, 235];
var COL_PIT = [10, 10, 14];
var PLOT_W2 = 64;
var PLOT_H2 = 60;
var FACE_PER = 4;
var DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]];
var MS_BNDS = [[6, 4], [16, 2], [28, 1], [38, 0]];
var CHASM_Y0 = 44;
var CHASM_Y1 = 53;
var BR_X = 28;
function rnd(x, y, s = 0) {
  return (x * 73856093 ^ y * 19349663 ^ s * 83492791) >>> 0;
}
function vn1(x, sc, s) {
  const gx = x / sc, x0 = Math.floor(gx), fx = gx - x0;
  return rnd(x0, 0, s) % 1e3 / 1e3 * (1 - fx) + rnd(x0 + 1, 0, s) % 1e3 / 1e3 * fx;
}
function disp(x) {
  return (vn1(x, 13, 1) - 0.5) * 8 + (vn1(x, 6, 2) - 0.5) * 3.5;
}
function lev(x, y) {
  const yy = y + disp(x);
  let l = 4;
  for (const [b, lv] of MS_BNDS) if (yy >= b) l = lv;
  return l;
}
function isface(x, y) {
  const h2 = lev(x, y);
  for (let yy = y - 1; yy >= y - 13; yy--) {
    const hy = lev(x, yy);
    if (hy > h2) return y - yy - 1 < FACE_PER * (hy - h2);
  }
  return false;
}
function topface(x, y) {
  const h2 = lev(x, y);
  for (let yy = y - 1; yy >= y - 13; yy--) {
    const hy = lev(x, yy);
    if (hy > h2) return hy === 4;
  }
  return false;
}
function jit(x) {
  return Math.round((vn1(x, 9, 7) - 0.5) * 5);
}
function isVoid(x, y) {
  return lev(x, y) === 0 && !isface(x, y) && y >= CHASM_Y0 + jit(x) && y < CHASM_Y1 + jit(x);
}
function cls(x, y) {
  return isVoid(x, y) ? 3 : isface(x, y) ? 2 : 1;
}
function sigKey(x, y) {
  let s = cls(x, y) + "|";
  for (const [dx, dy] of DIRS) s += cls(x + dx, y + dy);
  return s;
}
function allc(x, y, k) {
  for (const [dx, dy] of DIRS) if (cls(x + dx, y + dy) !== k) return false;
  return true;
}
function wpick(tab, key, salt, fb) {
  const flat2 = tab[key];
  if (!flat2) return fb;
  let tot = 0;
  for (let i = 2; i < flat2.length; i += 3) tot += flat2[i];
  let r = salt % tot;
  for (let i = 0; i < flat2.length; i += 3) {
    r -= flat2[i + 2];
    if (r < 0) return [flat2[i], flat2[i + 1]];
  }
  return fb;
}
function bridgeTile(x, y) {
  const bx = x - BR_X;
  if (bx < 0 || bx > 6) return null;
  const y0 = CHASM_Y0 + jit(x) - 2, y1 = CHASM_Y1 + jit(x) + 1;
  if (y < y0 || y > y1) return null;
  const deck = [[149, 29], [150, 29], [151, 29], [152, 29], [153, 29]];
  let row;
  if (y === y0) row = [[148, 27], [149, 27], null, null, null, [153, 27], [154, 27]];
  else if (y === y0 + 1) row = [[40, 1], [149, 28], [150, 28], null, [152, 28], [153, 28], [42, 1]];
  else if (y === y1 - 1) row = [[148, 27], [149, 34], [150, 29], [151, 29], [152, 29], [153, 34], [154, 27]];
  else if (y === y1) row = [[40, 1], [149, 35], [150, 35], [151, 35], [152, 35], [153, 35], [42, 1]];
  else row = [[40, 1], ...deck, [42, 1]];
  return row[bx];
}
function surfaceTile(wx, wy) {
  const c = cls(wx, wy);
  const icy = topface(wx, wy) && !isVoid(wx, wy) || lev(wx, wy) === 4;
  const tab = icy ? MS_ICY : MS_GREEN, body = icy ? MS_IBODY : MS_GBODY;
  if (c === 3 && allc(wx, wy, 3)) return MS_PIT;
  if (c === 2 && allc(wx, wy, 2)) return body[rnd(wx, wy, 7) % 4];
  if (c === 1 && lev(wx, wy) === 4 && allc(wx, wy, 1)) return MS_SNOW;
  const fb = c === 3 ? MS_PIT : c === 2 ? body[1] : lev(wx, wy) === 4 ? MS_SNOW : [3, 4];
  return wpick(tab, sigKey(wx, wy), rnd(wx, wy, c === 2 ? 5 : 6), fb);
}
function cellStack(wx, wy) {
  const out = [surfaceTile(wx, wy)];
  const bt = bridgeTile(wx, wy);
  if (bt) out.push(bt);
  return out;
}
var MS_MAP_ASSETS = [MS_TILES_URL];
var mountainStrongholdConfig = (seed) => ({
  seed,
  tile: TILE10,
  chunk: CHUNK9,
  background: "#96c8eb",
  // snowy sky
  bounds: { x0: 0, y0: 0, x1: PLOT_W2, y1: PLOT_H2 },
  async load({ Assets }) {
    const ctx = { tiles: null };
    const t = await Assets.load(MS_TILES_URL);
    t.source.scaleMode = "nearest";
    ctx.tiles = t.source;
    return ctx;
  },
  bake({ x0, y0, ctx, add, accept = () => true }) {
    for (let ty = 0; ty < CHUNK9; ty++) for (let tx = 0; tx < CHUNK9; tx++) {
      if (!accept(tx, ty)) continue;
      for (const t of cellStack(x0 + tx, y0 + ty)) add(ctx.tiles, t[0], t[1], tx, ty);
    }
    return {};
  },
  macroColor(seed2, tx, ty) {
    const c = cls(tx, ty);
    if (c === 3) return COL_PIT;
    if (c === 2) return COL_FACE;
    return lev(tx, ty) === 4 ? COL_SNOW : COL_GRASS4;
  }
});
function createMountainStrongholdMap(pixi, host, opts = {}) {
  return createChunkedMap(pixi, host, { ...mountainStrongholdConfig(opts.seed ?? 1), keyboardPan: opts.keyboardPan });
}
var MS_TILE_CATALOG = [
  // ── GREEN grass system (rows 3-20) ───────────────────────────────────────────────────────────
  {
    name: "Grass plateau \u2014 autotile 9-slice",
    role: "surface",
    frame: [1, 5, 6, 3],
    used: true,
    tiles: [[1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5]],
    note: "grass FLOOR: row3 top-edge \xB7 row4 interior+speckle ([2-5,4]) \xB7 row5 bottom-edge. W/E/corner columns at 1/6."
  },
  {
    name: "Grass plateau \u2014 outer/convex corners",
    role: "surface",
    frame: [10, 8, 4, 6],
    used: true,
    tiles: [[11, 3], [12, 3], [10, 4], [11, 4], [12, 4], [13, 4], [11, 5], [12, 5]],
    note: "convex grass corners + the col-11 (right) / col-12 (left) cliff-edge columns that frame a face."
  },
  {
    name: "Grass cliff-FACE \u2014 rock body",
    role: "face",
    frame: [57, 10, 18, 5],
    used: true,
    tiles: [[57, 6], [59, 6], [61, 6], [83, 7], [57, 7], [59, 7], [61, 7], [57, 10], [59, 10], [61, 10]],
    note: "the jagged rock wall hanging below a grass terrace: row6 top-rim, rows7-9 repeatable body, row10 base. L/R edges at 78/82-84."
  },
  {
    name: "Grass \u2192 VOID dither (chasm rim)",
    role: "transition",
    frame: [1, 20, 9, 9],
    used: true,
    tiles: [[4, 14], [5, 14], [4, 15], [5, 15], [4, 16], [2, 18], [8, 18], [3, 20], [4, 20], [5, 20], [6, 20], [7, 20]],
    note: "the SECOND transition block \u2014 rock/grass STIPPLING into black: rows14-16 fade, diagonal corners [2,18]/[8,18], white-dot bottom rim [3-7,20]. Used only at the chasm, never on open ground."
  },
  // ── SNOW / ICY system (rows 46-63 = green +43) ───────────────────────────────────────────────
  {
    name: "Snow plateau \u2014 autotile 9-slice",
    role: "surface",
    frame: [1, 48, 6, 3],
    used: true,
    tiles: [[1, 46], [2, 46], [3, 46], [4, 46], [5, 46], [6, 46], [1, 47], [2, 47], [3, 47], [4, 47], [5, 47], [6, 47], [1, 48], [2, 48], [3, 48], [4, 48], [5, 48], [6, 48]],
    note: "snow FLOOR (icy-cap tier): same 9-slice as grass but snow-white; interior [2,47]. Its edges differ from grass \u2014 its own organic snow\u2192cliff border."
  },
  {
    name: "Snow plateau \u2014 corners / cliff-edges",
    role: "surface",
    frame: [10, 51, 4, 7],
    used: true,
    tiles: [[11, 46], [12, 46], [11, 47], [12, 47], [11, 50], [12, 50]],
    note: "snow convex corners + col-11/12 icy-cliff edge columns."
  },
  {
    name: "Icy cliff-FACE \u2014 rock body",
    role: "face",
    frame: [57, 53, 18, 5],
    used: true,
    tiles: [[57, 49], [59, 49], [61, 49], [67, 49], [57, 50], [59, 50], [61, 50], [57, 53], [59, 53], [61, 53]],
    note: "snow-capped grey rock wall (row49 snow rim, rows50-52 body, row53 base). The icy counterpart of the green face."
  },
  {
    name: "Snow \u2192 VOID dither (chasm rim)",
    role: "transition",
    frame: [1, 63, 9, 9],
    used: false,
    tiles: [[4, 57], [5, 57], [4, 58], [5, 58], [2, 61], [8, 61], [3, 63], [4, 63], [5, 63]],
    note: "snow stippling into black (icy chasm). Not yet placed (the chasm currently sits in the grass base)."
  },
  // ── The void ─────────────────────────────────────────────────────────────────────────────────
  {
    name: "Chasm VOID (black)",
    role: "void",
    frame: [4, 16, 1, 1],
    used: true,
    tiles: [[4, 16]],
    note: "pure black [4,16] \u2014 the bottomless chasm interior + the l-bg background. Bridges span it."
  },
  // ── Structures (bridges, walls, gate, battlements, tower, stairs) ────────────────────────────
  {
    name: "Bridge \u2014 vertical railed walkway",
    role: "structure",
    frame: [148, 35, 7, 9],
    used: true,
    tiles: [[149, 29], [150, 29], [151, 29], [152, 29], [153, 29], [149, 28], [153, 28], [149, 34], [153, 34], [40, 1], [42, 1]],
    note: "the walkway spanning the chasm: 5-wide deck [149-153,29] (repeat), top/bottom caps rows27/28/34/35, rail posts [40,1]/[42,1]."
  },
  { name: "Bridge / aqueduct \u2014 arched span", role: "structure", frame: [102, 27, 24, 23], tiles: [[102, 5]], used: false, note: "the horizontal arched stone bridge variant (alt to the vertical walkway)." },
  {
    name: "Battlemented wall + merlons",
    role: "structure",
    frame: [170, 47, 8, 47],
    used: false,
    tiles: [[171, 1], [188, 44], [187, 43], [170, 44], [176, 44], [187, 5]],
    note: "curtain-wall kit: merlon [188,44] (snow cap [187,43]) over wall-walk [171,1] (edges [170,44]/[176,44]), base [187,5]. For the fortress plan."
  },
  { name: "Fortress wall (9-slice + windows)", role: "structure", frame: [34, 24, 13, 24], tiles: [[34, 1], [97, 9]], used: false, note: "stone wall block w/ baked windows (snowy [34,1]; plain [34,44]). Lower-wall fill [97,9]." },
  { name: "Wall with arched door / gate", role: "structure", frame: [61, 22, 9, 20], tiles: [[61, 3], [109, 16], [110, 16]], used: false, note: "arched doorway; wooden gate leaves [109,16]/[110,16] over [109,17]/[110,17]." },
  { name: "Great gate arch", role: "structure", frame: [180, 36, 23, 37], tiles: [[180, 0]], used: false, note: "large gatehouse archway (snowy [180,0]; plain [180,43])." },
  { name: "Corner tower", role: "structure", frame: [156, 35, 11, 30], tiles: [[156, 6]], used: false, note: "round corner tower (snowy [156,6]; plain [156,49])." },
  { name: "Stairs", role: "structure", frame: [116, 22, 2, 2], tiles: [[116, 21], [117, 21], [116, 22], [117, 22]], used: false, note: "stone stair flight (c-stairs layer)." },
  { name: "Cliff cave / tunnel mouth", role: "structure", frame: [1, 28, 13, 27], tiles: [[1, 2]], used: false, note: "dark opening bored into the cliff (snowy; plain [1,45])." },
  // ── Floors (paved, not the terrain autotile) ─────────────────────────────────────────────────
  {
    name: "Stone floor (grey + shades)",
    role: "floor",
    frame: [38, 107, 3, 23],
    tiles: [FLOOR_BASE, ...FLOOR_VARS],
    used: false,
    note: "paved grey floor [39,85] + variants (for fortress interiors; the open ground now uses the grass autotile)."
  },
  { name: "Flagstone courtyard", role: "floor", frame: [101, 107, 19, 23], tiles: [[101, 85]], used: false, note: "large paved courtyard / autotile area." }
];
var MS_PROP_CATALOG = [
  { name: "Crates & stone braziers", role: "prop", frame: [1, 16, 7, 15], tiles: [[1, 16]], used: false, note: "wooden crates + stone fire braziers/stands." },
  { name: "Wooden table / cart", role: "prop", frame: [9, 10, 3, 9], tiles: [[9, 10]], used: false, note: "table or hand-cart." },
  { name: "Banners, racks & barrels", role: "prop", frame: [13, 17, 20, 17], tiles: [[13, 17]], used: false, note: "hanging banners, weapon racks, barrels, bones \u2014 mixed hall clutter." },
  { name: "Rubble / rock pillars", role: "prop", frame: [3, 33, 1, 13], tiles: [[3, 33]], used: false, note: "thin rubble/rock columns (also [9] and [23]) \u2014 the pillars that stand in the chasm." },
  { name: "Snow-capped boulders", role: "prop", frame: [14, 33, 7, 14], tiles: [[14, 33]], used: false, note: "large rocks with snow." },
  { name: "Icy boulders", role: "prop", frame: [26, 33, 7, 14], tiles: [[26, 33]], used: false, note: "ice-glazed boulders." }
];

// ../auto-battler/src/render/sceneViewer.js
function createSceneViewer(pixi, host, { layers, dir, sceneW, sceneH, background = "#15121b", pulse = null, prefix = "Premade_" }) {
  const { Application, Assets, Sprite, Container } = pixi;
  let app = null;
  let root = null;
  let alive = true;
  let pulseSprite = null;
  let pulsePhase = 0;
  const layerMap = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  const emit = () => listeners.forEach((fn) => fn(getSnapshot()));
  const getSnapshot = () => ({
    layers: layers.map(([key, label2, group]) => ({ key, label: label2, group, visible: layerMap.get(key)?.visible ?? false }))
  });
  function fit3() {
    if (!root || !app) return;
    const sw = app.screen.width, sh = app.screen.height;
    const s = Math.max(1, Math.floor(Math.min(sw / sceneW, sh / sceneH)));
    root.scale.set(s);
    root.x = Math.round((sw - sceneW * s) / 2);
    root.y = Math.round((sh - sceneH * s) / 2);
  }
  const ready = (async () => {
    const a = new Application();
    await a.init({ background, antialias: false, resizeTo: host });
    if (!alive) {
      a.destroy(true);
      return;
    }
    app = a;
    host.appendChild(app.canvas);
    root = new Container();
    app.stage.addChild(root);
    for (const [key, label2, group] of layers) {
      const container = new Container();
      root.addChild(container);
      layerMap.set(key, { container, label: label2, group, visible: true });
      try {
        const t = await Assets.load(`${dir}/${prefix}${key}.png`);
        if (!alive) return;
        t.source.scaleMode = "nearest";
        const sp = new Sprite(t);
        container.addChild(sp);
        if (pulse && key === pulse.key) pulseSprite = sp;
      } catch {
      }
    }
    fit3();
    app.renderer.on("resize", fit3);
    if (pulse) app.ticker.add(tickPulse);
    emit();
  })();
  function tickPulse(ticker) {
    if (!pulseSprite) return;
    pulsePhase += (pulse.speed ?? 0.06) * ticker.deltaTime;
    pulseSprite.alpha = (pulse.base ?? 0.72) + (pulse.amp ?? 0.28) * (0.5 + 0.5 * Math.sin(pulsePhase));
  }
  function setLayer(key, visible) {
    const L = layerMap.get(key);
    if (!L) return;
    L.visible = visible;
    L.container.visible = visible;
    emit();
  }
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function destroy() {
    alive = false;
    try {
      app?.ticker?.remove(tickPulse);
    } catch {
    }
    try {
      app?.renderer?.off("resize", fit3);
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
    layerMap.clear();
  }
  return { ready, setLayer, onChange, destroy, getSnapshot };
}

// ../auto-battler/src/engine/roomGen.js
function generateRooms(seed, W = 52, H = 36) {
  const { rnd: rnd2, ri } = makeGenRng(seed);
  const floor = new Uint8Array(W * H);
  const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const rooms = [];
  const target = ri(4, 7);
  for (let t = 0; t < 120 && rooms.length < target; t++) {
    const big = rnd2() < 0.25;
    const w = big ? ri(9, 13) : ri(5, 8), h2 = big ? ri(6, 9) : ri(4, 6);
    const x = ri(1, W - w - 2), y = ri(1, H - h2 - 2);
    let ok = true;
    for (const r of rooms) if (x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h2 + 2 > r.y) {
      ok = false;
      break;
    }
    if (!ok) continue;
    rooms.push({ x, y, w, h: h2 });
    for (let j = y; j < y + h2; j++) for (let i = x; i < x + w; i++) floor[j * W + i] = 1;
  }
  const set = (x, y) => {
    if (at(x, y)) floor[y * W + x] = 1;
  };
  const carveH = (x02, x12, y) => {
    for (let x = Math.min(x02, x12); x <= Math.max(x02, x12); x++) {
      set(x, y);
      set(x, y + 1);
    }
  };
  const carveV = (y02, y12, x) => {
    for (let y = Math.min(y02, y12); y <= Math.max(y02, y12); y++) {
      set(x, y);
      set(x + 1, y);
    }
  };
  const connect = (a, b) => {
    const ax = a.x + (a.w >> 1), ay = a.y + (a.h >> 1), bx = b.x + (b.w >> 1), by = b.y + (b.h >> 1);
    if (rnd2() < 0.5) {
      carveH(ax, bx, ay);
      carveV(ay, by, bx);
    } else {
      carveV(ay, by, ax);
      carveH(ax, bx, by);
    }
  };
  for (let k = 1; k < rooms.length; k++) connect(rooms[k - 1], rooms[k]);
  for (let e = 0, extra = ri(1, 2); e < extra && rooms.length > 2; e++) {
    const a = rooms[ri(0, rooms.length - 1)], b = rooms[ri(0, rooms.length - 1)];
    if (a !== b) connect(a, b);
  }
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (floor[y * W + x]) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { W, H, floor, rooms, bounds: { x0, y0, x1, y1 } };
}

// ../auto-battler/src/render/interiorSkins.js
var MF = "/assets/minifantasy";
var ORC3 = "/assets/minifantasy/Minifantasy_Orc_Kingdom_v1.0/Minifantasy_Orc_Kingdom_Assets/Tileset/Tiles.png";
var NECRO3 = "/assets/minifantasy/Minifantasy_Necropolis_v1.0/Minifantasy_Necropolis_Assets/Tileset/Buildings/TileasetAndPremadeZiggurats.png";
var TEMPLE = "/assets/minifantasy/Minifantasy_Temple_Of_The_Snake_God_v1.0_Commercial_Version/Temple_Of_The_Snake_God/Tileset/Tileset.png";
var ORC_PROPS = "/assets/minifantasy/Minifantasy_Orc_Kingdom_v1.0/Minifantasy_Orc_Kingdom_Assets/Props/Props.png";
var ORC_FIRE = "/assets/minifantasy/Minifantasy_Orc_Kingdom_v1.0/Minifantasy_Orc_Kingdom_Assets/Props/Animated%20Props/Fires.png";
var TEMPLE_CANDLE = "/assets/minifantasy/Minifantasy_Temple_Of_The_Snake_God_v1.0_Commercial_Version/Temple_Of_The_Snake_God/Props/_Animated_Props/M_candles/M_candles__.png";
var NECRO_PROPS = "/assets/minifantasy/Minifantasy_Necropolis_v1.0/Minifantasy_Necropolis_Assets/Props/Props.png";
var NECRO_FLAME = "/assets/minifantasy/Minifantasy_Necropolis_v1.0/Minifantasy_Necropolis_Assets/Props/UndeadFlame/UndeadFlame.png";
var TEMPLE_PROPS = "/assets/minifantasy/Minifantasy_Temple_Of_The_Snake_God_v1.0_Commercial_Version/Temple_Of_The_Snake_God/Props/Props.png";
var CRYPT = `${MF}/Minifantasy_Crypt_Of_The_Forgotten_v1.0/Minifantasy_Crypt_Of_The_Forgotten_Assets`;
var SEW = `${MF}/Minifantasy_Sewers_v1.0/Minifantasy_Sewers_Assets`;
var DW = `${MF}/Minifantasy_Dwarven_Workshop_v1.0/Minifantasy_Dwarven_Workshop_Assets`;
var flat = (b) => ({ nw: b, n: b, ne: b, w: b, c: b, e: b, sw: b, s: b, se: b });
var INTERIOR_SKINS = {
  orc: {
    label: "Orc Kingdom",
    url: ORC3,
    tile: 8,
    bg: "#15110d",
    floor: {
      nw: [42, 49],
      n: [43, 49],
      ne: [52, 49],
      w: [42, 50],
      c: [43, 50],
      e: [52, 50],
      sw: [42, 59],
      s: [43, 59],
      se: [52, 59],
      vars: [[44, 51], [46, 52], [48, 55], [45, 57]]
    },
    // Full 2.5D wall enclosure with TWO interchangeable materials — a wooden palisade and a
    // grey stone wall (same room-template layout, stone shifted +22 rows on the sheet). Each
    // room picks one. `directional` keeps height on every edge: N = face+cap, S = top+fringe,
    // E/W = a face column, with oriented corners. Some N walls sprout a window.
    // Each material: cols [left, mid, right] of its 7-wide room template + the template's rows.
    walls: {
      style: "directional",
      sets: [
        {
          // wooden palisade (room template cols 22–28, rows 11–21)
          cols: [22, 24, 28],
          rows: { nCap: 11, nFace: 12, body: 15, sTop: 19, sFringe: 20 },
          window: { top: [58, 13], bot: [58, 14] }
        },
        {
          // grey stone (palisade layout + 22 rows)
          cols: [22, 24, 28],
          rows: { nCap: 33, nFace: 34, body: 37, sTop: 41, sFringe: 42 },
          window: { top: [58, 35], bot: [58, 36] }
        }
      ]
    },
    // Fur pelts scattered as rugs + a skull-totem centrepiece, from the Orc Props sheet.
    propsUrl: ORC_PROPS,
    props: [
      { c0: 1, r0: 10, w: 2, h: 2 },
      // fur pelt rug
      { c0: 2, r0: 1, w: 2, h: 2 },
      { c0: 7, r0: 7, w: 2, h: 2 },
      // cot bed + table
      { c0: 1, r0: 4, w: 3, h: 2 }
      // horned bed
    ],
    corners: [{ c0: 5, r0: 10, w: 2, h: 2 }, { c0: 8, r0: 10, w: 2, h: 2 }, { c0: 5, r0: 12, w: 2, h: 2 }],
    // pelts tucked into corners
    clutter: { rate: 16, tiles: [[1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [12, 8]] },
    // stools / small chest
    features: [{ c0: 7, r0: 16, w: 3, h: 3 }, { c0: 9, r0: 25, w: 3, h: 4 }],
    // skull totem / bone war-standard
    torch: { url: ORC_FIRE, frame: { c0: 1, r0: 1, w: 1, h: 2 }, frames: 8, stride: 2, glow: 16750899 },
    // warm fire
    shadows: { tiles: "/assets/minifantasy/Minifantasy_Orc_Kingdom_v1.0/Minifantasy_Orc_Kingdom_Assets/Tileset/Tile_Shadows.png", props: "/assets/minifantasy/Minifantasy_Orc_Kingdom_v1.0/Minifantasy_Orc_Kingdom_Assets/Props/Prop_Shadows.png" }
  },
  necropolis: {
    label: "Necropolis",
    url: NECRO3,
    tile: 8,
    bg: "#0f0c14",
    floor: { ...flat([41, 1]), vars: [[42, 1], [43, 1], [41, 2], [42, 2], [42, 5], [41, 4], [43, 6]] },
    // Full wall enclosure (purple-brick autotile, ziggurat sheet cols 47–50/rows 23–33).
    // `north` is the tall front-facing wall (crenellated cap + brick body, listed top→bottom)
    // that gives the 2.5D height; the other sides are thin autotile edges + corner posts.
    walls: {
      cap: [48, 31],
      // cream crenellated cap (continuous top trim)
      body: [48, 32],
      // brick body
      bodyVars: [[49, 32], [50, 33], [49, 25]],
      // hole/worn brick variants sprinkled in
      height: 3,
      bot: [48, 27],
      left: [47, 25],
      right: [50, 25],
      post: [47, 23]
      // rounded post at corners / wall ends
    },
    // Scattered bones/remains from the Necropolis Props sheet (2×2 bone curls), plus a
    // hanging rune banner centrepiece in the largest room.
    propsUrl: NECRO_PROPS,
    props: [{ c0: 7, r0: 2, w: 2, h: 2 }, { c0: 9, r0: 5, w: 2, h: 2 }, { c0: 31, r0: 2, w: 1, h: 2 }, { c0: 35, r0: 2, w: 1, h: 2 }],
    // bone curls + blue urns
    corners: [{ c0: 1, r0: 2, w: 2, h: 2 }, { c0: 4, r0: 2, w: 2, h: 2 }],
    // bone heaps in room corners
    clutter: { rate: 15, tiles: [[0, 5], [1, 5], [2, 5], [3, 5], [0, 6], [2, 6], [44, 2], [46, 2]] },
    // bone bits + small relics
    // Wall-hung rune banners (3 colourways) dressing the tall faces, like the pack mockups.
    wallDecor: { drips: [{ c0: 19, r0: 1, w: 2, h: 3 }, { c0: 19, r0: 10, w: 2, h: 3 }, { c0: 19, r0: 19, w: 2, h: 3 }], dripRate: 8 },
    features: [{ c0: 12, r0: 1, w: 2, h: 4 }, { c0: 22, r0: 3, w: 2, h: 4 }],
    // blue / red rune banner
    // Undead-flame wall torches: a flame frame from the animation strip + an eerie green glow.
    torch: { url: NECRO_FLAME, frame: { c0: 1, r0: 1, w: 2, h: 2 }, frames: 8, stride: 3, glow: 4841632, spacing: 7 },
    shadows: { tiles: "/assets/minifantasy/Minifantasy_Necropolis_v1.0/Minifantasy_Necropolis_Assets/Tileset/Buildings/TileasetAndPremadeShadows.png", props: "/assets/minifantasy/Minifantasy_Necropolis_v1.0/Minifantasy_Necropolis_Assets/Props/PropShadows.png" }
  },
  temple: {
    label: "Temple",
    url: TEMPLE,
    tile: 8,
    bg: "#080c08",
    floor: { ...flat([61, 36]), vars: [[63, 36], [64, 36], [61, 38], [61, 39]] },
    // Full enclosure matching the premade scene: a tall (3-tile) green-diamond north wall with
    // a dark top cap, plus thin dark side/bottom walls (the temple's side walls are a single
    // narrow edge, distinct from the thick back wall) and corner posts.
    walls: {
      cap: [7, 3],
      // dark upper band (top trim)
      body: [7, 4],
      // green diamond wall face (col 7 = clean fill, off the window-frame highlight cols)
      bodyVars: [[8, 4], [9, 5], [6, 5]],
      // texture variants sprinkled in
      height: 3,
      bot: [7, 4],
      left: [5, 4],
      right: [11, 4],
      post: [5, 3]
      // thin sides + corner posts
    },
    // Small coiled snakes from the Temple Props sheet (2×2 each), plus a snake-idol head as
    // a centrepiece feature placed in the largest room when it fits.
    propsUrl: TEMPLE_PROPS,
    props: [{ c0: 15, r0: 21, w: 2, h: 2 }, { c0: 17, r0: 21, w: 2, h: 2 }, { c0: 19, r0: 21, w: 2, h: 2 }],
    pillar: { rects: [{ c0: 9, r0: 24, w: 2, h: 6 }, { c0: 36, r0: 24, w: 2, h: 6 }], minW: 9, minH: 7, sx: 5, sy: 4 },
    // carved snake columns in big halls
    clutter: { rate: 16, tiles: [[12, 21], [13, 21], [15, 21], [2, 40], [4, 40], [2, 42], [4, 42], [6, 48], [8, 48]] },
    // snakelets / shed scales / leaves
    features: [{ c0: 9, r0: 4, w: 3, h: 4 }, { c0: 2, r0: 3, w: 4, h: 4 }],
    // front cobra idol / side-profile head
    torch: { url: TEMPLE_CANDLE, frame: { c0: 1, r0: 2, w: 2, h: 2 }, frames: 6, stride: 3, glow: 16764006 },
    // candle
    shadows: { tiles: `${MF}/Minifantasy_Temple_Of_The_Snake_God_v1.0_Commercial_Version/Temple_Of_The_Snake_God/Tileset/Tileset_Shadows.png`, props: `${MF}/Minifantasy_Temple_Of_The_Snake_God_v1.0_Commercial_Version/Temple_Of_The_Snake_God/Props/Prop_Shadows.png` }
  },
  // Crypt Of The Forgotten — dark blue-grey brick floor, light-stone wall ring with 2-row
  // brick faces (skull-engraved variants), tomb-slab props, statue centrepieces, candles.
  // Decoded from the premade: floor fill [6,58]; walls cap(light band)=[7,1], body(brick)=[7,2].
  crypt: {
    label: "Crypt",
    url: `${CRYPT}/Tileset/Tileset.png`,
    tile: 8,
    bg: "#0b0b10",
    // Floor rebuilt as the premade's even mix of ~12 engraved/cracked brick variants (the
    // reference floor is BUSY) with rare red rose accents, plus slab/medallion inlay decals.
    floor: {
      ...flat([6, 58]),
      vars: [[28, 58], [7, 60], [6, 60]],
      mix: {
        pool: [[6, 58], [28, 58], [7, 60], [6, 60], [20, 58], [25, 58], [6, 62], [6, 66], [10, 66], [29, 60], [28, 60], [17, 62]],
        mossy: [[39, 65], [17, 63], [12, 63]]
        // red roses + cracked slabs, sparse
      }
    },
    inlays: { rects: [{ c0: 17, r0: 65, w: 2, h: 2 }, { c0: 25, r0: 65, w: 2, h: 2 }, { c0: 20, r0: 65, w: 2, h: 2 }, { c0: 12, r0: 60, w: 2, h: 1 }, { c0: 25, r0: 60, w: 2, h: 1 }], rate: 2 },
    // tomb slabs / medallions
    walls: {
      cap: [7, 1],
      // light stone band (the wall-top ring)
      body: [7, 2],
      // dark brick face
      height: 3,
      // face rows: clean brick mid, skull-engraved band woven into the bottom row like the
      // premade (engraving bands sit just above the floor)
      bodyRows: [
        [[7, 2], [6, 2], [8, 2]],
        [[7, 2], [6, 2], [8, 2], [36, 15], [36, 23], [39, 23], [41, 23]]
      ],
      side: [[4, 6], [17, 11], [17, 12], [17, 13]],
      bot: [7, 1],
      left: [4, 6],
      right: [17, 11],
      post: [4, 6],
      south: { rows: [[[7, 2], [6, 2], [8, 2]], [[7, 2], [6, 2], [8, 2]]] }
      // hanging brick fringe
    },
    doorway: { rect: { c0: 24, r0: 4, w: 4, h: 4 } },
    // grand stone arch framing each room mouth
    wallDecor: {
      drips: [{ c0: 71, r0: 0, w: 1, h: 2 }, { c0: 17, r0: 43, w: 1, h: 2 }, { c0: 15, r0: 43, w: 1, h: 2 }, { c0: 23, r0: 40, w: 1, h: 2 }, { c0: 19, r0: 43, w: 1, h: 2 }],
      // candle sconces + vine engravings
      dripRate: 6
    },
    propsUrl: `${CRYPT}/Props/Props.png`,
    props: [
      { c0: 57, r0: 1, w: 3, h: 3 },
      { c0: 62, r0: 1, w: 2, h: 3 },
      { c0: 66, r0: 6, w: 2, h: 3 },
      // vined tomb slabs
      { c0: 39, r0: 1, w: 1, h: 2 },
      { c0: 49, r0: 1, w: 1, h: 2 },
      { c0: 51, r0: 1, w: 1, h: 2 },
      // urn + lit candelabras
      { c0: 18, r0: 18, w: 1, h: 2 },
      { c0: 29, r0: 17, w: 2, h: 3 }
      // pedestal statues
    ],
    corners: [{ c0: 90, r0: 2, w: 2, h: 2 }, { c0: 92, r0: 2, w: 2, h: 2 }],
    // red grave-rose tangles
    clutter: { rate: 14, tiles: [[7, 12], [12, 12], [1, 8], [57, 0], [34, 1], [19, 3], [22, 6]] },
    // bones / debris / small relics
    features: [{ c0: 0, r0: 0, w: 3, h: 4 }, { c0: 8, r0: 0, w: 3, h: 4 }, { c0: 57, r0: 6, w: 3, h: 3 }],
    // crypt statues + tomb slab
    torch: { url: `${CRYPT}/Props/Animated_Candles/Candles.png`, frame: { c0: 0, r0: 1, w: 1, h: 2 }, frames: 12, stride: 2, glow: 16764006, spacing: 7 },
    shadows: { tiles: `${CRYPT}/Tileset/Shadows.png`, props: `${CRYPT}/Props/Prop_Shadows.png` }
  },
  // Sewers — rebuilt against the premade's full layer stack (background → ground → bridges →
  // walls → wall pipes → props → shadows-on-top). Walkways mix ~12 brick variants evenly with
  // mossy patches; sunken water channels (the pack's animated 5×5 water blocks) run through
  // long corridors with decoded bank/lip tiles, railed bridge crossings and culvert archways;
  // THREE wall materials each with cap/face-row variant pools, hanging south faces with
  // outfall arches, and inset green panels; pillars grid the big halls; slime drips / pipe
  // runs / outfall pipes dress the faces; fine clutter + corner goo + cobwebs + a crate
  // stash room; and the pack's real per-tile shadow sheets stamp the topmost layer.
  sewers: {
    label: "Sewers",
    url: `${SEW}/Tileset/Tileset.png`,
    tile: 8,
    bg: "#0a120c",
    floor: {
      nw: [5, 52],
      n: [6, 52],
      ne: [10, 52],
      w: [5, 53],
      c: [2, 62],
      e: [10, 53],
      sw: [5, 58],
      s: [6, 58],
      se: [10, 58],
      vars: [[1, 52], [3, 52], [2, 53], [2, 57]],
      // interior fill is a uniform mix (the premade walkway is ~12 tiles evenly shuffled,
      // not one fill + rare variants), with sparse mossy patches folded through
      mix: {
        pool: [[2, 62], [1, 52], [2, 52], [3, 52], [1, 53], [2, 53], [3, 53], [1, 54], [2, 54], [3, 54]],
        mossy: [[2, 57], [1, 56], [2, 56], [3, 56], [1, 57]]
      }
    },
    // Sunken channels: animated water nine-slice (Water.png frames are 5×5 blocks, inner 3×3
    // = the water with its highlight-dash edges) + the decoded walkway bank tiles per side
    // (s = the channel's brick lip wall, n = dark-shadowed edge, e/w = trim columns).
    water: {
      url: `${SEW}/Tileset/Animated_Water_Tiles/Water.png`,
      frames: 4,
      block: 5,
      inner: [1, 1],
      minRun: 6,
      moat: true,
      banks: {
        s: [[13, 52], [14, 52], [15, 52], [16, 52]],
        n: [[6, 52], [7, 52], [8, 52], [9, 52]],
        e: [[12, 53], [12, 54], [12, 55], [12, 56], [10, 55], [10, 56], [10, 57]],
        w: [[17, 53], [17, 54], [17, 55], [17, 56], [5, 55], [5, 56], [5, 57]]
      }
    },
    bridges: {
      v: { left: 37, right: 39, top: 26, mid: [27, 28], bot: 29 },
      // rail columns
      h: { short: { c0: 37, r0: 46, w: 4, h: 2 }, long: { c0: 37, r0: 49, w: 10, h: 2 } }
      // fence decals
    },
    walls: {
      height: 3,
      sets: [
        {
          // tan-green brick (premade material A)
          cap: [4, 5],
          capVars: [[5, 5], [6, 5]],
          bodyRows: [[[4, 6], [5, 6], [6, 6]], [[4, 7], [5, 7], [6, 7]]],
          side: [[3, 6], [3, 7]],
          left: [3, 6],
          right: [3, 7],
          post: [3, 5],
          bot: [4, 5],
          south: { rows: [[[4, 18], [5, 18], [6, 18], [7, 18], [8, 18]], [[4, 19], [5, 19], [6, 19], [7, 19], [8, 19]]], arch: { c0: 7, r0: 22, w: 2, h: 2 }, rate: 5 },
          panel: { c0: 7, r0: 6, w: 2, h: 2 },
          archway: { c0: 11, r0: 5, w: 3, h: 3 }
        },
        {
          // blue brick (material B)
          cap: [21, 5],
          capVars: [[22, 5], [23, 5]],
          bodyRows: [[[21, 6], [22, 6], [25, 6]], [[21, 7], [22, 7], [25, 7]]],
          side: [[20, 6], [20, 7]],
          left: [20, 6],
          right: [20, 7],
          post: [20, 5],
          bot: [21, 5],
          south: { rows: [[[21, 18], [22, 18], [23, 18], [24, 18]], [[21, 19], [22, 19], [23, 19], [24, 19]]], arch: { c0: 24, r0: 22, w: 2, h: 2 }, rate: 5 },
          panel: { c0: 24, r0: 6, w: 2, h: 2 },
          archway: { c0: 28, r0: 5, w: 3, h: 3 }
        },
        {
          // pale weathered brick (material A2, the premade's lighter colourway)
          cap: [4, 30],
          capVars: [[5, 30], [7, 30], [8, 30]],
          bodyRows: [[[4, 31], [5, 31]], [[4, 32], [5, 32]]],
          side: [[3, 31], [3, 32]],
          left: [3, 31],
          right: [3, 32],
          post: [3, 30],
          bot: [4, 30],
          south: { rows: [[[4, 43], [5, 43], [8, 43]], [[4, 44], [5, 44], [8, 44]]] },
          panel: { c0: 7, r0: 31, w: 2, h: 2 },
          archway: { c0: 11, r0: 30, w: 3, h: 3 }
        }
      ]
    },
    pillar: { rects: [{ c0: 1, r0: 1, w: 1, h: 3 }, { c0: 18, r0: 1, w: 1, h: 3 }], minW: 8, minH: 6, sx: 4, sy: 3 },
    // free columns in big halls (tan / pale)
    wallDecor: {
      drips: [{ c0: 4, r0: 1, w: 1, h: 2 }, { c0: 6, r0: 1, w: 1, h: 2 }, { c0: 10, r0: 1, w: 1, h: 2 }, { c0: 16, r0: 1, w: 1, h: 2 }],
      // green/purple/grey slime
      dripRate: 7,
      pipes: { left: [41, 16], mid: [42, 16], right: [43, 16] },
      // capped pipe runs across upper faces
      outfall: { rects: [{ c0: 17, r0: 14, w: 2, h: 6 }], rate: 3 }
      // big goo-pouring outfall pipes
    },
    propsUrl: `${SEW}/Props/Props.png`,
    props: [{ c0: 48, r0: 6, w: 1, h: 2 }, { c0: 49, r0: 6, w: 1, h: 2 }, { c0: 48, r0: 1, w: 2, h: 2 }, { c0: 48, r0: 9, w: 1, h: 2 }],
    // barrels / crate / pot
    corners: [{ c0: 21, r0: 1, w: 2, h: 2 }, { c0: 30, r0: 1, w: 2, h: 2 }, { c0: 38, r0: 1, w: 2, h: 2 }, { c0: 21, r0: 6, w: 2, h: 2 }],
    // goo & dirt piles
    webs: { nw: { c0: 0, r0: 14, w: 2, h: 2 }, ne: { c0: 4, r0: 14, w: 2, h: 2 }, rate: 3 },
    cluster: { pieces: [{ c0: 48, r0: 1, w: 2, h: 2 }, { c0: 51, r0: 1, w: 2, h: 2 }, { c0: 48, r0: 6, w: 1, h: 2 }, { c0: 49, r0: 6, w: 1, h: 2 }, { c0: 48, r0: 9, w: 1, h: 2 }] },
    clutter: { rate: 12, tiles: [[27, 11], [37, 14], [38, 15], [39, 14], [39, 16], [40, 14], [48, 10], [56, 10], [38, 16], [40, 15]] },
    // puddles/bones/food bits
    waterProps: { url: `${SEW}/Props/Animated_Props/Floating_Props_Small.png`, frames: 8, rows: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], rate: 8 },
    // drifting debris
    features: [{ c0: 24, r0: 6, w: 3, h: 2 }, { c0: 42, r0: 6, w: 3, h: 2 }],
    // refuse heaps with scattered gear
    torch: { url: `${SEW}/Props/Animated_Props/Animated_Pipes.png`, frame: { c0: 0, r0: 4, w: 2, h: 4 }, frames: 8, stride: 2, glow: 5622903, spacing: 11 },
    // dripping pipe (sparse — the outfalls carry the wall)
    shadows: { tiles: `${SEW}/Tileset/Tileset_Shadows.png`, props: `${SEW}/Props/Prop_Shadows.png` }
    // per-tile shadow twins, stamped topmost
  },
  // Dwarven Workshop — rebuilt against the premade workshops' layer stack. Chamfered
  // (octagonal) rooms like the premade buildings; 4-tall walls = pale cap trim + 3 rows of
  // engraved rune-knot panels whose 2-column motif tiles continuously (bodyCycle), in the
  // sheet's THREE colourway bands (32-row pitch) so each room picks a colourway; hanging
  // south faces with the same knots; floor inlay decals (dark panel / X medallion); free
  // rune pillars; banner wall decor; anvil/stool/tool props with fine workshop clutter
  // (ingots, coals, tools); and the pack's real shadow sheets stamped on top.
  dwarven: {
    label: "Dwarven Workshop",
    url: `${DW}/Tileset/Tileset.png`,
    tile: 8,
    bg: "#14111a",
    chamfer: 2,
    // cut room corners → octagonal workshops
    floor: { ...flat([9, 58]), vars: [[19, 61]] },
    // patterned stone + sparse X-motif (premade ~1 in 9)
    inlays: { rects: [{ c0: 9, r0: 60, w: 3, h: 3 }, { c0: 13, r0: 58, w: 2, h: 2 }], rate: 2 },
    // dark panel / X medallion
    walls: {
      height: 4,
      sets: [
        {
          // grey colourway (middle band, rows 39-47) — 6-col cycle: knotA, pillar, knotB, pillar
          cap: [10, 39],
          capVars: [[11, 39], [13, 39], [14, 39]],
          bodyCycle: true,
          bodyRows: [
            [[9, 40], [10, 40], [11, 40], [12, 40], [13, 40], [14, 40]],
            [[9, 41], [10, 41], [11, 41], [12, 41], [13, 41], [14, 41]],
            [[9, 42], [10, 42], [11, 42], [12, 42], [13, 42], [14, 42]]
          ],
          side: [[9, 40], [9, 41], [9, 42], [9, 43]],
          left: [9, 41],
          right: [9, 41],
          post: [9, 39],
          bot: [10, 39],
          south: { rows: [[[9, 46], [10, 46], [11, 46], [12, 46], [13, 46], [14, 46]], [[9, 47], [10, 47], [11, 47], [12, 47], [13, 47], [14, 47]]] }
        },
        {
          // violet colourway (top band, -32 rows)
          cap: [10, 7],
          capVars: [[11, 7], [13, 7], [14, 7]],
          bodyCycle: true,
          bodyRows: [
            [[9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8]],
            [[9, 9], [10, 9], [11, 9], [12, 9], [13, 9], [14, 9]],
            [[9, 10], [10, 10], [11, 10], [12, 10], [13, 10], [14, 10]]
          ],
          side: [[9, 8], [9, 9], [9, 10], [9, 11]],
          left: [9, 9],
          right: [9, 9],
          post: [9, 7],
          bot: [10, 7],
          south: { rows: [[[9, 14], [10, 14], [11, 14], [12, 14], [13, 14], [14, 14]], [[9, 15], [10, 15], [11, 15], [12, 15], [13, 15], [14, 15]]] }
        },
        {
          // bronze colourway (bottom band, +32 rows)
          cap: [10, 71],
          capVars: [[11, 71], [13, 71], [14, 71]],
          bodyCycle: true,
          bodyRows: [
            [[9, 72], [10, 72], [11, 72], [12, 72], [13, 72], [14, 72]],
            [[9, 73], [10, 73], [11, 73], [12, 73], [13, 73], [14, 73]],
            [[9, 74], [10, 74], [11, 74], [12, 74], [13, 74], [14, 74]]
          ],
          side: [[9, 72], [9, 73], [9, 74], [9, 75]],
          left: [9, 73],
          right: [9, 73],
          post: [9, 71],
          bot: [10, 71],
          south: { rows: [[[9, 78], [10, 78], [11, 78], [12, 78], [13, 78], [14, 78]], [[9, 79], [10, 79], [11, 79], [12, 79], [13, 79], [14, 79]]] }
        }
      ]
    },
    pillar: { rects: [{ c0: 15, r0: 34, w: 1, h: 4 }], minW: 8, minH: 6, sx: 4, sy: 3 },
    // free rune pillars
    wallDecor: {
      drips: [{ c0: 12, r0: 13, w: 1, h: 3 }, { c0: 14, r0: 13, w: 1, h: 3 }],
      // hanging blue banners
      dripRate: 9
    },
    propsUrl: `${DW}/Props/Props.png`,
    props: [{ c0: 54, r0: 9, w: 2, h: 1 }, { c0: 58, r0: 9, w: 1, h: 1 }, { c0: 60, r0: 8, w: 1, h: 1 }, { c0: 62, r0: 8, w: 1, h: 1 }, { c0: 64, r0: 9, w: 1, h: 1 }],
    // anvil / stool / bucket / jug / basket
    clutter: { rate: 14, tiles: [[29, 11], [28, 17], [32, 17], [36, 20], [103, 2], [104, 4], [105, 5], [100, 3], [103, 18], [81, 16], [94, 7]] },
    // tools / ingots / coals
    features: [{ c0: 35, r0: 8, w: 3, h: 4 }, { c0: 46, r0: 7, w: 3, h: 3 }, { c0: 46, r0: 19, w: 3, h: 2 }],
    // curtained shelf / worktable / bench
    torch: { url: `${DW}/Props/Animated_Props/Torches/Torches.png`, frame: { c0: 1, r0: 1, w: 1, h: 2 }, frames: 8, stride: 3, glow: 16755268, spacing: 7 },
    shadows: { tiles: `${DW}/Tileset/Tileset_Shadows.png`, props: `${DW}/Props/Prop_Shadows.png` }
  }
};

// ../auto-battler/src/render/tileViewer.js
function createTileViewer(pixi, host, cfg) {
  const { skins, defaultSkin, sourcesFor, render: render3, fit: fit3 } = cfg;
  const { Application, Assets, Sprite, Container, Texture, Rectangle, Graphics } = pixi;
  let app = null, root = null, alive = true;
  let skinKey = defaultSkin;
  let seed = cfg.seed ?? 1;
  const sources = /* @__PURE__ */ new Map();
  const texCache = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  let lastBounds = null, lastTile = 8, lastSnapshot = {}, tick = null;
  function tex(source, c, r, tile) {
    const k = source.uid + ":" + c + "," + r;
    let t = texCache.get(k);
    if (!t) {
      t = new Texture({ source, frame: new Rectangle(c * tile, r * tile, tile, tile) });
      texCache.set(k, t);
    }
    return t;
  }
  async function ensureSource(url) {
    if (sources.has(url)) return sources.get(url);
    const a = await Assets.load(url);
    a.source.scaleMode = "nearest";
    sources.set(url, a.source);
    return a.source;
  }
  async function loadSources(skin) {
    for (const url of sourcesFor(skin)) {
      await ensureSource(url);
      if (!alive) return false;
    }
    return true;
  }
  const getSnapshot = () => ({ skin: skinKey, seed, ...lastSnapshot });
  const emit = () => listeners.forEach((fn) => fn(getSnapshot()));
  function redraw() {
    if (!app || !alive) return;
    if (tick) {
      try {
        app.ticker.remove(tick);
      } catch {
      }
      tick = null;
    }
    if (root) {
      root.destroy({ children: true });
      root = null;
    }
    root = new Container();
    app.stage.addChild(root);
    const skin = skins[skinKey];
    const TILE11 = skin.tile || 8;
    const res = render3({ app, root, skin, seed, TILE: TILE11, tex, sources, Sprite, Graphics, Container }) || {};
    lastBounds = res.bounds || null;
    lastTile = res.tile ?? TILE11;
    lastSnapshot = res.snapshot || {};
    if (res.tick) {
      tick = res.tick;
      app.ticker.add(tick);
    }
    if (lastBounds) fit3(app, root, lastBounds, lastTile);
  }
  const ready = (async () => {
    const a = new Application();
    await a.init({ background: skins[skinKey].bg, antialias: false, resizeTo: host });
    if (!alive) {
      a.destroy(true);
      return;
    }
    app = a;
    host.appendChild(app.canvas);
    if (!await loadSources(skins[skinKey])) return;
    redraw();
    emit();
    app.renderer.on("resize", () => {
      if (lastBounds) fit3(app, root, lastBounds, lastTile);
    });
  })();
  async function setSkin(k) {
    if (!skins[k] || k === skinKey) return;
    skinKey = k;
    if (!await loadSources(skins[k])) return;
    if (app) app.renderer.background.color = skins[k].bg;
    redraw();
    emit();
  }
  function regenerate(nextSeed) {
    seed = nextSeed >>> 0;
    redraw();
    emit();
  }
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function destroy() {
    alive = false;
    try {
      if (tick) app?.ticker?.remove(tick);
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
    sources.clear();
    texCache.clear();
  }
  return { ready, regenerate, setSkin, onChange, destroy, getSnapshot };
}

// ../auto-battler/src/render/interior.js
function createInteriorViewer(pixi, host, opts = {}) {
  return createTileViewer(pixi, host, {
    skins: INTERIOR_SKINS,
    defaultSkin: opts.skin || "orc",
    seed: opts.seed ?? 1,
    sourcesFor: (skin) => [
      skin.url,
      skin.propsUrl,
      skin.torch?.url,
      skin.water?.url,
      skin.waterProps?.url,
      skin.shadows?.tiles,
      skin.shadows?.props
    ].filter(Boolean),
    render,
    fit
  });
}
var pick = (pool, h2) => pool[h2 % pool.length];
function render({ root, skin, seed, TILE: TILE11, tex, sources, Sprite, Graphics }) {
  const src = sources.get(skin.url);
  const L = generateRooms(seed);
  const { W, H, floor, rooms, bounds } = L;
  if (skin.chamfer) for (const rm of rooms) {
    const ch = skin.chamfer;
    for (let i = 0; i < ch; i++) for (let j = 0; j < ch - i; j++) {
      for (const [cx, cy] of [[rm.x + i, rm.y + j], [rm.x + rm.w - 1 - i, rm.y + j], [rm.x + i, rm.y + rm.h - 1 - j], [rm.x + rm.w - 1 - i, rm.y + rm.h - 1 - j]]) {
        floor[cy * W + cx] = 0;
      }
    }
  }
  const isF = (x, y) => x >= 0 && y >= 0 && x < W && y < H && floor[y * W + x] === 1;
  const water = skin.water ? carveWater(skin, seed, L) : null;
  const isW = (x, y) => !!water && x >= 0 && y >= 0 && x < W && y < H && water.mask[y * W + x] === 1;
  const isWalk = (x, y) => isF(x, y) && !isW(x, y);
  const twin = /* @__PURE__ */ new Map();
  if (skin.shadows?.tiles) twin.set(src, sources.get(skin.shadows.tiles));
  if (skin.shadows?.props && skin.propsUrl) twin.set(sources.get(skin.propsUrl), sources.get(skin.shadows.props));
  const c = {
    skin,
    TILE: TILE11,
    W,
    H,
    rooms,
    seed,
    isF,
    isW,
    isWalk,
    water,
    root,
    sources,
    Graphics,
    tex,
    Sprite,
    blocked: /* @__PURE__ */ new Set(),
    decor: /* @__PURE__ */ new Set(),
    shadowQueue: [],
    shadowOn: false,
    twin,
    addS: null,
    add: null,
    stamp: null,
    waterSprites: [],
    floatSprites: []
  };
  c.addS = (source, coord, x, y) => {
    const sp = new Sprite(tex(source, coord[0], coord[1], TILE11));
    sp.x = x * TILE11;
    sp.y = y * TILE11;
    root.addChild(sp);
    const tw = c.shadowOn && twin.get(source);
    if (tw) c.shadowQueue.push([tw, coord[0], coord[1], x, y]);
    return sp;
  };
  c.add = (coord, x, y) => c.addS(src, coord, x, y);
  c.stamp = (source, r, x, y) => {
    for (let ry = 0; ry < (r.h || 1); ry++) for (let rx = 0; rx < (r.w || 1); rx++) c.addS(source, [r.c0 + rx, r.r0 + ry], x + rx, y + ry);
  };
  drawWater(c);
  c.shadowOn = true;
  drawWalls(c);
  c.shadowOn = false;
  drawFloor(c);
  drawInlays(c);
  c.shadowOn = true;
  drawDoorways(c);
  drawBridges(c);
  drawPillars(c);
  drawWallDecor(c);
  c.shadowOn = false;
  if (!skin.shadows) drawShadows(c);
  c.shadowOn = true;
  drawProps(c);
  c.shadowOn = false;
  const torch = drawTorches(c);
  drawShadowSheets(c);
  if (torch.glowG) root.addChild(torch.glowG);
  let animPhase = 0;
  const WB = skin.water?.block || 5;
  const tick = torch.flames.length || c.waterSprites.length ? (ticker) => {
    animPhase += 0.14 * ticker.deltaTime;
    if (torch.flames.length && torch.flameSrc) {
      const fi = Math.floor(animPhase) % torch.flameFrames;
      for (const fl of torch.flames) fl.sp.texture = tex(torch.flameSrc, fl.col0 + torch.flameStride * fi, fl.row, TILE11);
    }
    if (torch.glowG) torch.glowG.alpha = 0.78 + 0.22 * Math.sin(animPhase * 0.9);
    if (c.waterSprites.length) {
      const wf = Math.floor(animPhase * 0.6) % (skin.water.frames || 4);
      for (const ws of c.waterSprites) ws.sp.texture = tex(ws.src, ws.c + wf * WB, ws.r, TILE11);
      for (const fs of c.floatSprites) fs.sp.texture = tex(fs.src, (fs.f0 + Math.floor(animPhase * 0.6)) % fs.frames, fs.row, TILE11);
    }
  } : null;
  return { bounds, tile: TILE11, snapshot: { rooms: rooms.length }, tick };
}
function fit(app, root, b, TILE11) {
  const sw = app.screen.width, sh = app.screen.height;
  const cw = (b.x1 - b.x0 + 3) * TILE11, ch = (b.y1 - b.y0 + 4) * TILE11;
  const s = Math.max(1, Math.floor(Math.min(sw / cw, sh / ch)));
  root.scale.set(s);
  root.x = Math.round((sw - cw * s) / 2 - (b.x0 - 1) * TILE11 * s);
  root.y = Math.round((sh - ch * s) / 2 - (b.y0 - 2) * TILE11 * s);
}
function carveWater(skin, seed, L) {
  const { W, H, floor, rooms } = L;
  const SW2 = skin.water;
  const mask = new Uint8Array(W * H), bridge = new Uint8Array(W * H);
  const isF = (x, y) => x >= 0 && y >= 0 && x < W && y < H && floor[y * W + x] === 1;
  const inRoom = (x, y) => rooms.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  const corr = (x, y) => isF(x, y) && !inRoom(x, y);
  const setF = (x, y) => {
    if (x >= 0 && y >= 0 && x < W && y < H && !floor[y * W + x]) floor[y * W + x] = 1;
  };
  const minRun = SW2.minRun || 6;
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W; x++) {
      if (!(corr(x, y) && corr(x, y + 1))) continue;
      let x12 = x;
      while (corr(x12 + 1, y) && corr(x12 + 1, y + 1)) x12++;
      if (x12 - x + 1 >= minRun && hashU32(seed ^ 43442, x, y) % 3 !== 0) {
        for (let i = x + 1; i < x12; i++) {
          const cross = corr(i, y - 1) && corr(i, y + 2);
          for (const yy of [y, y + 1]) {
            if (cross && !mask[yy * W + i]) bridge[yy * W + i] = 1;
            else {
              mask[yy * W + i] = 1;
              bridge[yy * W + i] = 0;
            }
          }
          setF(i, y - 1);
          setF(i, y + 2);
        }
      }
      x = x12 + 1;
    }
  }
  for (let x = 0; x < W - 1; x++) {
    for (let y = 0; y < H; y++) {
      if (!(corr(x, y) && corr(x + 1, y))) continue;
      let y12 = y;
      while (corr(x, y12 + 1) && corr(x + 1, y12 + 1)) y12++;
      if (y12 - y + 1 >= minRun && hashU32(seed ^ 43443, x, y) % 3 !== 0) {
        for (let i = y + 1; i < y12; i++) {
          const cross = corr(x - 1, i) && corr(x + 2, i);
          for (const xx of [x, x + 1]) {
            if (mask[i * W + xx]) continue;
            if (cross && !bridge[i * W + xx]) bridge[i * W + xx] = 2;
            else if (!bridge[i * W + xx]) mask[i * W + xx] = 1;
          }
          setF(x - 1, i);
          setF(x + 2, i);
        }
      }
      y = y12 + 1;
    }
  }
  if (SW2.moat !== false) {
    const big = [...rooms].sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (big && big.w >= 12 && big.h >= 10) {
      for (let dy = 2; dy < big.h - 2; dy++) for (let dx = 2; dx < big.w - 2; dx++) {
        const ring2 = dx <= 3 || dx >= big.w - 4 || dy <= 3 || dy >= big.h - 4;
        if (ring2) mask[(big.y + dy) * W + (big.x + dx)] = 1;
      }
      const gx = big.x + (big.w >> 1);
      for (const x of [gx, gx + 1]) for (const dy of [2, 3]) {
        mask[(big.y + dy) * W + x] = 0;
        bridge[(big.y + dy) * W + x] = 1;
      }
    } else if (big && big.w >= 9 && big.h >= 7) {
      const pw = Math.min(big.w - 6, 5), ph = Math.min(big.h - 5, 4);
      const px = big.x + (big.w - pw >> 1), py = big.y + (big.h - ph >> 1);
      for (let dy = 0; dy < ph; dy++) for (let dx = 0; dx < pw; dx++) mask[(py + dy) * W + (px + dx)] = 1;
    }
  }
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (floor[y * W + x]) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  L.bounds.x0 = x0;
  L.bounds.y0 = y0;
  L.bounds.x1 = x1;
  L.bounds.y1 = y1;
  return { mask, bridge };
}
function drawWater(c) {
  const { skin, W, H, isW, sources } = c;
  if (!c.water) return;
  const SW2 = skin.water, wsrc = sources.get(SW2.url);
  const [ic, ir] = SW2.inner || [1, 1];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!isW(x, y)) continue;
    const dx = !isW(x - 1, y) ? 0 : !isW(x + 1, y) ? 2 : 1;
    const dy = !isW(x, y - 1) ? 0 : !isW(x, y + 1) ? 2 : 1;
    const sp = c.addS(wsrc, [ic + dx, ir + dy], x, y);
    c.waterSprites.push({ sp, src: wsrc, c: ic + dx, r: ir + dy });
    const FP3 = skin.waterProps;
    if (FP3 && dx === 1 && dy === 1) {
      const h2 = hashU32(c.seed ^ 61706, x, y);
      if (h2 % (FP3.rate || 9) === 0) {
        const row = FP3.rows[(h2 >>> 5) % FP3.rows.length];
        const fsrc = sources.get(FP3.url);
        c.floatSprites.push({ sp: c.addS(fsrc, [0, row], x, y), src: fsrc, row, f0: h2 >>> 9 & 7, frames: FP3.frames || 8 });
      }
    }
  }
}
function drawWalls(c) {
  if (c.skin.wall && !c.skin.walls) drawBackWall(c);
  if (c.skin.walls) drawEnclosure(c);
}
function drawBackWall(c) {
  const { skin, W, H, isF, add } = c;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!isF(x, y) || isF(x, y - 1)) continue;
    if (skin.wall.face) add(skin.wall.face, x, y - 1);
    if (skin.wall.cap) add(skin.wall.cap, x, y - 2);
  }
}
function drawEnclosure(c) {
  const { skin, W, H, rooms, seed, isF, isW, add } = c;
  const WS = skin.walls;
  const Hh = WS.height || 3;
  const sets = WS.sets || [WS];
  const roomMat = rooms.map((rm) => sets.length > 1 ? hashU32(seed ^ 15386, rm.x, rm.y) % sets.length : 0);
  const matAt = (fx, fy) => {
    for (let i = 0; i < rooms.length; i++) {
      const r = rooms[i];
      if (fx >= r.x && fx < r.x + r.w && fy >= r.y && fy < r.y + r.h) return roomMat[i];
    }
    return 0;
  };
  const brick = (S, bx, by) => {
    if (!S.bodyVars || !S.bodyVars.length) return S.body;
    const h2 = hashU32(seed ^ 23057, bx, by);
    return h2 % 4 === 0 ? S.bodyVars[(h2 >>> 5) % S.bodyVars.length] : S.body;
  };
  if (WS.style === "directional") {
    const t = (S, col, row) => [S.cols[col], row];
    const winRoll = (x, y) => hashU32(seed ^ 30627, x, y) % 5 === 0;
    const northCol = (S, x, y, col) => {
      if (S.window && col === 1 && winRoll(x, y) && !isF(x, y - 1)) {
        add(S.window.bot, x, y);
        add(S.window.top, x, y - 1);
        return;
      }
      add(t(S, col, S.rows.nFace), x, y);
      if (!isF(x, y - 1)) add(t(S, col, S.rows.nCap), x, y - 1);
    };
    const southCol = (S, x, y, col) => {
      add(t(S, col, S.rows.sTop), x, y);
      if (!isF(x, y + 1)) add(t(S, col, S.rows.sFringe), x, y + 1);
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (isF(x, y)) continue;
      const fN = isF(x, y - 1), fE = isF(x + 1, y), fS = isF(x, y + 1), fW = isF(x - 1, y);
      if (fS) northCol(sets[matAt(x, y + 1)], x, y, 1);
      else if (fN) southCol(sets[matAt(x, y - 1)], x, y, 1);
      else if (fE) add(t(sets[matAt(x + 1, y)], 0, sets[matAt(x + 1, y)].rows.body), x, y);
      else if (fW) add(t(sets[matAt(x - 1, y)], 2, sets[matAt(x - 1, y)].rows.body), x, y);
      else if (isF(x + 1, y + 1)) northCol(sets[matAt(x + 1, y + 1)], x, y, 0);
      else if (isF(x - 1, y + 1)) northCol(sets[matAt(x - 1, y + 1)], x, y, 2);
      else if (isF(x + 1, y - 1)) southCol(sets[matAt(x + 1, y - 1)], x, y, 0);
      else if (isF(x - 1, y - 1)) southCol(sets[matAt(x - 1, y - 1)], x, y, 2);
    }
  } else {
    const capOf = (S, x, y) => S.capVars?.length && hashU32(seed ^ 3241, x, y) % 3 ? pick(S.capVars, hashU32(seed ^ 3241, x, y) >>> 4) : S.cap;
    const rowBrick = (S, k, x, yy) => {
      if (!S.bodyRows) return brick(S, x, yy);
      const pool = S.bodyRows[Math.max(0, Math.min(S.bodyRows.length - 1, Hh - 2 - k))];
      return S.bodyCycle ? pool[x % pool.length] : pick(pool, hashU32(seed ^ 23057, x, yy) >>> 3);
    };
    const tall = (S, x, yBase, capTile, bodyTile, allowWindow) => {
      const win = allowWindow && S.window && Hh >= 2 && hashU32(seed ^ 30627, x, yBase) % 5 === 0 && !isF(x, yBase - (Hh - 1));
      for (let k = 0; k < Hh; k++) {
        const yy = yBase - k;
        if (yy < 0 || isF(x, yy)) break;
        let tt;
        if (win && k === Hh - 1) tt = S.window.top;
        else if (win && k === Hh - 2) tt = S.window.bot;
        else tt = k === Hh - 1 ? capTile : bodyTile || rowBrick(S, k, x, yy);
        add(tt, x, yy);
      }
    };
    const sideT = (S, fallback, x, y) => S.side?.length ? pick(S.side, hashU32(seed ^ 20958, x, y)) : fallback;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (isF(x, y)) continue;
      const fN = isF(x, y - 1), fE = isF(x + 1, y), fS = isF(x, y + 1), fW = isF(x - 1, y);
      if (fS) {
        const S = sets[matAt(x, y + 1)];
        const lone = S.bodyCycle && !(isF(x - 1, y + 1) && !isF(x - 1, y)) && !(isF(x + 1, y + 1) && !isF(x + 1, y));
        tall(S, x, y, lone ? S.post : capOf(S, x, y), lone ? S.post : null, !lone);
      } else if (WS.backOnly) continue;
      else if (fN) {
        const S = sets[matAt(x, y - 1)];
        if (S.south) {
          add(capOf(S, x, y), x, y);
          for (let k = 0; k < S.south.rows.length; k++) {
            if (isF(x, y + 1 + k)) break;
            const row = S.south.rows[k];
            add(S.bodyCycle ? row[x % row.length] : pick(row, hashU32(seed ^ 1295, x, y + k) >>> 2), x, y + 1 + k);
          }
        } else add(S.bot, x, y);
      } else if (fE) add(sideT(sets[matAt(x + 1, y)], sets[matAt(x + 1, y)].left, x, y), x, y);
      else if (fW) add(sideT(sets[matAt(x - 1, y)], sets[matAt(x - 1, y)].right, x, y), x, y);
      else if (isF(x + 1, y + 1)) {
        const S = sets[matAt(x + 1, y + 1)];
        tall(S, x, y, S.post, S.left);
      } else if (isF(x - 1, y + 1)) {
        const S = sets[matAt(x - 1, y + 1)];
        tall(S, x, y, S.post, S.right);
      } else if (isF(x + 1, y - 1)) add(sets[matAt(x + 1, y - 1)].post, x, y);
      else if (isF(x - 1, y - 1)) add(sets[matAt(x - 1, y - 1)].post, x, y);
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W - 1; x++) {
      const S = sets[matAt(x, y - 1)];
      if (!S.south?.arch || isF(x, y) || !isF(x, y - 1) || isF(x + 1, y) || !isF(x + 1, y - 1)) continue;
      if (isF(x, y + 1) || isF(x, y + 2) || isF(x + 1, y + 1) || isF(x + 1, y + 2)) continue;
      if (hashU32(seed ^ 42948, x, y) % (S.south.rate || 5) === 0) {
        c.stamp(c.sources.get(c.skin.url), S.south.arch, x, y + 1);
        x++;
      }
    }
    if (c.water) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!c.isW(x, y) || isF(x, y - 1) || !c.isW(x, y + 1)) continue;
      const S = sets[matAt(x, y)];
      if (!S.archway) continue;
      const ax = x - (S.archway.w - 1 >> 1);
      c.stamp(c.sources.get(c.skin.url), S.archway, ax, y - S.archway.h);
      for (let i = 0; i < S.archway.w; i++) c.decor.add(ax + i + "," + (y - 1));
    }
    if (Hh >= 3) for (let y = 0; y < H; y++) for (let x = 0; x < W - 1; x++) {
      const S = sets[matAt(x, y + 1)];
      if (!S.panel || !isF(x, y + 1) || !isF(x + 1, y + 1) || isF(x, y) || isF(x + 1, y) || isF(x, y - 1) || isF(x + 1, y - 1)) continue;
      if (matAt(x + 1, y + 1) !== matAt(x, y + 1)) continue;
      if (c.decor.has(x + "," + y) || c.decor.has(x + 1 + "," + y)) continue;
      if (hashU32(seed ^ 2529, x, y) % (S.panelRate || 6) === 0) {
        c.stamp(c.sources.get(c.skin.url), S.panel, x, y - ((S.panel.h || 2) - 1));
        c.decor.add(x + "," + y);
        c.decor.add(x + 1 + "," + y);
        x++;
      }
    }
  }
}
function drawDoorways(c) {
  const { skin, W, H, isF } = c;
  const D = skin.doorway;
  if (!D) return;
  const src = c.sources.get(skin.url);
  for (let y = 1; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    if (!isF(x, y) || !isF(x + 1, y)) continue;
    if (isF(x - 1, y) || isF(x + 2, y)) continue;
    if (!(isF(x, y + 1) && isF(x + 1, y + 1) && (isF(x - 1, y + 1) || isF(x + 2, y + 1)))) continue;
    if (!isF(x, y - 1) || !isF(x + 1, y - 1)) continue;
    c.stamp(src, D.rect, x - ((D.rect.w || 1) - 2 >> 1), y - ((D.rect.h || 1) - 1));
  }
}
function drawFloor(c) {
  const { skin, W, H, seed, isF, isW, add } = c;
  const F = skin.floor;
  const B = skin.water?.banks;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!isF(x, y) || isW(x, y)) continue;
    const h2 = hashU32(seed ^ 496, x, y);
    let t = null;
    if (B && (isW(x, y + 1) || isW(x, y - 1) || isW(x + 1, y) || isW(x - 1, y))) {
      const poolKey = isW(x, y + 1) ? "s" : isW(x, y - 1) ? "n" : isW(x + 1, y) ? "e" : "w";
      t = pick(B[poolKey], h2 >>> 3);
    } else {
      const n = !isF(x, y - 1), e = !isF(x + 1, y), s = !isF(x, y + 1), w = !isF(x - 1, y);
      if (n || e || s || w) t = nineSlice(F, n, s, w, e);
      else if (F.mix) t = F.mix.mossy && h2 % 7 === 0 ? pick(F.mix.mossy, h2 >>> 6) : pick(F.mix.pool, h2 >>> 4);
      else t = F.vars && F.vars.length && h2 % 7 === 0 ? F.vars[(h2 >>> 5) % F.vars.length] : F.c;
    }
    add(t, x, y);
  }
}
function drawInlays(c) {
  const { skin, rooms, seed, isWalk, sources } = c;
  if (!skin.inlays?.rects?.length) return;
  const src = sources.get(skin.url);
  for (const rm of rooms) {
    if (rm.w < 5 || rm.h < 5 || hashU32(seed ^ 5914, rm.x, rm.y) % (skin.inlays.rate || 2)) continue;
    const R = pick(skin.inlays.rects, hashU32(seed ^ 5915, rm.y, rm.w));
    const ix = rm.x + 1 + hashU32(seed ^ 5916, rm.x, rm.h) % Math.max(1, rm.w - 2 - R.w);
    const iy = rm.y + 1 + hashU32(seed ^ 5917, rm.w, rm.y) % Math.max(1, rm.h - 2 - R.h);
    let ok = true;
    for (let ry = 0; ry < R.h; ry++) for (let rx = 0; rx < R.w; rx++) if (!isWalk(ix + rx, iy + ry)) ok = false;
    if (ok) c.stamp(src, R, ix, iy);
  }
}
function drawBridges(c) {
  const { skin, W, H, water, isW, sources, TILE: TILE11 } = c;
  const BR = skin.bridges;
  if (!water || !BR) return;
  const src = sources.get(skin.url);
  const bAt = (x, y) => x >= 0 && y >= 0 && x < W && y < H ? water.bridge[y * W + x] : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const b = bAt(x, y);
    if (!b) continue;
    c.blocked.add(x + "," + y);
    if (b === 1 && BR.v) {
      const V = BR.v;
      for (const [wx, col] of [[x - 1, V.left], [x + 1, V.right]]) {
        if (!isW(wx, y)) continue;
        const top = bAt(x, y - 1) === 1, bot = bAt(x, y + 1) === 1;
        c.add([col, top ? V.mid[hashU32(c.seed, x, y) % V.mid.length] : V.top], x, y - (top ? 0 : 1));
        c.add([col, V.mid[(x + y) % V.mid.length]], x, y);
        if (!bot) c.add([col, V.bot], x, y + 1);
      }
    } else if (b === 2 && BR.h && bAt(x - 1, y) !== 2) {
      let x1 = x;
      while (bAt(x1 + 1, y) === 2) x1++;
      const len = x1 - x + 1;
      const R = len <= 2 || !BR.h.long ? BR.h.short : BR.h.long;
      for (const [yy, off] of [[y - 1, 4], [y + 1, -4]]) {
        if (isW(x, yy) || isW(x1, yy) || bAt(x, yy) === 2) continue;
        for (let ry = 0; ry < R.h; ry++) for (let rx = 0; rx < R.w; rx++) {
          const sp = c.addS(src, [R.c0 + rx, R.r0 + ry], x - 1 + rx, yy - 1 + ry);
          sp.y += off;
        }
      }
    }
  }
}
function drawPillars(c) {
  const { skin, rooms, seed, isW, isWalk, sources } = c;
  const P = skin.pillar;
  if (!P) return;
  const src = sources.get(skin.url);
  for (const rm of rooms) {
    if (rm.w < (P.minW || 8) || rm.h < (P.minH || 6)) continue;
    for (let y = rm.y + 2; y < rm.y + rm.h - 2; y += P.sy || 3) for (let x = rm.x + 2; x < rm.x + rm.w - 2; x += P.sx || 4) {
      if (hashU32(seed ^ 37137, x, y) % 3 === 0) continue;
      const R = P.rects ? pick(P.rects, hashU32(seed ^ 37138, x, y)) : P.rect;
      const bw = R.w || 1;
      let ok = true;
      for (let i = 0; i < bw; i++) {
        if (!isWalk(x + i, y) || c.blocked.has(x + i + "," + y)) ok = false;
        else if (isW(x + i - 1, y) || isW(x + i + 1, y) || isW(x + i, y - 1) || isW(x + i, y + 1)) ok = false;
      }
      if (!ok) continue;
      c.stamp(src, R, x, y - ((R.h || 1) - 1));
      for (let i = 0; i < bw; i++) c.blocked.add(x + i + "," + y);
    }
  }
}
function drawWallDecor(c) {
  const { skin, W, H, seed, isF, sources } = c;
  const D = skin.wallDecor;
  if (!D) return;
  const psrc = sources.get(skin.propsUrl || skin.url);
  const faceFree = (x, y) => isF(x, y + 1) && !isF(x, y) && !c.decor.has(x + "," + y);
  if (D.outfall) for (const rm of c.rooms) {
    if (rm.w < 7 || hashU32(seed ^ 64017, rm.x, rm.y) % (D.outfall.rate || 2)) continue;
    const R = pick(D.outfall.rects, hashU32(seed ^ 64018, rm.y, rm.x));
    const x = rm.x + 2 + hashU32(seed ^ 64019, rm.x, rm.y) % Math.max(1, rm.w - 4 - (R.w || 1));
    let ok = true;
    for (let i = 0; i < (R.w || 1); i++) if (!faceFree(x + i, rm.y - 1)) ok = false;
    if (!ok) continue;
    c.stamp(psrc, R, x, rm.y - (R.h || 1) + 1);
    for (let i = 0; i < (R.w || 1); i++) {
      c.decor.add(x + i + "," + (rm.y - 1));
      c.blocked.add(x + i + "," + rm.y);
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!faceFree(x, y)) continue;
    const h2 = hashU32(seed ^ 3361, x, y);
    if (D.pipes && h2 % 11 === 0) {
      const len = 2 + (h2 >>> 4) % 3;
      let ok = x + len <= W;
      for (let i = 0; ok && i < len; i++) ok = faceFree(x + i, y) && !isF(x + i, y - 1);
      if (ok) {
        for (let i = 0; i < len; i++) {
          c.add(i === 0 ? D.pipes.left : i === len - 1 ? D.pipes.right : D.pipes.mid, x + i, y - 1);
          c.decor.add(x + i + "," + y);
        }
        x += len;
        continue;
      }
    }
    if (D.drips && h2 % (D.dripRate || 7) === 0) {
      const R = pick(D.drips, h2 >>> 5);
      if (!isF(x, y - ((R.h || 1) - 1))) {
        c.stamp(psrc, R, x, y - ((R.h || 1) - 1));
        c.decor.add(x + "," + y);
      }
    }
  }
}
function drawShadows(c) {
  const { W, H, TILE: TILE11, isF, root, Graphics } = c;
  const shade = new Graphics();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!isF(x, y)) continue;
    if (!isF(x, y - 1)) {
      shade.rect(x * TILE11, y * TILE11, TILE11, TILE11).fill({ color: 0, alpha: 0.3 });
      if (isF(x, y + 1)) shade.rect(x * TILE11, (y + 1) * TILE11, TILE11, TILE11).fill({ color: 0, alpha: 0.12 });
    } else if (!isF(x - 1, y) || !isF(x + 1, y)) {
      shade.rect(x * TILE11, y * TILE11, TILE11, TILE11).fill({ color: 0, alpha: 0.12 });
    }
  }
  root.addChild(shade);
}
function drawProps(c) {
  const { skin, seed, rooms, sources, isWalk, isF, W, H } = c;
  const propSrc = sources.get(skin.propsUrl || skin.url);
  if (!propSrc) return;
  const free = (x, y, w = 1, h2 = 1) => {
    for (let ry = 0; ry < h2; ry++) for (let rx = 0; rx < w; rx++) {
      if (!isWalk(x + rx, y + ry) || c.blocked.has(x + rx + "," + (y + ry))) return false;
    }
    return true;
  };
  const claim = (x, y, w = 1, h2 = 1) => {
    for (let ry = 0; ry < h2; ry++) for (let rx = 0; rx < w; rx++) c.blocked.add(x + rx + "," + (y + ry));
  };
  const feats = skin.features || [];
  if (feats.length && rooms.length) {
    const byArea = [...rooms].sort((a, b) => b.w * b.h - a.w * a.h);
    let fi = 0;
    for (const big of byArea) {
      if (fi >= feats.length) break;
      const f = feats[(seed + fi) % feats.length];
      if (f.w <= big.w - 2 && f.h <= big.h - 2) {
        const fx = big.x + (big.w - f.w >> 1), fy = big.y + 1;
        if (free(fx, fy, f.w, f.h)) {
          c.stamp(propSrc, f, fx, fy);
          claim(fx, fy, f.w, f.h);
          fi++;
        }
      }
    }
  }
  if (skin.cluster?.pieces?.length && rooms.length > 2) {
    const small = [...rooms].sort((a, b) => a.w * a.h - b.w * b.h)[0];
    let px = small.x + 1, py = small.y + 1;
    for (let i = 0, n = 3 + seed % 3; i < n; i++) {
      const R = pick(skin.cluster.pieces, hashU32(seed ^ 49573, i, small.x));
      if (px + (R.w || 1) > small.x + small.w - 1) {
        px = small.x + 1;
        py += 2;
      }
      if (py + (R.h || 1) > small.y + small.h - 1) break;
      if (free(px, py, R.w || 1, R.h || 1)) {
        c.stamp(propSrc, R, px, py);
        claim(px, py, R.w || 1, R.h || 1);
      }
      px += R.w || 1;
    }
  }
  if (skin.corners?.length) for (const rm of rooms) {
    for (const [cx, cy] of [[rm.x, rm.y], [rm.x + rm.w - 2, rm.y], [rm.x, rm.y + rm.h - 2], [rm.x + rm.w - 2, rm.y + rm.h - 2]]) {
      const h2 = hashU32(seed ^ 49230, cx, cy);
      if (h2 % 2 || !free(cx, cy, 2, 2)) continue;
      const R = pick(skin.corners, h2 >>> 4);
      c.stamp(propSrc, R, cx, cy);
      claim(cx, cy, R.w || 1, R.h || 1);
    }
  }
  if (skin.webs) for (const rm of rooms) {
    const h2 = hashU32(seed ^ 1003, rm.x, rm.y);
    if (skin.webs.nw && h2 % (skin.webs.rate || 3) === 0 && isF(rm.x, rm.y)) c.stamp(propSrc, skin.webs.nw, rm.x, rm.y - 1);
    if (skin.webs.ne && (h2 >>> 6) % (skin.webs.rate || 3) === 0 && isF(rm.x + rm.w - 2, rm.y)) c.stamp(propSrc, skin.webs.ne, rm.x + rm.w - 2, rm.y - 1);
  }
  if (skin.props && skin.props.length) for (const rm of rooms) {
    const ring2 = [];
    for (let x = rm.x + 1; x < rm.x + rm.w - 1; x++) {
      ring2.push([x, rm.y + 1]);
      ring2.push([x, rm.y + rm.h - 2]);
    }
    for (let y = rm.y + 2; y < rm.y + rm.h - 2; y++) {
      ring2.push([rm.x + 1, y]);
      ring2.push([rm.x + rm.w - 2, y]);
    }
    let placed = 0;
    for (const [x, y] of ring2) {
      if (placed >= 3) break;
      const hh = hashU32(seed ^ 39692, x, y);
      if (hh % 7 !== 0) continue;
      const pr = skin.props[(hh >>> 5) % skin.props.length];
      const pw = pr.w || 1, ph = pr.h || 1;
      if (x + pw > rm.x + rm.w - 1 || y + ph > rm.y + rm.h - 1) continue;
      if (!free(x, y, pw, ph)) continue;
      c.stamp(propSrc, pr, x, y);
      claim(x, y, pw, ph);
      placed++;
    }
  }
  if (skin.clutter?.tiles?.length) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!free(x, y)) continue;
    const h2 = hashU32(seed ^ 49479, x, y);
    if (h2 % (skin.clutter.rate || 12) === 0) c.addS(propSrc, pick(skin.clutter.tiles, h2 >>> 7), x, y);
  }
}
function drawTorches(c) {
  const { skin, W, H, TILE: TILE11, isF, sources, root, Graphics, addS } = c;
  const torch = skin.torch, torchSrc = torch && sources.get(torch.url);
  if (!(torch && torchSrc)) return { flames: [], glowG: null, flameSrc: null, flameStride: 1, flameFrames: 1 };
  const flames = [];
  const glow = new Graphics();
  const f = torch.frame, spots = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!isF(x, y) || isF(x, y - 1) || c.decor.has(x + "," + (y - 1))) continue;
    if (hashU32(c.seed ^ 28868, x, y) % (torch.spacing || 5) !== 0) continue;
    const cx = (x + f.w / 2) * TILE11, cy = (y - 1) * TILE11;
    for (const [r, a] of [[3.2, 0.05], [2.1, 0.08], [1.2, 0.13]]) glow.circle(cx, cy, r * TILE11).fill({ color: torch.glow, alpha: a });
    spots.push([x, y]);
  }
  root.addChild(glow);
  for (const [x, y] of spots) for (let ry = 0; ry < f.h; ry++) for (let rx = 0; rx < f.w; rx++) {
    const sp = addS(torchSrc, [f.c0 + rx, f.r0 + ry], x + rx, y - 2 + ry);
    flames.push({ sp, col0: f.c0 + rx, row: f.r0 + ry });
  }
  return { flames, glowG: glow, flameSrc: torchSrc, flameStride: torch.stride || 1, flameFrames: torch.frames || 1 };
}
function drawShadowSheets(c) {
  const { root, TILE: TILE11, tex, Sprite } = c;
  for (const [src, tc, tr, x, y] of c.shadowQueue) {
    const sp = new Sprite(tex(src, tc, tr, TILE11));
    sp.x = x * TILE11;
    sp.y = y * TILE11;
    sp.alpha = 0.8;
    root.addChild(sp);
  }
}

// ../auto-battler/src/engine/towerGen.js
function generateTower(seed, opts = {}) {
  const { rnd: rnd2, ri } = makeGenRng(seed);
  let roof = opts.roof;
  if (!roof) {
    const rr = rnd2();
    roof = rr < 0.15 ? "none" : rr < 0.45 ? "battlement" : "pyramid";
  }
  const baseW = opts.w ?? opts.baseW ?? 4;
  const spriteRoof = roof === "pyramid" || roof === "battlement" && !opts.hasParapet;
  const w = spriteRoof ? baseW : Math.max(3, baseW + ri(-1, 2));
  const h2 = opts.h ?? (roof === "none" ? ri(3, 6) : ri(6, 12));
  const hasDoor = rnd2() < (roof === "none" ? 0.4 : 0.9);
  const winH = opts.winH ?? 2, doorH = opts.doorH ?? 2;
  const windows = [];
  for (let y = 1; y + winH <= h2 - doorH - 1; y += winH + 1) if (rnd2() < 0.6) windows.push(y);
  return { w, h: h2, roof, windows, hasDoor };
}

// ../auto-battler/src/render/towerSkins.js
var ROOT = "/assets/minifantasy/Minifantasy_Towers_v1.0/Towers";
var MEADOW = `${ROOT}/Meadow_Towers/Tileset.png`;
var DESERT2 = `${ROOT}/Desert_Towers/Tileset.png`;
var SWAMP = `${ROOT}/Swamp_Towers/Tileset.png`;
var WALL2 = {
  nw: [6, 40],
  n: [7, 40],
  ne: [8, 40],
  w: [6, 41],
  c: [7, 41],
  e: [8, 41],
  sw: [6, 42],
  s: [7, 42],
  se: [8, 42]
};
var DESERT_WALL = {
  nw: [16, 32],
  n: [17, 32],
  ne: [18, 32],
  w: [16, 34],
  c: [17, 34],
  e: [18, 34],
  sw: [16, 37],
  s: [17, 37],
  se: [18, 37]
};
var TOWER_SKINS = {
  meadow: {
    label: "Meadow",
    url: MEADOW,
    tile: 8,
    bg: "#16210f",
    wall: WALL2,
    roof: { c0: 4, r0: 2, w: 8, h: 8 },
    window: { c0: 17, r0: 45, w: 2, h: 2 },
    door: { c0: 17, r0: 49, w: 3, h: 2 },
    // Assembled rooftop crown (matches the premade tower): a 5-wide shaft topped by a
    // wooden balustrade railing, with the blue crystal pyramid roof for the 'pyramid'
    // variant. `dy` = each piece's top row relative to the shaft top (y=0, negative = up).
    // Pieces are fixed-size cross/roof art from the tileset, blitted centred on the shaft.
    crown: {
      shaftW: 5,
      platform: { c0: 4, r0: 27, w: 7, h: 8, dy: -8 },
      // grey stone rooftop floor (cross)
      rail: { c0: 13, r0: 12, w: 7, h: 8, dy: -8 },
      // wooden balustrade on the platform edge
      roof: { c0: 3, r0: 1, w: 9, h: 11, dy: -16 }
      // blue crystal pyramid above
    },
    // Alternate brick fills sprinkled into the shaft interior for weathering (Meadow only;
    // these coords are different art on the other variant sheets).
    fillVars: [[5, 49], [9, 49]]
  },
  desert: {
    label: "Desert",
    url: DESERT2,
    tile: 8,
    bg: "#241d10",
    wall: DESERT_WALL,
    // Teal dome (sphere + orange lip = cols 3–9 / rows 2–9; rows 10+ are the cylinder drum,
    // not the dome). Cylindrical-tower door/window openings.
    roof: { c0: 3, r0: 2, w: 7, h: 8 },
    window: { c0: 14, r0: 23, w: 3, h: 3 },
    door: { c0: 18, r0: 26, w: 2, h: 2 },
    // Dome crown: the dome seats directly on the shaft top (no cross platform — desert towers
    // are cylindrical, the dome caps the drum). dy nudges it down to rest on the cornice.
    crown: {
      shaftW: 5,
      roof: { c0: 3, r0: 2, w: 7, h: 8, dy: -6 }
    }
  },
  swamp: {
    label: "Swamp",
    url: SWAMP,
    tile: 8,
    bg: "#0f1410",
    wall: WALL2,
    roof: { c0: 9, r0: 1, w: 6, h: 8 },
    window: { c0: 17, r0: 20, w: 3, h: 3 },
    door: { c0: 17, r0: 24, w: 3, h: 3 },
    // Blue crenellated battlement row (reuses the window's merlon top edge).
    parapet: { left: [17, 20], mid: [18, 20], right: [19, 20] }
  }
};

// ../auto-battler/src/render/towerViewer.js
function createTowerViewer(pixi, host, opts = {}) {
  return createTileViewer(pixi, host, {
    skins: TOWER_SKINS,
    defaultSkin: opts.skin || "meadow",
    seed: opts.seed ?? 1,
    sourcesFor: (skin) => [skin.url],
    render: render2,
    fit: fit2
  });
}
function render2({ root, skin, seed, TILE: TILE11, tex, sources, Sprite, Graphics }) {
  const src = sources.get(skin.url);
  const shaftW = skin.crown ? skin.crown.shaftW : (skin.roof?.w ?? 7) - 2;
  const winH = skin.window?.h ?? 2, doorH = skin.door?.h ?? 2;
  const W = skin.wall;
  const N = 3, GAP = 3;
  const ROOFS = ["pyramid", "battlement", "none"];
  let spec0 = null;
  let ox = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity;
  for (let i = 0; i < N; i++) {
    const spec = generateTower(seed + i, { w: shaftW, hasParapet: !!(skin.parapet || skin.crown), winH, doorH, roof: ROOFS[i] });
    if (i === 0) spec0 = spec;
    const { w, h: h2 } = spec;
    const PLINTH = 2, wb = w + 2;
    const corn = spec.roof === "none" ? 0 : 1;
    const dy = -(h2 + PLINTH - 1);
    const add = (coord, x, y) => {
      const sp = new Sprite(tex(src, coord[0], coord[1], TILE11));
      sp.x = (x + ox) * TILE11;
      sp.y = (y + dy) * TILE11;
      root.addChild(sp);
      return sp;
    };
    const shadow = new Graphics();
    shadow.ellipse((ox + w / 2) * TILE11, TILE11 - TILE11 * 0.3, wb / 2 * TILE11 + TILE11 * 0.5, TILE11 * 0.7).fill({ color: 0, alpha: 0.22 });
    root.addChild(shadow);
    for (let y = 0; y < h2; y++) for (let x = 0; x < w; x++) {
      const top = y === 0, bot = y === h2 - 1, left = x === 0, right = x === w - 1;
      const t = top || bot || left || right ? nineSlice(W, top, bot, left, right) : skin.fillVars && rhash(ox + x, y, 0, seed) % 6 === 0 ? skin.fillVars[rhash(ox + x, y, 99, seed) % skin.fillVars.length] : W.c;
      add(t, x, y);
    }
    for (let py = 0; py < PLINTH; py++) for (let px = 0; px < wb; px++) {
      add(nineSlice(W, py === 0, py === PLINTH - 1, px === 0, px === wb - 1), px - 1, h2 + py);
    }
    for (let cy = 0; cy < corn; cy++) for (let cx = 0; cx < wb; cx++) {
      add(nineSlice(W, true, false, cx === 0, cx === wb - 1), cx - 1, -1 - cy);
    }
    const belt = corn && h2 >= 8 ? Math.round(h2 / 2) : -1;
    if (belt >= 0) for (let bx = 0; bx < wb; bx++) add(nineSlice(W, true, false, bx === 0, bx === wb - 1), bx - 1, belt);
    let topY;
    const blitCrown = (p) => {
      const sx = Math.floor((w - p.w) / 2);
      for (let ry = 0; ry < p.h; ry++) for (let rx = 0; rx < p.w; rx++) add([p.c0 + rx, p.r0 + ry], sx + rx, p.dy + ry);
      x0 = Math.min(x0, ox + sx);
      x1 = Math.max(x1, ox + sx + p.w);
      return p.dy;
    };
    if (skin.crown && spec.roof !== "none") {
      const cr = skin.crown;
      let tY = 0;
      if (cr.platform) tY = Math.min(tY, blitCrown(cr.platform));
      if (cr.rail) tY = Math.min(tY, blitCrown(cr.rail));
      if (spec.roof === "pyramid" && cr.roof) tY = Math.min(tY, blitCrown(cr.roof));
      topY = tY + dy;
    } else if (spec.roof === "none") {
      topY = dy;
      x0 = Math.min(x0, ox);
      x1 = Math.max(x1, ox + w);
    } else if (spec.roof === "battlement" && skin.parapet) {
      const pp = skin.parapet;
      for (let x = 0; x < w; x++) add(x === 0 ? pp.left : x === w - 1 ? pp.right : pp.mid, x, -1 - corn);
      topY = -1 - corn + dy;
      x0 = Math.min(x0, ox);
      x1 = Math.max(x1, ox + w);
    } else {
      const rk = skin.roof;
      const roofX0 = (w - rk.w) / 2, roofY0 = -(rk.h - 1) - corn;
      for (let ry = 0; ry < rk.h; ry++) for (let rx = 0; rx < rk.w; rx++) add([rk.c0 + rx, rk.r0 + ry], roofX0 + rx, roofY0 + ry);
      topY = roofY0 + dy;
      x0 = Math.min(x0, ox + Math.floor(roofX0));
      x1 = Math.max(x1, ox + Math.ceil(roofX0 + rk.w));
    }
    y0 = Math.min(y0, topY);
    x0 = Math.min(x0, ox - 1);
    x1 = Math.max(x1, ox + w + 1);
    const blit = (rect3, bx, by) => {
      for (let ry = 0; ry < rect3.h; ry++) for (let rx = 0; rx < rect3.w; rx++) add([rect3.c0 + rx, rect3.r0 + ry], bx + rx, by + ry);
    };
    if (skin.window) {
      const wx = Math.floor((w - skin.window.w) / 2);
      for (const wy of spec.windows) blit(skin.window, wx, wy);
    }
    if (skin.door && spec.hasDoor) blit(skin.door, Math.floor((w - skin.door.w) / 2), h2 - skin.door.h);
    ox += w + GAP;
  }
  const bounds = { x0: Math.min(x0, 0), y0, x1: Math.max(x1, ox - GAP), y1: 2 };
  return { bounds, tile: TILE11, snapshot: { w: spec0?.w ?? 0, h: spec0?.h ?? 0, roof: spec0?.roof } };
}
function fit2(app, root, b, TILE11) {
  const sw = app.screen.width, sh = app.screen.height;
  const cw = (b.x1 - b.x0) * TILE11, ch = (b.y1 - b.y0) * TILE11;
  const pad = 4 * TILE11;
  const s = Math.max(1, Math.floor(Math.min(sw / (cw + pad), sh / (ch + pad))));
  root.scale.set(s);
  root.x = Math.round((sw - cw * s) / 2 - b.x0 * TILE11 * s);
  root.y = Math.round((sh - ch * s) / 2 - b.y0 * TILE11 * s);
}

// ../auto-battler/src/render/mapConfigs.js
var CITY_SKINS = {
  medieval: { label: "Medieval City", url: MC_TILES_URL },
  mountain: { label: "Mountain Stronghold", url: MS_TILES_URL }
};
var CITY_REF = { medieval: MC_REF, mountain: MS_REF };
var citySheets = (skin) => ({
  medieval: [
    { key: "tiles", label: "Tiles", url: MC_TILES_URL, catalog: MC_TILE_CATALOG },
    { key: "props", label: "Props", url: MC_PROPS_URL, catalog: MC_PROP_CATALOG }
  ],
  mountain: [
    { key: "tiles", label: "Tiles", url: MS_TILES_URL, catalog: MS_TILE_CATALOG },
    { key: "props", label: "Props", url: MS_PROPS_URL, catalog: MS_PROP_CATALOG }
  ]
})[skin] || [];
var ASSET = "/assets/minifantasy";
var ORC4 = `${ASSET}/Minifantasy_Orc_Kingdom_v1.0/Minifantasy_Orc_Kingdom_Assets`;
var NECRO4 = `${ASSET}/Minifantasy_Necropolis_v1.0/Minifantasy_Necropolis_Assets`;
var ORC_LAYER_DIR = `${ORC4}/_Premade%20Scene/Separate%20Layers`;
var ORC_SCENE = { w: 648, h: 488 };
var ORC_LAYERS = [
  ["k-ground", "Ground", "ground"],
  ["j-walls", "Walls", "structure"],
  ["i-doors", "Doors", "structure"],
  ["h-characters", "Characters", "scatter"],
  ["g-wall_shadows", "Wall shadows", "lighting"],
  ["f-prop_shadows", "Prop shadows", "lighting"],
  ["e-roof_posts", "Roof posts", "structure"],
  ["d-props", "Props", "scatter"],
  ["c-fire", "Fire", "lighting"],
  ["b-fire_light", "Fire light", "lighting"],
  ["a-roofs", "Roofs", "structure"]
];
var NECRO_SHEETS = [
  { key: "biome", label: "CorruptedBiome", url: `${NECRO4}/Tileset/Biome/CorruptedBiome.png` },
  { key: "props", label: "Props", url: `${NECRO4}/Props/Props.png` }
];
var ORC_SHEETS = [
  { key: "tiles", label: "Tiles", url: `${ORC4}/Tileset/Tiles.png` },
  { key: "props", label: "Props", url: `${ORC4}/Props/Props.png` },
  { key: "roofs", label: "Roofs & Posts", url: `${ORC4}/Tileset/Roofs/Roofs_And_Posts.png` }
];
var FP_SHEETS = [
  { key: "tiles", label: "Tiles", url: FP_TILES_URL, catalog: FP_TILE_CATALOG },
  { key: "props", label: "Props", url: FP_PROPS_URL, catalog: FP_PROP_CATALOG }
];
var DD_SHEETS = [
  { key: "tiles", label: "Tiles", url: DD_TILES_URL, catalog: DD_TILE_CATALOG },
  { key: "props", label: "Props", url: DD_PROPS_URL, catalog: DD_PROP_CATALOG }
];
var LJ_SHEETS = [
  { key: "tiles", label: "Tiles", url: LJ_TILES_URL, catalog: LJ_TILE_CATALOG },
  { key: "props", label: "Props", url: LJ_PROPS_URL, catalog: LJ_PROP_CATALOG }
];
var INTERIOR_REF = {
  orc: {
    dir: `${ORC4}/_Premade%20Scene/Separate%20Layers`,
    w: 648,
    h: 488,
    bg: "#15110d",
    layers: [
      ["k-ground", "Ground", "ground"],
      ["j-walls", "Walls", "structure"],
      ["i-doors", "Doors", "structure"],
      ["h-characters", "Characters", "scatter"],
      ["g-wall_shadows", "Wall shadows", "lighting"],
      ["f-prop_shadows", "Prop shadows", "lighting"],
      ["e-roof_posts", "Roof posts", "structure"],
      ["d-props", "Props", "scatter"],
      ["c-fire", "Fire", "lighting"],
      ["b-fire_light", "Fire light", "lighting"],
      ["a-roofs", "Roofs", "structure"]
    ]
  },
  necropolis: {
    dir: `${NECRO4}/PremadeScenes/Interior/SeparateLayers`,
    w: 256,
    h: 336,
    bg: "#0f0c14",
    pulse: { key: "a-undeadflame", base: 0.55, amp: 0.45, speed: 0.08 },
    layers: [
      ["k-bg", "Background", "ground"],
      ["j-floor", "Floor", "ground"],
      ["i-corruption", "Corruption", "ground"],
      ["h-bones", "Bones", "scatter"],
      ["g-wall", "Wall", "structure"],
      ["f-wallcorruption", "Wall corruption", "structure"],
      ["e-doors", "Doors", "structure"],
      ["d-props", "Props", "scatter"],
      ["c-propshadows", "Prop shadows", "lighting"],
      ["b-wallshadows", "Wall shadows", "lighting"],
      ["a-undeadflame", "Undead flame", "lighting"]
    ]
  },
  temple: {
    dir: `${ASSET}/Minifantasy_Temple_Of_The_Snake_God_v1.0_Commercial_Version/Temple_Of_The_Snake_God/Premade/_Separate_Layers`,
    w: 608,
    h: 368,
    bg: "#080c08",
    pulse: { key: "c-candles", base: 0.6, amp: 0.4, speed: 0.07 },
    layers: [
      ["j-bg", "Background", "ground"],
      ["i-floor", "Floor", "ground"],
      ["h-walls", "Walls", "structure"],
      ["g-sculpture_base", "Sculpture base", "structure"],
      ["f-snake_sculptures", "Snake sculptures", "scatter"],
      ["f.2-snake_sculptures", "Snake sculptures 2", "scatter"],
      ["e-props", "Props", "scatter"],
      ["d-shadows", "Shadows", "lighting"],
      ["c-candles", "Candles", "lighting"],
      ["b-light_effect_1", "Light effect 1", "lighting"],
      ["a-light_effect_2", "Light effect 2", "lighting"]
    ]
  },
  // The Crypt/Sewers packs name their layer files bare (no Premade_ prefix); the Dwarven
  // Workshop prefixes them Premade_Interior_. `prefix` overrides the loader's default.
  crypt: {
    dir: `${ASSET}/Minifantasy_Crypt_Of_The_Forgotten_v1.0/Minifantasy_Crypt_Of_The_Forgotten_Assets/Premade_Scene/Separate_Layers`,
    w: 568,
    h: 456,
    bg: "#0b0b10",
    prefix: "",
    layers: [
      ["h_bg", "Background", "ground"],
      ["g_floor", "Floor", "ground"],
      ["f_walls", "Walls", "structure"],
      ["e_wall_engravings", "Wall engravings", "structure"],
      ["d_stairs", "Stairs", "structure"],
      ["c_doors", "Doors", "structure"],
      ["b_props", "Props", "scatter"],
      ["a_shadows", "Shadows", "lighting"]
    ]
  },
  sewers: {
    dir: `${ASSET}/Minifantasy_Sewers_v1.0/Minifantasy_Sewers_Assets/Premade_Scene/Separate_Layers`,
    w: 632,
    h: 368,
    bg: "#0a120c",
    prefix: "",
    layers: [
      ["h-background", "Background", "ground"],
      ["g-ground", "Ground", "ground"],
      ["f-bridges", "Bridges", "structure"],
      ["e-walls", "Walls", "structure"],
      ["d-wall_pipes", "Wall pipes", "structure"],
      ["c-props", "Props", "scatter"],
      ["b-character", "Character", "scatter"],
      ["a-shadows", "Shadows", "lighting"]
    ]
  },
  dwarven: {
    dir: `${ASSET}/Minifantasy_Dwarven_Workshop_v1.0/Minifantasy_Dwarven_Workshop_Assets/Premades/Premade_Workshops/Separate_Layers/Interior`,
    w: 424,
    h: 648,
    bg: "#14111a",
    prefix: "Premade_Interior_",
    pulse: { key: "c-prop_shadows_and_lights", base: 0.7, amp: 0.3, speed: 0.1 },
    layers: [
      ["k-bg_black", "Background", "ground"],
      ["j-floor", "Floor", "ground"],
      ["i-stairs", "Stairs", "structure"],
      ["h-walls", "Walls", "structure"],
      ["g-chimneys", "Chimneys", "structure"],
      ["f-props_1", "Props 1", "scatter"],
      ["e-props_2", "Props 2", "scatter"],
      ["d-shadows", "Shadows", "lighting"],
      ["c-prop_shadows_and_lights", "Prop shadows & lights", "lighting"],
      ["b-atmosphere_1", "Atmosphere 1", "lighting"],
      ["a-atmosphere_2", "Atmosphere 2", "lighting"]
    ]
  }
};
var TROOT = `${ASSET}/Minifantasy_Towers_v1.0/Towers`;
var TOWER_REF = {
  meadow: {
    dir: `${TROOT}/Meadow_Towers/_Premades/Premade_1`,
    w: 104,
    h: 352,
    bg: "#16210f",
    layers: [
      ["1_n-bg", "Background", "ground"],
      ["1_m-ashlars", "Ashlars", "structure"],
      ["1_l-platform", "Platform", "structure"],
      ["1_k-tower_walls", "Tower walls", "structure"],
      ["1_j-cornice", "Cornice", "structure"],
      ["1_i-doors", "Doors", "structure"],
      ["1_h-windows", "Windows", "structure"],
      ["1_g-top", "Top", "structure"],
      ["1_f-stairs", "Stairs", "structure"],
      ["1_e-railing", "Railing", "structure"],
      ["1_d-roof_structure", "Roof structure", "structure"],
      ["1_c-shadows", "Shadows", "lighting"],
      ["1_b-roof", "Roof", "structure"],
      ["1_a-banners", "Banners", "scatter"]
    ]
  },
  desert: {
    dir: `${TROOT}/Desert_Towers/_Premades/Premade_1`,
    w: 104,
    h: 264,
    bg: "#241d10",
    layers: [
      ["1_m-bg", "Background", "ground"],
      ["1_l-ashlars", "Ashlars", "structure"],
      ["1_k-platform", "Platform", "structure"],
      ["1_j-tower_walls", "Tower walls", "structure"],
      ["1_i-cornice", "Cornice", "structure"],
      ["1_h-top", "Top", "structure"],
      ["1_g-decoration_b", "Decoration (back)", "scatter"],
      ["1_f-cilinder", "Cylinder", "structure"],
      ["1_e-dome", "Dome", "structure"],
      ["1_d-doors", "Doors", "structure"],
      ["1_c-windows", "Windows", "structure"],
      ["1_b-decoration_f", "Decoration (front)", "scatter"],
      ["1_a-shadows", "Shadows", "lighting"]
    ]
  },
  swamp: {
    dir: `${TROOT}/Swamp_Towers/_Premades/Premade_1`,
    w: 88,
    h: 248,
    bg: "#0f1410",
    layers: [
      ["1_k-bg", "Background", "ground"],
      ["1_j-foundations", "Foundations", "structure"],
      ["1_i-shadows_1", "Shadows 1", "lighting"],
      ["1_h-structure_1", "Structure 1", "structure"],
      ["1_g-platform_1", "Platform", "structure"],
      ["1_f-ladder_2", "Ladder", "structure"],
      ["1_e-structure_2", "Structure 2", "structure"],
      ["1_d-floor", "Floor", "ground"],
      ["1_c-walls", "Walls", "structure"],
      ["1_b-shadows_2", "Shadows 2", "lighting"],
      ["1_a-roof", "Roof", "structure"]
    ]
  }
};
var sceneUrls = (dir, layers, prefix = "Premade_") => layers.map(([key]) => `${dir}/${prefix}${key}.png`);
var skinUrls = (skins) => Object.values(skins).flatMap((s) => [
  s.url,
  s.propsUrl,
  s.torch?.url,
  s.water?.url,
  s.waterProps?.url,
  s.shadows?.tiles,
  s.shadows?.props
].filter(Boolean));
var MAP_ASSET_URLS = [.../* @__PURE__ */ new Set([
  // Generated biome maps (the World Map overworld composites all three).
  ...FP_MAP_ASSETS,
  ...ORC_MAP_ASSETS,
  ...NECRO_MAP_ASSETS,
  FP_MOCKUP_URL,
  ...DD_MAP_ASSETS,
  DD_MOCKUP_URL,
  ...LJ_MAP_ASSETS,
  LJ_MOCKUP_URL,
  // Finite Game-world biome base sheets (gameWorld.js) — incl. new biomes beyond the sandbox three.
  ...GAME_BIOME_URLS,
  // Tilesheet inspector sheets.
  ...NECRO_SHEETS.map((s) => s.url),
  ...ORC_SHEETS.map((s) => s.url),
  ...FP_SHEETS.map((s) => s.url),
  // Cities: each skin's generated-ground sheet, clickable Tiles/Props, and premade reference layers.
  ...MC_MAP_ASSETS,
  MC_TILES_URL,
  MC_PROPS_URL,
  ...sceneUrls(MC_REF.dir, MC_REF.layers),
  ...MS_MAP_ASSETS,
  MS_TILES_URL,
  MS_PROPS_URL,
  ...sceneUrls(MS_REF.dir, MS_REF.layers),
  // Premade-scene reference layers.
  ...sceneUrls(NECRO_EXT_DIR, NECRO_LAYERS),
  ...sceneUrls(ORC_LAYER_DIR, ORC_LAYERS),
  ...Object.values(INTERIOR_REF).flatMap((r) => sceneUrls(r.dir, r.layers, r.prefix)),
  ...Object.values(TOWER_REF).flatMap((r) => sceneUrls(r.dir, r.layers)),
  // Generated interiors/towers skin sheets (+ props/torch).
  ...skinUrls(INTERIOR_SKINS),
  ...skinUrls(TOWER_SKINS)
])];

// ../auto-battler/src/render/mapSandbox.js
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
}
var randomSeed = () => Math.floor(Date.now() % 1e6 + Math.random() * 1e6) >>> 0;
var infiniteMeta = (s) => s?.zoom != null ? `\u221E \xB7 seed ${s.seed} \xB7 (${s.cx}, ${s.cy}) \xB7 ${s.zoom.toFixed(2)}\xD7 \xB7 drag / WASD / scroll` : "loading\u2026";
function makeGridOverlay() {
  const TILE11 = 8;
  const cv = h("canvas", { class: "necro-grid-overlay" });
  cv.style.display = "none";
  let raf = 0, ctrl = null;
  function draw() {
    const host = cv.parentElement;
    const cam = ctrl?.getCamera?.();
    if (host && cam) {
      const W = host.clientWidth, H = host.clientHeight;
      if (cv.width !== W) cv.width = W;
      if (cv.height !== H) cv.height = H;
      const ctx = cv.getContext("2d");
      ctx.clearRect(0, 0, W, H);
      const z = cam.zoom, cell = TILE11 * z;
      if (cell >= 6) {
        const sx = (wx) => (wx * TILE11 - cam.x) * z + W / 2;
        const sy = (wy) => (wy * TILE11 - cam.y) * z + H / 2;
        const x0 = Math.floor((cam.x - W / 2 / z) / TILE11), x1 = Math.ceil((cam.x + W / 2 / z) / TILE11);
        const y0 = Math.floor((cam.y - H / 2 / z) / TILE11), y1 = Math.ceil((cam.y + H / 2 / z) / TILE11);
        ctx.strokeStyle = "rgba(255,70,70,0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let cx = x0; cx <= x1; cx++) {
          const X = Math.round(sx(cx));
          ctx.moveTo(X, 0);
          ctx.lineTo(X, H);
        }
        for (let cy = y0; cy <= y1; cy++) {
          const Y = Math.round(sy(cy));
          ctx.moveTo(0, Y);
          ctx.lineTo(W, Y);
        }
        ctx.stroke();
        if (cell >= 22 && ctrl.tileIndexAt) {
          ctx.font = `${Math.min(10, Math.floor(cell / 3))}px monospace`;
          ctx.textBaseline = "top";
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#000";
          ctx.fillStyle = "#ffe000";
          for (let cy = y0; cy < y1; cy++) for (let cx = x0; cx < x1; cx++) {
            const idx = ctrl.tileIndexAt(cx, cy);
            if (!idx) continue;
            const s = `${idx[0]},${idx[1]}`, X = sx(cx) + 1.5, Y = sy(cy) + 1.5;
            ctx.strokeText(s, X, Y);
            ctx.fillText(s, X, Y);
          }
        }
      }
    }
    raf = requestAnimationFrame(draw);
  }
  return {
    canvas: cv,
    setCtrl(c) {
      ctrl = c;
    },
    setActive(on) {
      cv.style.display = on ? "block" : "none";
      if (on && !raf) draw();
      if (!on && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ctrl = null;
    }
  };
}
var SVG_NS = "http://www.w3.org/2000/svg";
var ROLE_META = {
  surface: { label: "autotile floor", color: "#6bb36b" },
  face: { label: "cliff face", color: "#9aa3b0" },
  transition: { label: "transition", color: "#e0a050" },
  void: { label: "void", color: "#a974d6" },
  structure: { label: "structure", color: "#5b9bd5" },
  floor: { label: "floor", color: "#c9a06a" },
  prop: { label: "prop", color: "#d57ba8" },
  decor: { label: "decor", color: "#79c4c4" }
};
var roleMeta = (r) => ROLE_META[r] || { label: r || "misc", color: "#888" };
function makeTilesheet(sheets, tile = 8, opts = {}) {
  const z = 6;
  let key = sheets.some((s) => s.key === opts.initialSheet) ? opts.initialSheet : sheets[0]?.key;
  const dims = h("span", { class: "necro-sheet-dims" }, "loading\u2026");
  const bar = h("div", { class: "necro-sheet-bar" });
  const stage = h("div", { class: "necro-sheet-stage" });
  const img = h("img", { class: "checker necro-sheet-img", alt: key });
  const scroll = h("div", { class: "necro-sheet-scroll" }, stage);
  const catalog = h("div", { class: "tilesheet-catalog", style: "display:none" });
  const root = h("div", { class: "necro-tilesheet" }, bar, h("div", { class: "tilesheet-main" }, scroll, catalog));
  stage.append(img);
  const btns = sheets.map((s) => {
    const b = h("button", { class: "necro-chip", "data-testid": `sheet-${s.key}`, onClick: () => select(s.key) }, s.label);
    bar.append(b);
    return [s.key, b];
  });
  bar.append(dims);
  let grid = null;
  const cell = tile * z;
  let entries = [], rows = [], hl = null, selectedIdx = -1, roleFilter = null;
  const urlOf = () => (sheets.find((s) => s.key === key) ?? sheets[0]).url;
  function select(k) {
    key = k;
    opts.onSheet?.(k);
    btns.forEach(([kk, b]) => b.classList.toggle("on", kk === k));
    dims.textContent = "loading\u2026";
    if (grid) {
      grid.remove();
      grid = null;
    }
    hl = null;
    entries = [];
    rows = [];
    selectedIdx = -1;
    roleFilter = null;
    img.style.width = img.style.height = stage.style.width = stage.style.height = "auto";
    img.alt = k;
    img.src = urlOf();
  }
  function selectEntry(idx, { scrollList, scrollSheet } = {}) {
    selectedIdx = idx;
    rows.forEach((el, i) => el && el.classList.toggle("is-selected", i === idx));
    const p = entries[idx];
    if (hl) {
      while (hl.firstChild) hl.removeChild(hl.firstChild);
      if (p?.frame) {
        const [c, r, w, ph] = p.frame;
        const topR = r - ph + 1;
        for (const [tc, tr] of p.tiles || []) hl.append(rect2(tc * cell, tr * cell, cell, cell, "tcat-tint"));
        const out = rect2(c * cell, topR * cell, w * cell, ph * cell, "tcat-hilite");
        out.append(anim("stroke-width", "3;1.5;3"), anim("stroke-opacity", "1;.45;1"));
        hl.append(out);
        hl.style.display = "";
      } else {
        hl.style.display = "none";
      }
    }
    if (scrollList && rows[idx]) rows[idx].scrollIntoView({ block: "nearest" });
    if (scrollSheet && p?.frame) {
      const [c, r, w, ph] = p.frame, topR = r - ph + 1;
      scroll.scrollTo({
        left: c * cell + (w * cell - scroll.clientWidth) / 2,
        top: topR * cell + (ph * cell - scroll.clientHeight) / 2,
        behavior: "smooth"
      });
    }
  }
  stage.addEventListener("click", (e) => {
    if (!entries.length) return;
    const b = stage.getBoundingClientRect();
    const col = Math.floor((e.clientX - b.left) / cell), row = Math.floor((e.clientY - b.top) / cell);
    let best = -1, bestArea = Infinity;
    entries.forEach((p, i) => {
      if (!p.frame) return;
      const [c, r, w, ph] = p.frame, topR = r - ph + 1;
      if (col >= c && col < c + w && row >= topR && row < topR + ph && w * ph < bestArea) {
        bestArea = w * ph;
        best = i;
      }
    });
    selectEntry(best, { scrollList: best >= 0 });
  });
  img.addEventListener("load", () => {
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const W = nw * z, H = nh * z, cols = Math.ceil(nw / tile), rows2 = Math.ceil(nh / tile), cell2 = tile * z;
    img.style.width = stage.style.width = `${W}px`;
    img.style.height = stage.style.height = `${H}px`;
    dims.textContent = `${cols}\xD7${rows2} tiles \xB7 ${nw}\xD7${nh}px`;
    if (grid) grid.remove();
    grid = document.createElementNS(SVG_NS, "svg");
    grid.setAttribute("class", "necro-sheet-grid");
    grid.setAttribute("width", W);
    grid.setAttribute("height", H);
    grid.setAttribute("viewBox", `0 0 ${W} ${H}`);
    for (let i = 0; i <= cols; i++) line(grid, i * cell2, 0, i * cell2, H);
    for (let j = 0; j <= rows2; j++) line(grid, 0, j * cell2, W, j * cell2);
    for (let j = 0; j < rows2; j++) for (let i = 0; i < cols; i++) label(grid, i * cell2 + 2, j * cell2 + 11, `${i},${j}`);
    hl = document.createElementNS(SVG_NS, "g");
    hl.setAttribute("class", "tcat-hl");
    hl.style.display = "none";
    grid.append(hl);
    stage.append(grid);
    renderCatalog(sheets.find((s) => s.key === key), nw, nh);
  });
  function renderCatalog(sheet, nw, nh) {
    catalog.innerHTML = "";
    entries = sheet?.catalog || [];
    rows = [];
    if (!sheet?.catalog) {
      catalog.style.display = "none";
      return;
    }
    catalog.style.display = "";
    const usedN = sheet.catalog.filter((p) => p.used).length;
    catalog.append(h("div", { class: "tcat-head" }, `${sheet.label} \u2014 ${usedN}/${sheet.catalog.length} used in generation`));
    const present = [...new Set(sheet.catalog.map((p) => p.role).filter(Boolean))].sort((a, b) => Object.keys(ROLE_META).indexOf(a) - Object.keys(ROLE_META).indexOf(b));
    if (present.length) {
      const bar2 = h("div", { class: "tcat-filterbar", style: "display:flex;flex-wrap:wrap;gap:4px;padding:4px 0 6px" });
      const chip = (role, lbl, n) => {
        const m = role ? roleMeta(role) : { color: "#bbb" };
        const on = roleFilter === role;
        const el = h(
          "button",
          {
            class: "necro-chip",
            style: `font-size:11px;padding:2px 7px;border-radius:10px;display:inline-flex;align-items:center;gap:5px;border:1px solid ${on ? m.color : "rgba(255,255,255,.18)"};background:${on ? m.color + "33" : "transparent"};color:#dfe2e8;cursor:pointer`,
            onClick: () => {
              roleFilter = on ? null : role;
              renderCatalog(sheet, nw, nh);
            }
          },
          role ? h("span", { style: `width:8px;height:8px;border-radius:2px;background:${m.color};display:inline-block` }) : null,
          `${lbl} ${n}`
        );
        return el;
      };
      bar2.append(chip(null, "All", sheet.catalog.length));
      for (const role of present) bar2.append(chip(role, roleMeta(role).label, sheet.catalog.filter((p) => p.role === role).length));
      catalog.append(bar2);
    }
    sheet.catalog.forEach((p, idx) => {
      if (roleFilter && p.role !== roleFilter) {
        rows.push(null);
        return;
      }
      let thumb, metaTail;
      if (p.frame) {
        const [c, r, w, ph] = p.frame;
        const topR = r - ph + 1;
        const scale = Math.min(6, 52 / (Math.max(w, ph) * tile));
        thumb = h("div", { class: "tcat-thumb" });
        thumb.style.cssText = `width:${w * tile * scale}px;height:${ph * tile * scale}px;background-image:url("${sheet.url}");background-size:${nw * scale}px ${nh * scale}px;background-position:-${c * tile * scale}px -${topR * tile * scale}px;background-repeat:no-repeat;image-rendering:pixelated`;
        metaTail = ` ${w}\xD7${ph} \xB7 [${c},${r}]`;
      } else {
        thumb = h("div", { class: "tcat-thumb tcat-thumb-ext" }, "\u2197");
        metaTail = " external";
      }
      const m = roleMeta(p.role);
      const roleTag = p.role ? h("span", {
        class: "tcat-role",
        style: `font-size:10px;padding:1px 6px;border-radius:8px;margin-right:5px;background:${m.color}26;border:1px solid ${m.color};color:${m.color}`
      }, m.label) : null;
      const item = h(
        "div",
        { class: `tcat-item ${p.used ? "" : "is-unused"}`, onClick: () => selectEntry(idx, { scrollSheet: true }) },
        h("div", { class: "tcat-thumbwrap" }, thumb),
        h(
          "div",
          { class: "tcat-info" },
          h("div", { class: "tcat-name" }, roleTag, p.name),
          h(
            "div",
            { class: "tcat-meta" },
            h("span", { class: `tcat-badge ${p.used ? "on" : "off"}` }, p.used ? "used" : "unused"),
            metaTail
          ),
          p.note ? h("div", { class: "tcat-note" }, p.note) : null
        )
      );
      rows.push(item);
      catalog.append(item);
    });
  }
  select(key);
  return root;
}
function line(svg, x1, y1, x2, y2) {
  const l = document.createElementNS(SVG_NS, "line");
  l.setAttribute("x1", x1);
  l.setAttribute("y1", y1);
  l.setAttribute("x2", x2);
  l.setAttribute("y2", y2);
  l.setAttribute("stroke", "#ff3b3b");
  l.setAttribute("stroke-width", "1");
  l.setAttribute("opacity", "0.5");
  svg.append(l);
}
function rect2(x, y, w, h2, cls2) {
  const r = document.createElementNS(SVG_NS, "rect");
  r.setAttribute("x", x);
  r.setAttribute("y", y);
  r.setAttribute("width", w);
  r.setAttribute("height", h2);
  r.setAttribute("class", cls2);
  return r;
}
function anim(attr, values) {
  const a = document.createElementNS(SVG_NS, "animate");
  a.setAttribute("attributeName", attr);
  a.setAttribute("values", values);
  a.setAttribute("dur", "1s");
  a.setAttribute("repeatCount", "indefinite");
  return a;
}
function label(svg, x, y, text) {
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", x);
  t.setAttribute("y", y);
  t.setAttribute("font-size", "10");
  t.setAttribute("font-family", "monospace");
  t.setAttribute("fill", "#ffe000");
  t.setAttribute("stroke", "#000");
  t.setAttribute("stroke-width", "0.5");
  t.setAttribute("paint-order", "stroke");
  t.textContent = text;
  svg.append(t);
}
function makePage(pixi, body, cfg) {
  const hasModes = cfg.modes.length > 1;
  let view = cfg.modes.some((m) => m.key === cfg.initialView) ? cfg.initialView : cfg.modes[0].key;
  let skin = cfg.skins ? cfg.skins[0].key : null;
  let seed = cfg.initialSeed != null && cfg.initialSeed !== "" ? +cfg.initialSeed >>> 0 : 1;
  let showGrid = false;
  let showProps = true;
  let ctrl = null, off = null, grid = null;
  const titleSmall = h("small", { class: "muted" });
  const modePills = h("div", { class: "mapsandbox-pills necro-modes" });
  const skinPills = h("div", { class: "mapsandbox-pills necro-modes" });
  const seedInput = h("input", { type: "number", value: seed });
  const gridToggleInput = h("input", { type: "checkbox" });
  const propsToggleInput = h("input", { type: "checkbox", checked: true });
  const meta = h("span", { class: "worldmap-meta muted" });
  const layersEl = h("div", { class: "necro-layers" });
  const stage = h("div", { class: "necro-stage" });
  const modeBtns = cfg.modes.map((m) => {
    const b = h("button", { onClick: () => setView(m.key) }, m.label);
    modePills.append(b);
    return [m.key, b];
  });
  const skinBtns = (cfg.skins || []).map((s) => {
    const b = h("button", { onClick: () => setSkin(s.key) }, s.label);
    skinPills.append(b);
    return [s.key, b];
  });
  seedInput.addEventListener("input", (e) => {
    seed = e.target.value === "" ? "" : +e.target.value;
  });
  seedInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") regen((+seed || 0) >>> 0);
  });
  const seedLabel = h("label", { class: "worldmap-seed" }, "seed", seedInput);
  const regenBtn = h("button", { class: "worldmap-btn", onClick: () => regen((+seed || 0) >>> 0) }, "Regenerate");
  const randBtn = h("button", { class: "worldmap-btn", onClick: () => {
    const v = randomSeed();
    seed = v;
    seedInput.value = v;
    regen(v);
  } }, "Random");
  gridToggleInput.addEventListener("change", (e) => {
    showGrid = e.target.checked;
    grid?.setActive(showGrid && view === "generated");
  });
  const gridToggle = h("label", { class: "necro-grid-toggle" }, gridToggleInput, " Grid + indices");
  propsToggleInput.addEventListener("change", (e) => {
    showProps = e.target.checked;
    if (view === "generated") render3();
  });
  const propsToggle = h("label", { class: "necro-grid-toggle", "data-testid": "props-toggle" }, propsToggleInput, " Props");
  const genControls = h("span", {}, seedLabel, regenBtn, randBtn, cfg.propsToggle ? propsToggle : null, cfg.grid ? gridToggle : null);
  const allBtn = h("button", { class: "worldmap-btn", onClick: () => setAllLayers(true) }, "All");
  const noneBtn = h("button", { class: "worldmap-btn", onClick: () => setAllLayers(false) }, "None");
  const refControls = h("span", {}, allBtn, noneBtn);
  const bar = h(
    "div",
    { class: "worldmap-bar" },
    h("span", { class: "worldmap-title" }, `${cfg.title} `, titleSmall),
    hasModes ? modePills : null,
    cfg.skins ? skinPills : null,
    genControls,
    refControls,
    meta
  );
  const rootEl = h("div", { class: "necro" }, bar, layersEl, stage);
  body.append(rootEl);
  function regen(v) {
    seed = v;
    seedInput.value = v;
    ctrl?.regenerate?.(v);
  }
  function setView(k) {
    view = k;
    cfg.onView?.(k);
    render3();
  }
  function setSkin(k) {
    skin = k;
    render3();
  }
  function setLayer(key, vis) {
    ctrl?.setLayer?.(key, vis);
  }
  function setAllLayers(vis) {
    (lastLayers || []).forEach((l) => ctrl?.setLayer?.(l.key, vis));
  }
  let lastLayers = null;
  const skinLabel = () => cfg.skins ? cfg.skins.find((s) => s.key === skin)?.label : "";
  function onSnap(snap) {
    if (view === "tilesheet") {
      meta.textContent = "8px tiles \xB7 select a sheet";
      return;
    }
    if (view === "reference") {
      if (cfg.mockup) {
        meta.textContent = "pack mockup";
        return;
      }
      const layers = snap?.layers ?? [];
      lastLayers = layers;
      const suffix = cfg.skins ? ` \xB7 ${skinLabel()}` : "";
      meta.textContent = layers.length ? `${layers.filter((l) => l.visible).length}/${layers.length} layers${suffix}` : "loading\u2026";
      renderLayerChips(layers);
      return;
    }
    meta.textContent = cfg.generatedMeta(snap, skinLabel());
  }
  function renderLayerChips(layers) {
    layersEl.innerHTML = "";
    for (const l of [...layers].reverse()) {
      const cb = h("input", { type: "checkbox" });
      cb.checked = l.visible;
      cb.addEventListener("change", (e) => setLayer(l.key, e.target.checked));
      layersEl.append(h("label", { class: `necro-chip group-${l.group} ${l.visible ? "on" : ""}` }, cb, ` ${l.label}`));
    }
  }
  function teardown() {
    off?.();
    off = null;
    try {
      ctrl?.destroy?.();
    } catch {
    }
    ctrl = null;
    grid?.destroy();
    grid = null;
    lastLayers = null;
  }
  function render3() {
    teardown();
    modeBtns.forEach(([k, b]) => b.classList.toggle("active", k === view));
    skinBtns.forEach(([k, b]) => b.classList.toggle("active", k === skin));
    titleSmall.textContent = `\xB7 ${cfg.subtitle ? cfg.subtitle(view) : view}`;
    const isScene = view === "reference" && !cfg.mockup;
    const isImage = view === "reference" && !!cfg.mockup;
    const hostVisible = view === "generated" || isScene;
    genControls.style.display = view === "generated" ? "" : "none";
    refControls.style.display = isScene ? "" : "none";
    layersEl.style.display = isScene ? "" : "none";
    layersEl.innerHTML = "";
    stage.innerHTML = "";
    const host = h("div", { class: "worldmap-host" });
    host.hidden = !hostVisible;
    stage.append(host);
    if (cfg.grid) {
      grid = makeGridOverlay();
      stage.append(grid.canvas);
      if (view === "generated") {
        stage.append(h(
          "div",
          { class: "necro-zoom" },
          h("button", { "aria-label": "Zoom in", onClick: () => ctrl?.zoomBy?.(1.4) }, "+"),
          h("button", { "aria-label": "Zoom out", onClick: () => ctrl?.zoomBy?.(1 / 1.4) }, "\u2212")
        ));
      }
    }
    if (view === "tilesheet") {
      stage.append(makeTilesheet(cfg.sheets(skin), 8, { initialSheet: cfg.initialSheet, onSheet: cfg.onSheet }));
      onSnap(null);
      return;
    }
    if (isImage) {
      stage.append(h(
        "div",
        { class: "necro-sheet-scroll" },
        h("img", { src: cfg.mockup, alt: `${cfg.title} mockup`, style: "image-rendering:pixelated;display:block" })
      ));
      onSnap(null);
      return;
    }
    ctrl = isScene ? cfg.makeScene(pixi, host, skin) : cfg.makeGenerated(pixi, host, (+seed || 0) >>> 0, skin, { props: showProps });
    off = ctrl.onChange(onSnap);
    ctrl.ready?.catch?.((e) => console.error(`${cfg.title} ${view} init failed`, e));
    if (cfg.grid && view === "generated") {
      grid.setCtrl(ctrl);
      grid.setActive(showGrid);
    }
    onSnap(null);
  }
  render3();
  return { destroy() {
    teardown();
    rootEl.remove();
  } };
}
var GEN_MODES = [{ key: "generated", label: "Generated" }, { key: "tilesheet", label: "Tilesheet" }, { key: "reference", label: "Reference" }];
var SKIN_MODES = [{ key: "generated", label: "Generated" }, { key: "reference", label: "Reference" }, { key: "tilesheet", label: "Tilesheet" }];
var skinList = (skins) => Object.entries(skins).map(([key, s]) => ({ key, label: s.label }));
var sceneFromRef = (pixi, host, ref) => createSceneViewer(pixi, host, { layers: ref.layers, dir: ref.dir, sceneW: ref.w, sceneH: ref.h, background: ref.bg, pulse: ref.pulse, prefix: ref.prefix });
var CITY_MAPS = { medieval: createMedievalCityMap, mountain: createMountainStrongholdMap };
var PAGES = {
  world: (pixi, body, opts) => makePage(pixi, body, {
    title: "World Map",
    subtitle: () => "overworld",
    modes: [{ key: "generated", label: "Generated" }],
    grid: true,
    initialSeed: opts?.seed,
    makeGenerated: (p, host, seed) => createOverworldMap(p, host, { seed }),
    generatedMeta: infiniteMeta
  }),
  // The new finite, layered Game World (built up layer-by-layer in gameWorld.js).
  gameworld: (pixi, body, opts) => makePage(pixi, body, {
    title: "Game World",
    subtitle: () => "finite \xB7 layered",
    modes: [{ key: "generated", label: "Generated" }],
    grid: true,
    initialSeed: opts?.seed,
    makeGenerated: (p, host, seed) => createGameWorld(p, host, { seed }),
    generatedMeta: (snap) => snap ? `seed ${snap.seed} \xB7 ${snap.chunks} chunks` : "loading\u2026"
  }),
  necropolis: (pixi, body, opts) => makePage(pixi, body, {
    title: "Necropolis",
    modes: GEN_MODES,
    grid: true,
    propsToggle: true,
    initialView: opts?.view,
    onView: opts?.onView,
    initialSheet: opts?.sheet,
    onSheet: opts?.onSheet,
    makeGenerated: (p, host, seed, _skin, gen) => createNecropolisMap(p, host, { seed, props: gen?.props }),
    makeScene: (p, host) => createSceneViewer(p, host, { layers: NECRO_LAYERS, dir: NECRO_EXT_DIR, sceneW: NECRO_SCENE, sceneH: NECRO_SCENE, pulse: { key: "a-undeadflames" } }),
    sheets: () => NECRO_SHEETS,
    generatedMeta: infiniteMeta
  }),
  orc: (pixi, body, opts) => makePage(pixi, body, {
    title: "Orc Kingdom",
    modes: GEN_MODES,
    grid: true,
    initialView: opts?.view,
    onView: opts?.onView,
    initialSheet: opts?.sheet,
    onSheet: opts?.onSheet,
    makeGenerated: (p, host, seed) => createOrcMap(p, host, { seed }),
    makeScene: (p, host) => createSceneViewer(p, host, { layers: ORC_LAYERS, dir: ORC_LAYER_DIR, sceneW: ORC_SCENE.w, sceneH: ORC_SCENE.h }),
    sheets: () => ORC_SHEETS,
    generatedMeta: infiniteMeta
  }),
  plains: (pixi, body, opts) => makePage(pixi, body, {
    title: "Forgotten Plains",
    modes: GEN_MODES,
    grid: true,
    propsToggle: true,
    mockup: FP_MOCKUP_URL,
    initialView: opts?.view,
    onView: opts?.onView,
    initialSheet: opts?.sheet,
    onSheet: opts?.onSheet,
    makeGenerated: (p, host, seed, _skin, gen) => createForgottenPlainsMap(p, host, { seed, props: gen?.props }),
    sheets: () => FP_SHEETS,
    generatedMeta: infiniteMeta
  }),
  desert: (pixi, body, opts) => makePage(pixi, body, {
    title: "Desolate Desert",
    modes: GEN_MODES,
    grid: true,
    propsToggle: true,
    mockup: DD_MOCKUP_URL,
    initialView: opts?.view,
    onView: opts?.onView,
    initialSheet: opts?.sheet,
    onSheet: opts?.onSheet,
    makeGenerated: (p, host, seed, _skin, gen) => createDesolateDesertMap(p, host, { seed, props: gen?.props }),
    sheets: () => DD_SHEETS,
    generatedMeta: infiniteMeta
  }),
  jungle: (pixi, body, opts) => makePage(pixi, body, {
    title: "Lost Jungle",
    modes: GEN_MODES,
    grid: true,
    propsToggle: true,
    mockup: LJ_MOCKUP_URL,
    initialView: opts?.view,
    onView: opts?.onView,
    initialSheet: opts?.sheet,
    onSheet: opts?.onSheet,
    makeGenerated: (p, host, seed, _skin, gen) => createLostJungleMap(p, host, { seed, props: gen?.props }),
    sheets: () => LJ_SHEETS,
    generatedMeta: infiniteMeta
  }),
  // Cities — same skin-based shape as Interiors/Towers (one pill, a style picker), with the standard
  // Generated / Reference / Tilesheet sub-pills. Reference = the pack's layer-by-layer premade;
  // Tilesheet = clickable Tiles/Props catalogue; Generated = the outdoor-floor ground (buildings TBD).
  cities: (pixi, body) => makePage(pixi, body, {
    title: "Cities",
    subtitle: () => "assembled \xB7 layered",
    modes: SKIN_MODES,
    skins: skinList(CITY_SKINS),
    grid: true,
    makeGenerated: (p, host, seed, skin) => CITY_MAPS[skin](p, host, { seed }),
    makeScene: (p, host, skin) => sceneFromRef(p, host, CITY_REF[skin]),
    sheets: (skin) => citySheets(skin),
    generatedMeta: (snap, label2) => snap ? `ground \xB7 ${label2} \xB7 seed ${snap.seed}` : "loading\u2026"
  }),
  interiors: (pixi, body) => makePage(pixi, body, {
    title: "Interiors",
    modes: SKIN_MODES,
    skins: skinList(INTERIOR_SKINS),
    grid: false,
    makeGenerated: (p, host, seed, skin) => createInteriorViewer(p, host, { skin, seed }),
    makeScene: (p, host, skin) => sceneFromRef(p, host, INTERIOR_REF[skin]),
    sheets: () => skinList(INTERIOR_SKINS).map((s) => ({ key: s.key, label: s.label, url: INTERIOR_SKINS[s.key].url })),
    generatedMeta: (snap, label2) => snap ? `${snap.rooms} rooms \xB7 ${label2} \xB7 seed ${snap.seed}` : "loading\u2026"
  }),
  towers: (pixi, body) => makePage(pixi, body, {
    title: "Towers",
    modes: SKIN_MODES,
    skins: skinList(TOWER_SKINS),
    grid: false,
    makeGenerated: (p, host, seed, skin) => createTowerViewer(p, host, { skin, seed }),
    makeScene: (p, host, skin) => sceneFromRef(p, host, TOWER_REF[skin]),
    sheets: () => skinList(TOWER_SKINS).map((s) => ({ key: s.key, label: s.label, url: TOWER_SKINS[s.key].url })),
    generatedMeta: (snap, label2) => snap ? `pyramid \xB7 battlement \xB7 ruin \xB7 ${label2} \xB7 seed ${snap.seed}` : "loading\u2026"
  })
};
var NAV = [
  ["gameworld", "Game World"],
  ["world", "World Map"],
  { group: "biome", label: "Biome", pages: [["plains", "Forgotten Plains"], ["desert", "Desolate Desert"], ["jungle", "Lost Jungle"], ["orc", "Orc Kingdom"], ["necropolis", "Necropolis"]] },
  ["cities", "Cities"],
  ["interiors", "Interiors"],
  ["towers", "Towers"]
];
var GROUP_OF = {};
for (const e of NAV) if (!Array.isArray(e)) for (const [k] of e.pages) GROUP_OF[k] = e.group;
function mountMapSandbox(pixi, host, opts = {}) {
  host.innerHTML = "";
  const pills = h("div", { class: "mapsandbox-pills" });
  const subpills = h("div", { class: "mapsandbox-pills mapsandbox-subpills", style: "display:none" });
  const body = h("div", { class: "mapsandbox-body" });
  const root = h(
    "div",
    { class: "mapsandbox" },
    h("header", { class: "mapsandbox-header" }, h("h1", {}, "Map"), pills),
    subpills,
    body
  );
  host.append(root);
  let current = null;
  const groups = {};
  const topBtns = [];
  function mountPage(key, pageOpts = opts) {
    try {
      current?.destroy?.();
    } catch {
    }
    body.innerHTML = "";
    current = PAGES[key](pixi, body, pageOpts);
  }
  const setTopActive = (key) => topBtns.forEach(([k, b]) => b.classList.toggle("active", k === key));
  for (const entry of NAV) {
    if (Array.isArray(entry)) {
      const [key, label2] = entry;
      const b = h("button", { "data-testid": `map-page-${key}`, onClick: () => selectPage(key) }, label2);
      pills.append(b);
      topBtns.push([key, b]);
    } else {
      const g = { btn: null, pages: entry.pages, active: entry.pages[0][0], subBtns: [], view: void 0, sheet: void 0 };
      g.btn = h("button", { "data-testid": `map-group-${entry.group}`, onClick: () => selectGroup(entry.group) }, entry.label);
      groups[entry.group] = g;
      pills.append(g.btn);
      topBtns.push([entry.group, g.btn]);
    }
  }
  function selectPage(key) {
    subpills.style.display = "none";
    setTopActive(key);
    mountPage(key);
  }
  function selectGroup(groupKey) {
    const g = groups[groupKey];
    setTopActive(groupKey);
    subpills.innerHTML = "";
    g.subBtns = g.pages.map(([k, label2]) => {
      const b = h("button", { "data-testid": `map-page-${k}`, onClick: () => selectChild(groupKey, k) }, label2);
      subpills.append(b);
      return [k, b];
    });
    subpills.style.display = "";
    selectChild(groupKey, g.active);
  }
  function selectChild(groupKey, childKey) {
    const g = groups[groupKey];
    g.active = childKey;
    g.subBtns.forEach(([k, b]) => b.classList.toggle("active", k === childKey));
    mountPage(childKey, { ...opts, view: g.view, onView: (v) => {
      g.view = v;
    }, sheet: g.sheet, onSheet: (s) => {
      g.sheet = s;
    } });
  }
  const initial = PAGES[opts.page] ? opts.page : "world";
  if (GROUP_OF[initial]) {
    groups[GROUP_OF[initial]].active = initial;
    selectGroup(GROUP_OF[initial]);
  } else selectPage(initial);
  return { destroy() {
    try {
      current?.destroy?.();
    } catch {
    }
    current = null;
    host.innerHTML = "";
  } };
}
export {
  mountMapSandbox
};
