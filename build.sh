#!/usr/bin/env bash
# Bundle the shared, framework-agnostic JS modules from the auto-battler repo into
# this Space's web/ dir. Pixi is INJECTED by the caller (web/tiny.js imports it
# from a CDN and passes it in), so none of these modules import Pixi — nothing to
# mark external. Run from the tiny-army dir with ../auto-battler alongside.
#
#   ./build.sh          # uses ../auto-battler
#   AB=/path ./build.sh # override the source repo
set -euo pipefail
AB="${AB:-../auto-battler}"

# 1. JS engine/render core → bundled (Pixi injected, so nothing external).
npx --yes esbuild "$AB/src/engine/teamBattle.js"      --bundle --format=esm --outfile=web/engine.js
npx --yes esbuild "$AB/src/render/spriteSheet.js"     --bundle --format=esm --outfile=web/sheet.js
npx --yes esbuild "$AB/src/render/spriteScene.js"     --bundle --format=esm --outfile=web/scene.js
npx --yes esbuild "$AB/src/render/spritePlayground.js" --bundle --format=esm --outfile=web/playground.js
# Classes sandbox — the full page (picker + WASD combat + customize) as one bundle;
# pulls in the shared combatRenderer + engine. Pixi injected by web/tiny.js.
npx --yes esbuild "$AB/src/render/classesSandbox.js"   --bundle --format=esm --outfile=web/classesSandbox.js
npx --yes esbuild "$AB/src/render/enemiesSandbox.js"   --bundle --format=esm --outfile=web/enemiesSandbox.js
# Map sandbox — the whole Map page (pill switcher + all six sub-pages: World Map / Necropolis /
# Orc Kingdom / Forgotten Plains / Interiors / Towers, each with Generated/Tilesheet/Reference).
# Pulls in every map renderer + the shared chunked-map engine. Pixi injected by web/tiny.js.
npx --yes esbuild "$AB/src/render/mapSandbox.js"       --bundle --format=esm --outfile=web/mapSandbox.js
# Game page (the Space's "Battle" tab) — Forgotten Plains roam + on-map real-time combat. Drops a
# persona on the map, walks it via A*, (later) fights nearby enemies. Pulls in the chunked-map +
# combat engine + sim. This is a Space-only surface; auto-battler's own Combo-Battler game is untouched.
npx --yes esbuild "$AB/src/render/comboBattler.js"     --bundle --format=esm --outfile=web/comboBattler.js

# 2. App shell (nav IR + sidebar CSS/JS) + the playground chrome CSS → copied
#    verbatim, so they can't drift from the React app, which renders the same files.
mkdir -p web/shell
cp "$AB/src/shell/nav.json" "$AB/src/shell/sidebar.css" "$AB/src/shell/sidebar.js" web/shell/
# Tiny-army-only label override: the "Battle" page here is the new Game surface (Forgotten Plains
# roam + on-map combat), not auto-battler's React Combo-Battler. Rename just the sidebar label;
# the Gradio tab ("Battle"/#battle-stage) and auto-battler's own nav.json are left untouched.
sed -i 's/"label": "Combo-Battler"/"label": "Game"/' web/shell/nav.json
# Design tokens — the shared component CSS (classes/worldmap/spriteScene) references the global
# :root palette/fonts/shadows defined in the React app's styles.css. Extract just that :root block
# (NOT the app-specific selectors) so the Space's components render with auto-battler's look.
awk '/:root[[:space:]]*\{/{f=1} f{print} f&&/^\}/{exit}' "$AB/src/styles.css" > web/shell/tokens.css
cp "$AB/src/render/spriteScene.css" web/shell/spriteScene.css
# Scope the sandbox component CSS under its stage id(s) (native CSS nesting). Gradio's own
# `.gradio-container-<ver> button` / `… *` base resets (specificity 0,1,1 / 0,1,0) otherwise
# outrank the components' single-class rules and strip their button/control backgrounds, borders
# and padding. Adding the stage id gives every rule an id of specificity so it wins. Only the
# Space's copies are wrapped — auto-battler loads the files unscoped, so the source is untouched.
{
  echo '#classes-stage, #enemies-stage {'
  cat "$AB/src/views/classes.css"
  # The selected-skill detail card reuses CBGame's .cbgame-skill-* component (built by
  # classes/enemiesSandbox.js), but that family is styled in styles.css — NOT classes.css. Pull
  # just those rules in (brace-balanced, by selector prefix) so the card's dark background, tone
  # tags, trigger pills and effect rows match the React app.
  awk '!r && /^\.cbgame-skill-/{r=1;d=0} r{print; d+=gsub(/\{/,"{"); d-=gsub(/\}/,"}"); if(d<=0 && /\}/)r=0}' "$AB/src/styles.css"
  echo '}'
} > web/shell/classes.css
{ echo '#worldmap-stage {'; cat "$AB/src/views/worldmap.css"; echo '}'; } > web/shell/worldmap.css

# 3. Assets → use auto-battler's FULL character manifest (so the Space lists every
#    character, like the app) and curate every sheet it references (~1 MB).
cp "$AB/public/assets/characters.json" web/assets/characters.json
# Classes sandbox data: the effects catalogue + the class config (sprite/anim/skill
# choices). Served at /sprites/* (web/assets is mounted there); tiny.js fetches them.
cp "$AB/public/assets/effects.json" web/assets/effects.json
cp "$AB/public/classes.json" web/assets/classes.json
cp "$AB/public/enemies.json" web/assets/enemies.json
# Emote sheet (Minifantasy UI Overhaul "Character_Emotions") for the on-map condition emotes.
# Served at /sprites/emotes.png; comboBattler slices it as an 8×8 grid (src/render/emotes.js).
cp "$AB/public/assets/minifantasy/Minifantasy_UI _Overhaul_v1.0/_Minifantasy_UI_Overhaul_Assets/_General_UI_Resources/Character_Emotions/_Emotions.png" web/assets/emotes.png
# Map assets: dump the manifest (MAP_ASSET_URLS — assembled from the map renderers + configs in
# src/render/mapConfigs.js so it can't drift) and curate exactly those PNGs (tilesets / props /
# premade-scene layers / interior+tower skins, ~105 files). No whole-pack copy.
AB_ABS="$(cd "$AB" && pwd)"
node --input-type=module -e "import {MAP_ASSET_URLS} from 'file://$AB_ABS/src/render/mapConfigs.js'; for (const u of MAP_ASSET_URLS) console.log(u)" > /tmp/tac-map-assets.txt
AB="$AB" python3 curate_assets.py /tmp/tac-map-assets.txt

# 4. /gw icons the Classes sandbox shows — just the ~44 CB skill icons (NOT all
#    1484 GW icons) + the condition pips. Served at /gw (mounted in app.py).
AB_ABS="$(cd "$AB" && pwd)"
mkdir -p web/gw/skills web/gw/icons
cp "$AB"/public/gw/icons/*.jpg web/gw/icons/ 2>/dev/null || true
node --input-type=module -e "import {CB_SKILLS} from 'file://$AB_ABS/src/engine/skills.js'; for (const s of CB_SKILLS) console.log(s.id)" \
  | while IFS= read -r id; do cp "$AB/public/gw/skills/$id.jpg" web/gw/skills/ 2>/dev/null || true; done

echo "synced web/{engine,sheet,scene}.js + web/shell/* + assets from $AB"
