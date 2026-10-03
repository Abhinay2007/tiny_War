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
var ROW_FOR = { "front-right": 0, "front-left": 1, "back-right": 2, "back-left": 3 };
var rowFor = (grid, facing) => grid[ROW_FOR[facing]] ?? grid[0];

// ../auto-battler/src/render/spriteScene.js
var SPEED = 3;
var PROJ_SPEED = 5;
var SCALE = 4;
var ROWS = 4;
var ARRIVE = SPEED;
var ANIM_SPEED = { idle: 0.12, walk: 0.18, attack: 0.22, dmg: 0.2, die: 0.16, jump: 0.2 };
var SCENE_ACTIONS = [
  { state: "attack", code: "Space", label: "Space", verb: "attack" },
  { state: "dmg", code: "KeyH", label: "H", verb: "hurt" },
  { state: "die", code: "KeyK", label: "K", verb: "die" },
  { state: "jump", code: "KeyJ", label: "J", verb: "jump" }
];
var STATE_KEYS = ["idle", "walk", ...SCENE_ACTIONS.map((a) => a.state), "attackDiagonal"];
var orthoRow = (d) => d.x > 0 ? 0 : d.x < 0 ? 1 : d.y > 0 ? 2 : 3;
var diagRow = (d) => d.y > 0 ? d.x > 0 ? 0 : 1 : d.x > 0 ? 2 : 3;
var usesAimedAttack = (c) => c?.attackVerb === "shoot" || !!c?.attackOrtho;
function createSpriteScene(pixi, host, opts = {}) {
  const { Application, Assets, AnimatedSprite, Graphics } = pixi;
  const urlFor = opts.urlFor || ((u) => u);
  const anim = { ...ANIM_SPEED, ...opts.anim || {} };
  const sliceGrid = (texture, cell) => sliceGridWith(pixi, texture, cell);
  let app = null;
  let sprite = null;
  let shadow = null;
  let overlay = null;
  let frames = null;
  let keys = { x: 0, y: 0 };
  let moveTarget = null;
  let action = null;
  let pendingAction = null;
  let dieHold = false;
  let side = "right";
  let depth = "front";
  let dir = { x: 1, y: 1 };
  let shoot = false;
  let applied = "";
  let extras = [];
  let effectsOn = true;
  let shadowsOn = true;
  let flying = [];
  let marker = null;
  let markerLife = 0;
  let currentKind = "idle";
  let lastAimKey = "";
  let changeCb = null;
  let destroyed = false;
  function snapshot() {
    return {
      kind: currentKind,
      facing: `${depth}-${side}`,
      aim: `${dir.x},${dir.y}`,
      shoot,
      moving: !!moveTarget || keys.x !== 0 || keys.y !== 0,
      x: sprite ? sprite.x : null,
      y: sprite ? sprite.y : null,
      toggles: { effects: effectsOn, shadows: shadowsOn }
    };
  }
  function emit() {
    if (changeCb) changeCb(snapshot());
  }
  const ready = (async () => {
    const a = new Application();
    await a.init({ background: 15524556, antialias: false, resizeTo: host });
    if (destroyed) {
      a.destroy();
      return;
    }
    app = a;
    app.canvas.setAttribute("data-testid", "pixi-canvas");
    app.canvas.style.touchAction = "none";
    app.canvas.addEventListener("pointerdown", onPointerDown);
    app.canvas.addEventListener("click", onPointerDown);
    host.appendChild(app.canvas);
    app.ticker.add(tick);
  })();
  function onPointerDown(e) {
    if (!app) return;
    const rect = app.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (e.clientX - rect.left) / rect.width * app.screen.width;
    const y = (e.clientY - rect.top) / rect.height * app.screen.height;
    moveTo(x, y);
  }
  function moveTo(x, y) {
    if (!app) return;
    const tx = Math.max(0, Math.min(app.screen.width, x));
    const ty = Math.max(0, Math.min(app.screen.height, y));
    moveTarget = { x: tx, y: ty };
    if (Graphics) {
      if (!marker) {
        marker = new Graphics();
        app.stage.addChildAt(marker, 0);
      }
      marker.clear();
      marker.circle(0, 0, 11).stroke({ color: 7035903, width: 2, alpha: 1 });
      marker.position.set(tx, ty);
      marker.alpha = 0.9;
      markerLife = 30;
    }
  }
  function tick(ticker) {
    const s = sprite;
    const f = frames;
    if (!s || !f) return;
    let vx = keys.x;
    let vy = keys.y;
    let usingTarget = false;
    let seekDX = 0;
    let seekDY = 0;
    if (vx === 0 && vy === 0 && moveTarget) {
      seekDX = moveTarget.x - s.x;
      seekDY = moveTarget.y - s.y;
      const d = Math.hypot(seekDX, seekDY);
      if (d <= ARRIVE) {
        s.x = moveTarget.x;
        s.y = moveTarget.y;
        moveTarget = null;
      } else {
        vx = seekDX;
        vy = seekDY;
        usingTarget = true;
      }
    }
    const wantMove = vx !== 0 || vy !== 0;
    if (pendingAction) {
      const pend = pendingAction;
      pendingAction = null;
      if (f[pend] && (action === null || dieHold)) {
        action = pend;
        dieHold = false;
        applied = "";
      }
    }
    if (dieHold && wantMove) {
      action = null;
      dieHold = false;
    }
    const acting = action !== null;
    if (!acting && wantMove) {
      let sgx, sgy;
      if (usingTarget) {
        sgx = Math.abs(seekDX) > 4 ? Math.sign(seekDX) : 0;
        sgy = Math.abs(seekDY) > 4 ? Math.sign(seekDY) : 0;
      } else {
        sgx = Math.sign(vx);
        sgy = Math.sign(vy);
      }
      if (sgx > 0) side = "right";
      else if (sgx < 0) side = "left";
      if (sgy > 0) depth = "front";
      else if (sgy < 0) depth = "back";
      if (sgx || sgy) dir = { x: sgx, y: sgy };
      const len = Math.hypot(vx, vy) || 1;
      const step = SPEED * ticker.deltaTime;
      s.x += vx / len * step;
      s.y += vy / len * step;
      const halfW = s.width / 2;
      const halfH = s.height / 2;
      s.x = Math.max(halfW, Math.min(app.screen.width - halfW, s.x));
      s.y = Math.max(halfH, Math.min(app.screen.height - halfH, s.y));
    }
    const aimKey = `${dir.x},${dir.y}`;
    if (aimKey !== lastAimKey) {
      lastAimKey = aimKey;
      emit();
    }
    if (shadow) {
      shadow.x = s.x;
      shadow.y = s.y;
    }
    if (overlay?.visible) {
      overlay.x = s.x;
      overlay.y = s.y;
    }
    if (marker && markerLife > 0) {
      markerLife -= ticker.deltaTime;
      const t = Math.max(0, markerLife / 30);
      marker.alpha = t * 0.9;
      marker.scale.set(1 + (1 - t) * 0.6);
    }
    for (let i = flying.length - 1; i >= 0; i--) {
      const fl = flying[i];
      fl.sprite.x += fl.dx * PROJ_SPEED * ticker.deltaTime;
      fl.sprite.y += fl.dy * PROJ_SPEED * ticker.deltaTime;
      if (!fl.impFired && fl.impGrid) {
        const dist = Math.hypot(fl.sprite.x - fl.startX, fl.sprite.y - fl.startY);
        if (dist > 150) {
          fl.impFired = true;
          const imp = new AnimatedSprite(fl.impGrid[0]);
          imp.anchor.set(0.5);
          imp.scale.set(SCALE);
          imp.loop = false;
          imp.animationSpeed = anim.attack;
          imp.x = fl.sprite.x;
          imp.y = fl.sprite.y;
          imp.onComplete = () => {
            if (imp.parent) imp.parent.removeChild(imp);
            imp.destroy();
          };
          app.stage.addChild(imp);
          imp.gotoAndPlay(0);
        }
      }
      const os = fl.sprite.x < -128 || fl.sprite.x > app.screen.width + 128 || fl.sprite.y < -128 || fl.sprite.y > app.screen.height + 128;
      if (os) {
        if (fl.sprite.parent) fl.sprite.parent.removeChild(fl.sprite);
        fl.sprite.destroy();
        flying.splice(i, 1);
      }
    }
    const kind = acting ? action : wantMove ? "walk" : "idle";
    currentKind = kind;
    let fr, key;
    if (kind === "attack" && shoot) {
      const d = dir;
      const useDiag = d.x !== 0 && d.y !== 0 && !!f.attackDiagonal;
      const grid = useDiag ? f.attackDiagonal : f.attack;
      const row = useDiag ? diagRow(d) : orthoRow(d);
      fr = grid[row] ?? grid[0];
      key = `shoot:${useDiag ? "d" : "o"}${row}`;
    } else {
      const facing = `${depth}-${side}`;
      fr = rowFor(f[kind], facing);
      key = `${kind}:${facing}`;
    }
    if (key !== applied) {
      applied = key;
      const oneShot = kind !== "idle" && kind !== "walk";
      s.textures = fr;
      s.loop = !oneShot;
      s.animationSpeed = anim[kind] ?? (oneShot ? anim.attack : anim.walk);
      s.gotoAndPlay(0);
      const actionKey = action ?? kind;
      const facing = `${depth}-${side}`;
      if (shadow) {
        let shadGrid;
        if (kind === "attack" && shoot) {
          const d = dir;
          const useDiag = d.x !== 0 && d.y !== 0 && !!f["shd:attackDiagonal"];
          shadGrid = useDiag ? f["shd:attackDiagonal"] : f["shd:attack"];
          if (shadGrid) {
            const row = useDiag ? diagRow(d) : orthoRow(d);
            shadow.textures = shadGrid[row] ?? shadGrid[0];
          }
        } else {
          shadGrid = f["shd:" + actionKey];
          if (shadGrid) shadow.textures = rowFor(shadGrid, facing);
        }
        if (shadGrid && shadowsOn) {
          shadow.loop = s.loop;
          shadow.animationSpeed = s.animationSpeed;
          shadow.visible = true;
          shadow.gotoAndPlay(0);
        } else {
          shadow.visible = false;
        }
      }
      if (overlay) {
        const effGrid = effectsOn && f["eff:" + actionKey];
        if (effGrid && oneShot) {
          overlay.textures = rowFor(effGrid, facing);
          overlay.loop = false;
          overlay.animationSpeed = s.animationSpeed;
          overlay.x = s.x;
          overlay.y = s.y;
          overlay.visible = true;
          overlay.gotoAndPlay(0);
        } else {
          overlay.visible = false;
        }
      }
      if (oneShot && effectsOn) {
        const projGrid = f["proj:" + actionKey];
        if (projGrid) {
          const d = dir;
          const row = orthoRow(d);
          const proj = new AnimatedSprite(projGrid[row] ?? projGrid[0]);
          proj.anchor.set(0.5);
          proj.scale.set(SCALE);
          proj.loop = true;
          proj.animationSpeed = anim.attack;
          proj.x = s.x;
          proj.y = s.y;
          proj.gotoAndPlay(0);
          app.stage.addChild(proj);
          const len = Math.hypot(d.x, d.y) || 1;
          flying.push({
            sprite: proj,
            dx: d.x / len,
            dy: d.y / len,
            startX: s.x,
            startY: s.y,
            impGrid: f["imp:" + actionKey] ?? null,
            impFired: false
          });
        }
      }
    }
  }
  async function setCharacter(active) {
    await ready;
    if (!app || !active) return;
    const sheets = [
      ...STATE_KEYS.filter((k) => active[k]).map((k) => ({ gridKey: k, url: active[k], type: "body" })),
      ...(active.extras ?? []).map((e) => ({ gridKey: "x:" + e.key, url: e.url, type: "body" })),
      ...active.attackEffect ? [{ gridKey: "eff:attack", url: active.attackEffect, type: "eff" }] : [],
      ...active.attackProjectile ? [{ gridKey: "proj:attack", url: active.attackProjectile, type: "proj" }] : [],
      ...active.attackImpact ? [{ gridKey: "imp:attack", url: active.attackImpact, type: "imp" }] : [],
      ...Object.entries(active.shadows ?? {}).map(([k, url]) => ({ gridKey: "shd:" + k, url, type: "body" })),
      ...(active.extras ?? []).flatMap((e) => [
        e.effect ? { gridKey: "eff:x:" + e.key, url: e.effect, type: "eff" } : null,
        e.projectile ? { gridKey: "proj:x:" + e.key, url: e.projectile, type: "proj" } : null,
        e.impact ? { gridKey: "imp:x:" + e.key, url: e.impact, type: "imp" } : null,
        e.shadow ? { gridKey: "shd:x:" + e.key, url: e.shadow, type: "body" } : null
      ].filter(Boolean))
    ];
    const texs = await Promise.all(sheets.map((s) => Assets.load(urlFor(s.url)).then((t) => t, () => null)));
    if (!app) return;
    const idleIdx = sheets.findIndex((s) => s.gridKey === "idle");
    if (idleIdx < 0 || !texs[idleIdx]) return;
    const grids = {};
    const cell = cellOf(texs[idleIdx].source.height);
    sheets.forEach((s, i) => {
      const t = texs[i];
      if (!t) return;
      t.source.scaleMode = "nearest";
      if (s.type === "proj") grids[s.gridKey] = sliceGrid(t, Math.max(1, Math.round(t.source.height / ROWS)));
      else if (s.type === "imp") grids[s.gridKey] = sliceGrid(t, Math.max(1, t.source.height));
      else grids[s.gridKey] = sliceGrid(t, cell);
    });
    frames = grids;
    extras = active.extras ?? [];
    shoot = usesAimedAttack(active);
    action = null;
    pendingAction = null;
    dieHold = false;
    applied = "";
    lastAimKey = "";
    const startFrames = rowFor(grids.idle, `${depth}-${side}`);
    if (!sprite) {
      const shd = new AnimatedSprite(startFrames);
      shd.anchor.set(0.5);
      shd.scale.set(SCALE);
      shd.loop = true;
      shd.visible = false;
      shd.animationSpeed = anim.idle;
      shd.x = app.screen.width / 2;
      shd.y = app.screen.height / 2;
      app.stage.addChild(shd);
      shadow = shd;
      const s = new AnimatedSprite(startFrames);
      s.anchor.set(0.5);
      s.scale.set(SCALE);
      s.loop = true;
      s.animationSpeed = anim.idle;
      s.x = app.screen.width / 2;
      s.y = app.screen.height / 2;
      s.onComplete = () => {
        if (action === "die") dieHold = true;
        else action = null;
      };
      app.stage.addChild(s);
      s.gotoAndPlay(0);
      sprite = s;
      const ov = new AnimatedSprite(startFrames);
      ov.anchor.set(0.5);
      ov.scale.set(SCALE);
      ov.loop = false;
      ov.visible = false;
      ov.animationSpeed = anim.attack;
      ov.onComplete = () => {
        ov.visible = false;
      };
      app.stage.addChild(ov);
      overlay = ov;
    } else {
      const s = sprite;
      s.loop = true;
      s.textures = startFrames;
      s.animationSpeed = anim.idle;
      s.gotoAndPlay(0);
      if (shadow) shadow.visible = false;
      if (overlay) overlay.visible = false;
      for (const fl of flying) {
        if (fl.sprite.parent) fl.sprite.parent.removeChild(fl.sprite);
        fl.sprite.destroy();
      }
      flying = [];
    }
    emit();
  }
  function setVelocity(v) {
    keys = { x: v?.x || 0, y: v?.y || 0 };
    if (keys.x || keys.y) moveTarget = null;
  }
  function triggerAction(stateKey) {
    if (stateKey) pendingAction = stateKey;
  }
  function setToggles(t) {
    if (t && "effects" in t) effectsOn = !!t.effects;
    if (t && "shadows" in t) {
      shadowsOn = !!t.shadows;
      if (shadow && !shadowsOn) shadow.visible = false;
    }
    emit();
  }
  return {
    ready,
    setCharacter,
    setVelocity,
    triggerAction,
    moveTo,
    setToggles,
    getSnapshot: snapshot,
    onChange: (cb) => {
      changeCb = cb;
    },
    resize: () => {
      if (app) app.resize();
    },
    // Re-place the character at the centre of the current canvas — used by hosts
    // that mount the stage in a hidden/0-size tab and reveal it later (the Space).
    recenter: () => {
      if (!app || !sprite) return;
      sprite.x = app.screen.width / 2;
      sprite.y = app.screen.height / 2;
      if (shadow) {
        shadow.x = sprite.x;
        shadow.y = sprite.y;
      }
      moveTarget = null;
    },
    destroy: () => {
      destroyed = true;
      const a = app;
      app = null;
      if (a) {
        a.canvas.removeEventListener("pointerdown", onPointerDown);
        a.canvas.removeEventListener("click", onPointerDown);
        a.destroy({ removeView: true });
      }
      sprite = shadow = overlay = frames = marker = null;
      flying = [];
    }
  };
}

// ../auto-battler/src/render/spritePlayground.js
var COMPASS_CELLS = [
  { dir: "-1,-1", glyph: "\u2196" },
  { dir: "0,-1", glyph: "\u2191" },
  { dir: "1,-1", glyph: "\u2197" },
  { dir: "-1,0", glyph: "\u2190" },
  { dir: "0,0", glyph: "\xB7" },
  { dir: "1,0", glyph: "\u2192" },
  { dir: "-1,1", glyph: "\u2199" },
  { dir: "0,1", glyph: "\u2193" },
  { dir: "1,1", glyph: "\u2198" }
];
var ACTION_BY_CODE = Object.fromEntries(SCENE_ACTIONS.map((a) => [a.code, a.state]));
function el(tag, props = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) if (kid != null) n.append(kid);
  return n;
}
var flatList = (packs) => (packs ?? []).flatMap((p) => p.characters ?? []);
function mountSpritePlayground(pixi, host, opts = {}) {
  const packs = opts.packs ?? [];
  const all = flatList(packs);
  let active = all.find((c) => c.slug === opts.initialSlug) ?? all[0] ?? null;
  let selIdx = 0;
  const canvasEl = el("div", { class: "movement-canvas" });
  const stage = el("div", { class: "movement-stage" }, [canvasEl]);
  const charLinks = /* @__PURE__ */ new Map();
  const picker = el("aside", { class: "movement-picker" }, [
    el("h2", { class: "movement-picker-title" }, "Characters"),
    ...packs.map((p) => {
      const here = (p.characters ?? []).some((c) => c.slug === active?.slug);
      const lis = (p.characters ?? []).map((c) => {
        const a = el("a", {
          class: "movement-char",
          href: "#",
          dataset: { slug: c.slug },
          onclick: (e) => {
            e.preventDefault();
            setCharacter(c.slug);
          }
        }, c.name);
        charLinks.set(c.slug, a);
        return el("li", {}, a);
      });
      return el("details", { class: "movement-pack", ...here ? { open: "" } : {} }, [
        el("summary", {}, p.name),
        el("ul", {}, lis)
      ]);
    })
  ]);
  const view = el("div", { class: "movement-view" }, [picker, stage]);
  host.appendChild(view);
  const scene = createSpriteScene(pixi, canvasEl, { urlFor: opts.urlFor });
  let compassEl = null;
  let compassLabel = null;
  scene.onChange((snap) => {
    if (!compassEl) return;
    for (const cell of compassEl.children) {
      if (cell.dataset.dir != null) cell.classList.toggle("on", cell.dataset.dir === snap.aim);
    }
    const [x, y] = snap.aim.split(",").map(Number);
    const diag = x !== 0 && y !== 0;
    if (compassLabel) compassLabel.textContent = `${snap.aim}  ${diag ? "diag" : "ortho"} r${diag ? diagRow({ x, y }) : orthoRow({ x, y })}`;
  });
  function renderChrome() {
    stage.querySelectorAll(".movement-hint,.movement-compass-wrap,.movement-extras").forEach((n) => n.remove());
    compassEl = compassLabel = null;
    if (!active) return;
    if (usesAimedAttack(active)) {
      compassEl = el(
        "div",
        { class: "movement-compass" },
        COMPASS_CELLS.map((c) => el("span", { dataset: { dir: c.dir } }, c.glyph))
      );
      compassLabel = el("div", { class: "movement-compass-label" }, "1,1 diag r0");
      stage.append(el("div", { class: "movement-compass-wrap", "aria-hidden": "true" }, [compassEl, compassLabel]));
    }
    const hint = el("div", { class: "movement-hint", "aria-hidden": "true" }, [
      el("span", { class: "movement-key" }, "WASD"),
      " move \xB7 ",
      el("span", { class: "movement-key" }, "tap"),
      " walk there"
    ]);
    if (active.shadows) hint.append(" \xB7 ", toggle("shadows", true, (on) => scene.setToggles({ shadows: on })));
    if ((active.extras?.length ?? 0) > 0) hint.append(" \xB7 ", toggle("effects", true, (on) => scene.setToggles({ effects: on })));
    for (const a of SCENE_ACTIONS) {
      if (!active[a.state]) continue;
      const verb = a.state === "attack" && active.attackVerb ? active.attackVerb : a.verb;
      hint.append(" \xB7 ", el("span", { class: "movement-key" }, a.label), " " + verb);
      if (a.state === "attack") {
        for (const [f, t] of [["attackEffect", "e"], ["attackProjectile", "p"], ["attackImpact", "i"]])
          if (active[f]) hint.append(el("span", { class: "movement-extra-tag" }, t));
      }
    }
    stage.append(hint);
    if ((active.extras?.length ?? 0) > 0) {
      const list = el("ul", { class: "movement-extras-list" }, active.extras.map((ex, i) => {
        const btn = el("button", {
          type: "button",
          class: "movement-extra" + (i === selIdx ? " active" : ""),
          dataset: { i },
          onclick: () => {
            selectExtra(i);
            scene.triggerAction("x:" + ex.key);
          }
        }, [
          i < 9 ? el("span", { class: "movement-extra-num" }, String(i + 1)) : null,
          ex.name,
          ...["effect", "projectile", "impact"].filter((k) => ex[k]).map((k) => el("span", { class: "movement-extra-tag" }, k[0]))
        ]);
        return el("li", {}, btn);
      }));
      stage.append(el("div", { class: "movement-extras" }, [
        el("div", { class: "movement-extras-hint", html: 'extra animations \xB7 <span class="movement-key">[</span> <span class="movement-key">]</span> cycle \xB7 <span class="movement-key">Enter</span> play \xB7 <span class="movement-key">1\u20139</span> quick' }),
        list
      ]));
    }
  }
  function toggle(label, checked, onChange) {
    const cb = el("input", { type: "checkbox", ...checked ? { checked: "" } : {} });
    cb.addEventListener("change", () => onChange(cb.checked));
    return el("label", { class: "movement-effects-toggle" }, [cb, " " + label]);
  }
  function selectExtra(i) {
    selIdx = i;
    stage.querySelectorAll(".movement-extra").forEach((b) => b.classList.toggle("active", +b.dataset.i === i));
  }
  function setCharacter(slug) {
    const c = all.find((x) => x.slug === slug);
    if (!c) return;
    active = c;
    selIdx = 0;
    charLinks.forEach((a2, s) => a2.classList.toggle("active", s === slug));
    const a = charLinks.get(slug);
    const det = a && a.closest("details");
    if (det) det.open = true;
    scene.setCharacter(c);
    renderChrome();
  }
  const held = { x: /* @__PURE__ */ new Set(), y: /* @__PURE__ */ new Set() };
  const applyVel = () => scene.setVelocity({ x: held.x.has(1) - held.x.has(-1), y: held.y.has(1) - held.y.has(-1) });
  const axis = (e) => {
    const k = e.key.toLowerCase();
    if (k === "a" || k === "arrowleft") return ["x", -1];
    if (k === "d" || k === "arrowright") return ["x", 1];
    if (k === "w" || k === "arrowup") return ["y", -1];
    if (k === "s" || k === "arrowdown") return ["y", 1];
    return null;
  };
  const blocked = () => {
    const a = document.activeElement;
    return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable) || view.offsetParent === null;
  };
  const onKeyDown = (e) => {
    if (blocked()) return;
    const c = axis(e);
    if (c) {
      e.preventDefault();
      held[c[0]].add(c[1]);
      applyVel();
      return;
    }
    const action = ACTION_BY_CODE[e.code];
    if (action) {
      e.preventDefault();
      if (!e.repeat) scene.triggerAction(action);
      return;
    }
    const ex = active?.extras ?? [];
    if (!ex.length) return;
    if (e.code === "BracketLeft") {
      e.preventDefault();
      selectExtra((selIdx - 1 + ex.length) % ex.length);
      return;
    }
    if (e.code === "BracketRight") {
      e.preventDefault();
      selectExtra((selIdx + 1) % ex.length);
      return;
    }
    if (e.code === "Enter") {
      e.preventDefault();
      if (!e.repeat) scene.triggerAction("x:" + ex[selIdx].key);
      return;
    }
    const digit = e.code.match(/^Digit([1-9])$/);
    if (digit) {
      const i = +digit[1] - 1;
      if (i < ex.length) {
        e.preventDefault();
        selectExtra(i);
        scene.triggerAction("x:" + ex[i].key);
      }
    }
  };
  const onKeyUp = (e) => {
    if (blocked()) return;
    const c = axis(e);
    if (c) {
      held[c[0]].delete(c[1]);
      applyVel();
    }
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  renderChrome();
  if (active) setCharacter(active.slug);
  return {
    setCharacter,
    getSnapshot: () => scene.getSnapshot(),
    resize: () => scene.resize(),
    recenter: () => scene.recenter?.(),
    destroy: () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      scene.destroy();
      if (view.parentNode) view.parentNode.removeChild(view);
    }
  };
}
export {
  mountSpritePlayground
};
