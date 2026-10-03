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
var rowFramesWith = (pixi, texture, row = 0) => {
  const g = sliceGridWith(pixi, texture);
  return g[row] ?? g[0];
};
var ANIM = { idle: 0.12, walk: 0.18, attack: 0.3, dmg: 0.25, die: 0.28 };
var ROW_FOR = { "front-right": 0, "front-left": 1, "back-right": 2, "back-left": 3 };
var rowFor = (grid, facing) => grid[ROW_FOR[facing]] ?? grid[0];
var facingFor = (faceX, faceY) => (faceY < 0 ? "back" : "front") + "-" + (faceX < 0 ? "left" : "right");
export {
  ANIM,
  ROW_FOR,
  SHEET_ROWS,
  cellOf,
  facingFor,
  rowFor,
  rowFramesWith,
  sliceGridWith
};
