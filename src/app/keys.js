// Every key the app answers, in one table, so no two jobs share a key and
// browser shortcuts (Cmd, Ctrl, Option) are never taken.
//
// Arrow keys are held keys: the rig moves while they are down (with Shift
// they rise, sink and turn instead of moving and stepping). + and - shrink the
// viewer into the set and grow it back, one step per press and smoothly while
// held. Everything else is a single press.

/** [action, key (letters lower case), shift: true | false | 'any', what it does] */
export const BINDINGS = [
  ['fullscreen', 'f', 'any', 'Full screen on and off'],
  ['details', 'd', 'any', 'Tracking details'],
  ['direction', 'v', 'any', 'View direction: Look around or True window'],
  ['recentre', 'r', 'any', 'Re-centre the view on where you sit'],
  ['settings', 's', 'any', 'Settings'],
  ['steady', 'c', 'any', 'Steady check'],
  // Shift is ignored for these, as before: some layouts need it for digits.
  ['scenePrev', '[', 'any', 'Previous scene'],
  ['sceneNext', ']', 'any', 'Next scene'],
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`scene${n}`, String(n), 'any', `Scene ${n}`]),
  ['forward', 'ArrowUp', false, 'Move forward'],
  ['back', 'ArrowDown', false, 'Move back'],
  ['left', 'ArrowLeft', false, 'Step left'],
  ['right', 'ArrowRight', false, 'Step right'],
  ['rise', 'ArrowUp', true, 'Rise'],
  ['sink', 'ArrowDown', true, 'Sink'],
  ['turnLeft', 'ArrowLeft', true, 'Turn left'],
  ['turnRight', 'ArrowRight', true, 'Turn right'],
  ['shrink', '+', 'any', 'Shrink into the set'],
  ['shrink', '=', 'any', 'Shrink into the set (the + key without Shift)'],
  ['grow', '-', 'any', 'Grow'],
  ['grow', '_', 'any', 'Grow (the - key with Shift)'],
  ['stationNext', 'n', false, 'Next place'],
  ['stationPrev', 'n', true, 'Previous place'],
  ['home', 'h', 'any', 'Back to the first place'],
  ['home', 'Home', 'any', 'Back to the first place (fn + left arrow)'],
  ['tour', 't', 'any', 'Guided tour, start and stop'],
  ['escape', 'Escape', 'any', 'Close the open panel, or stop the tour'],
];

/** Keys that move the rig while held. */
export const HELD = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

const norm = (key) => (typeof key === 'string' && key.length === 1 ? key.toLowerCase() : key);
const TABLE = new Map();
for (const [action, key, shift] of BINDINGS) {
  for (const sh of shift === 'any' ? [false, true] : [shift]) TABLE.set(`${norm(key)}|${sh}`, action);
}

/**
 * The action for a key event, or null. Keys with Cmd, Ctrl or Option belong
 * to the browser and the system (Escape excepted).
 * @param {{key:string, shiftKey?:boolean, metaKey?:boolean, ctrlKey?:boolean, altKey?:boolean}} e
 */
export function keyAction(e) {
  if (!e || typeof e.key !== 'string') return null;
  if (e.key === 'Escape') return 'escape';
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  return TABLE.get(`${norm(e.key)}|${!!e.shiftKey}`) ?? null;
}

/** Actions that move the rig (they work only in a scene with places). */
export const NAV_ACTIONS = new Set([
  'forward', 'back', 'left', 'right', 'rise', 'sink', 'turnLeft', 'turnRight',
  'shrink', 'grow', 'stationNext', 'stationPrev', 'home', 'tour',
]);

/**
 * Arrow keys belong to an open settings sheet (they scroll it) or scene menu
 * (they move in it), wherever the focus is: then they neither move the
 * window nor have their default prevented.
 * @param {{key:string}} e
 * @param {{sheetOpen?:boolean, menuOpen?:boolean}} panels
 */
export function arrowsTaken(e, { sheetOpen = false, menuOpen = false } = {}) {
  return HELD.has(e?.key) && (sheetOpen || menuOpen);
}

/**
 * Whether a key event belongs to the control it was typed into: text fields,
 * selects and sliders, and arrow keys on radio groups and menus, which move
 * between their options. Buttons keep the arrow keys free for moving.
 */
export function keyForControl(e) {
  const t = e?.target;
  if (!t || typeof t.closest !== 'function') return false;
  if (t.closest('input, select, textarea, [contenteditable="true"]')) return true;
  return HELD.has(e.key) && !!t.closest('[role="radiogroup"], [role="menu"]');
}
