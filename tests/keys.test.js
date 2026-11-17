// Keys (src/app/keys.js) and navigation input (src/app/nav-input.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BINDINGS, keyAction, keyForControl, arrowsTaken, NAV_ACTIONS, HELD } from '../src/app/keys.js';
import { NavInput } from '../src/app/nav-input.js';
import { RigMotion } from '../src/core/rig-motion.js';
import { normalizeNav } from '../src/core/rig.js';

const press = (key, o = {}) => ({ key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...o });

test('keys: no two jobs share a key', () => {
  const seen = new Map();
  for (const [action, key, shift] of BINDINGS) {
    for (const sh of shift === 'any' ? [false, true] : [shift]) {
      const k = `${key.length === 1 ? key.toLowerCase() : key}|${sh}`;
      assert.ok(!seen.has(k) || seen.get(k) === action, `${k} is both ${seen.get(k)} and ${action}`);
      seen.set(k, action);
    }
  }
});

test('keys: every binding does what the table says', () => {
  for (const [action, key, shift] of BINDINGS) {
    for (const sh of shift === 'any' ? [false, true] : [shift]) {
      assert.equal(keyAction(press(sh && key.length === 1 ? key.toUpperCase() : key, { shiftKey: sh })), action, `${key} shift ${sh}`);
    }
  }
});

test('keys: the existing keys keep their jobs; the new ones are free of them', () => {
  const old = { f: 'fullscreen', d: 'details', v: 'direction', r: 'recentre', s: 'settings', c: 'steady', '[': 'scenePrev', ']': 'sceneNext', 1: 'scene1', 2: 'scene2', Escape: 'escape' };
  for (const [k, a] of Object.entries(old)) assert.equal(keyAction(press(k)), a, k);
  // The suggested movement keys.
  assert.equal(keyAction(press('ArrowUp')), 'forward');
  assert.equal(keyAction(press('ArrowDown')), 'back');
  assert.equal(keyAction(press('ArrowLeft')), 'left');
  assert.equal(keyAction(press('ArrowRight')), 'right');
  assert.equal(keyAction(press('ArrowUp', { shiftKey: true })), 'rise');
  assert.equal(keyAction(press('ArrowLeft', { shiftKey: true })), 'turnLeft');
  assert.equal(keyAction(press('+', { shiftKey: true })), 'shrink', '+ shrinks the viewer into the set');
  assert.equal(keyAction(press('=')), 'shrink', 'the + key without Shift');
  assert.equal(keyAction(press('-')), 'grow');
  assert.equal(keyAction(press('t')), 'tour');
  assert.equal(keyAction(press('n')), 'stationNext');
  assert.equal(keyAction(press('N', { shiftKey: true })), 'stationPrev');
  assert.equal(keyAction(press('Home')), 'home');
  assert.equal(keyAction(press('h')), 'home');
  // Old letters never became movement.
  for (const k of 'fdvrsc[]123456789') assert.ok(!NAV_ACTIONS.has(keyAction(press(k))), k);
});

test('keys: Cmd, Ctrl and Option combinations belong to the browser and the system', () => {
  for (const [, key] of BINDINGS) {
    if (key === 'Escape') continue;
    for (const mod of ['metaKey', 'ctrlKey', 'altKey']) assert.equal(keyAction(press(key, { [mod]: true })), null, `${mod} + ${key}`);
  }
  assert.equal(keyAction(press('Escape', { metaKey: true })), 'escape');
  assert.equal(keyAction(press('q')), null);
  assert.equal(keyAction(press(' ')), null, 'space is free');
  assert.equal(keyAction({}), null);
});

test('keys: typing in a field, and arrows on a radio group or menu, stay with that control', () => {
  const el = (sel) => ({ closest: (s) => (s.split(',').some((p) => sel.includes(p.trim())) ? {} : null) });
  assert.equal(keyForControl({ key: 'ArrowUp', target: el(['input']) }), true);
  assert.equal(keyForControl({ key: 't', target: el(['select']) }), true);
  assert.equal(keyForControl({ key: 'ArrowLeft', target: el(['[role="radiogroup"]']) }), true);
  assert.equal(keyForControl({ key: 'ArrowDown', target: el(['[role="menu"]']) }), true);
  assert.equal(keyForControl({ key: 's', target: el(['[role="radiogroup"]']) }), false, 'letters still work from a radio group');
  assert.equal(keyForControl({ key: 'ArrowUp', target: el([]) }), false, 'a focused button leaves the arrows free');
  assert.equal(keyForControl({ key: 'ArrowUp', target: null }), false);
});

// ------------------------------------------------------------------ input

const NAV = normalizeNav({
  stations: [{ id: 'a', title: 'A', pose: { position: [0, 0, 0] } }, { id: 'b', title: 'B', pose: { position: [0, 0, -1], scale: 0.5 } }],
  bounds: { min: [-5, -5, -5], max: [5, 5, 5] },
  scale: [0.1, 2],
});

function setup({ enabled = true } = {}) {
  const motion = new RigMotion();
  motion.setNav(NAV);
  const canvas = { setPointerCapture() {} };
  const moved = [];
  const panels = { sheetOpen: false, menuOpen: false };
  const input = new NavInput({ motion, canvas, enabled: () => enabled, onMove: (w) => moved.push(w), arrowsTaken: () => panels.sheetOpen || panels.menuOpen });
  return { motion, input, canvas, moved, panels };
}

const settle = (m, s = 3) => { for (let i = 0; i < s * 60; i++) m.update(1 / 60); };

test('input: held arrows become rates; Shift turns them into rise and turn; key up stops them', () => {
  const { input } = setup();
  assert.equal(input.rates(0), null);
  input.keyDown({ ...press('ArrowUp'), timeStamp: 0 });
  input.keyDown({ ...press('ArrowLeft'), timeStamp: 0 });
  let r = input.rates(100);
  assert.equal(r.forward, 1);
  assert.equal(r.right, -1);
  assert.equal(r.turn, 0);
  input.keyDown({ ...press('Shift', { shiftKey: true }), timeStamp: 120 });
  r = input.rates(130);
  assert.equal(r.forward, 0);
  assert.equal(r.up, 1);
  assert.equal(r.turn, 1, 'Shift + left turns left');
  assert.ok(input.rates(3000).boost > 2, 'a long hold speeds up');
  input.keyUp(press('ArrowUp', { shiftKey: true }));
  input.keyUp(press('ArrowLeft', { shiftKey: true }));
  assert.equal(input.rates(3100), null);
});

test('input: Cmd and leaving the page release held keys (macOS sends no key up under Cmd)', () => {
  const { input } = setup();
  input.keyDown({ ...press('ArrowUp'), timeStamp: 0 });
  input.keyDown({ ...press('Meta', { metaKey: true }), timeStamp: 10 });
  assert.equal(input.rates(20), null);
  input.keyDown({ ...press('ArrowDown'), timeStamp: 30 });
  input.release();
  assert.equal(input.rates(40), null);
});

test('input: + and - step the scale once per press, and run smoothly while held', () => {
  const { motion, input } = setup();
  input.keyDown({ ...press('+', { shiftKey: true }), timeStamp: 0 });
  input.keyDown({ ...press('+', { shiftKey: true }), timeStamp: 40, repeat: true });
  settle(motion);
  assert.ok(Math.abs(motion.pose.scale - 0.8) < 1e-3, `one press: x0.8, got ${motion.pose.scale}`);
  input.keyUp(press('+'));
  input.keyDown({ ...press('-'), timeStamp: 5000 });
  for (let t = 5000; t < 6000; t += 1000 / 60) motion.update(1 / 60, input.rates(t));
  input.keyUp(press('-'));
  settle(motion);
  assert.ok(motion.pose.scale > 1.2, `held - grows: ${motion.pose.scale}`);
});

test('input: nothing moves while a panel needs the input, or in a scene without places', () => {
  const a = setup({ enabled: false });
  assert.equal(a.input.keyDown({ ...press('ArrowUp'), timeStamp: 0 }), false);
  a.input.pointerDown({ button: 0, isPrimary: true, pointerId: 1, clientX: 0, clientY: 0 });
  assert.equal(a.input.dragging, false);
  const b = setup();
  b.motion.setNav(null);
  assert.equal(b.input.keyDown({ ...press('ArrowUp'), timeStamp: 0 }), false);
  let prevented = false;
  b.input.wheel({ deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: true, target: b.canvas, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, 'a pinch never zooms the page');
});

test('input: a drag turns the scene with the pointer, and marks the eye as held for the mouse', () => {
  const { motion, input, canvas } = setup();
  input.pointerDown({ button: 0, isPrimary: true, pointerId: 7, clientX: 100, clientY: 100, target: canvas });
  assert.equal(input.dragging, true);
  input.pointerMove({ pointerId: 7, clientX: 300, clientY: 50 });
  settle(motion);
  assert.ok(Math.abs(motion.pose.yaw - 20) < 1e-3, `drag right 200 px turns left 20 degrees: ${motion.pose.yaw}`);
  assert.ok(Math.abs(motion.pose.pitch + 5) < 1e-3, `drag up 50 px tilts down 5 degrees: ${motion.pose.pitch}`);
  input.pointerUp({ pointerId: 7 });
  assert.equal(input.dragging, false);
  input.pointerDown({ button: 2, isPrimary: true, pointerId: 8, clientX: 0, clientY: 0 });
  assert.equal(input.dragging, false, 'right button does not drag');
});

test('input: swipe up moves forward, sideways turns; a pinch out moves forward; the interface keeps its scrolling', () => {
  const { motion, input, canvas } = setup();
  const wheel = (o) => {
    let prevented = false;
    input.wheel({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, target: canvas, preventDefault: () => { prevented = true; }, ...o });
    return prevented;
  };
  assert.equal(wheel({ deltaY: 500 }), true);
  settle(motion);
  assert.ok(motion.pose.z < -0.29 && motion.pose.z > -0.31, `forward ${motion.pose.z}`);
  wheel({ deltaX: -100 });
  settle(motion);
  assert.ok(Math.abs(motion.pose.yaw - 10) < 1e-3, `fingers right turns left: ${motion.pose.yaw}`);
  const z0 = motion.pose.z;
  wheel({ deltaY: -20, ctrlKey: true });
  settle(motion);
  assert.ok(motion.pose.z < z0 - 0.01, 'pinch out goes in');
  // Over the settings sheet: not ours, and not prevented.
  const sheet = { closest: (s) => (s === '.ui > *' ? {} : null) };
  const before = motion.pose.z;
  assert.equal(wheel({ deltaY: 500, target: sheet }), false);
  settle(motion);
  assert.ok(Math.abs(motion.pose.z - before) < 1e-6);
});

test('keys: the arrows belong to an open settings sheet or scene menu, wherever the focus is', () => {
  for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    assert.equal(arrowsTaken(press(k), { sheetOpen: true }), true, `${k}, sheet open`);
    assert.equal(arrowsTaken(press(k), { menuOpen: true }), true, `${k}, menu open`);
    assert.equal(arrowsTaken(press(k), {}), false, `${k}, nothing open`);
  }
  // Other keys still work with the sheet open (T, N, + and the old ones).
  for (const k of ['t', 'n', '+', 'h', 's', 'Escape']) assert.equal(arrowsTaken(press(k), { sheetOpen: true }), false, k);
});

test('input: an arrow held when the sheet opens stops moving the window', () => {
  const { motion, input, panels } = setup();
  input.keyDown({ ...press('ArrowUp'), timeStamp: 0 });
  assert.equal(input.rates(100).forward, 1);
  panels.sheetOpen = true;
  assert.equal(input.rates(200), null, 'no rates while the sheet has the arrows');
  const z = motion.pose.z;
  for (let t = 200; t < 1200; t += 1000 / 60) motion.update(1 / 60, input.rates(t));
  settle(motion);
  assert.ok(Math.abs(motion.pose.z - z) < 1e-9, 'the window stayed put behind the sheet');
  panels.sheetOpen = false;
  assert.equal(input.rates(1300), null, 'the arrow must be pressed again');
});

test('input: a Safari pinch (gesture events) moves like a Chrome pinch and never zooms the page', () => {
  const chrome = setup();
  chrome.input.wheel({ deltaX: 0, deltaY: -100 * Math.log(1.5), deltaMode: 0, ctrlKey: true, target: chrome.canvas, preventDefault() {} });
  settle(chrome.motion);
  const safari = setup();
  let prevented = 0;
  const g = (type, scale) => safari.input.gesture({ type, scale, target: safari.canvas, preventDefault: () => { prevented++; } });
  g('gesturestart', 1);
  g('gesturechange', 1.2);
  g('gesturechange', 1.5);
  g('gestureend', 1.5);
  settle(safari.motion);
  assert.equal(prevented, 4, 'every gesture event is taken');
  assert.ok(safari.motion.pose.z < -0.01, 'pinch out goes in');
  assert.ok(Math.abs(safari.motion.pose.z - chrome.motion.pose.z) < 1e-6, `${safari.motion.pose.z} vs ${chrome.motion.pose.z}`);
  // Over the interface: left alone.
  let left = true;
  safari.input.gesture({ type: 'gesturestart', scale: 1, target: { closest: () => ({}) }, preventDefault: () => { left = false; } });
  assert.equal(left, true);
});
