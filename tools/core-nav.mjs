#!/usr/bin/env node
// Moving the window, in the real app (headless Chromium, mouse input; the
// camera is never used):
//
// - every scene with places: a screenshot at each station (after the glide
//   lands), the station strip and caption, no page errors;
// - the default rig draws today's frame: at the first station of the test
//   room the camera sits exactly on the eye with no rotation;
// - view.eyeWorld handed to scene.update is the camera position, every frame;
// - keys: held arrow moves, T starts the tour and Esc stops it, + shrinks,
//   H goes home, Cmd + arrow is left alone; a drag turns, a two-finger swipe
//   moves; a pinch never zooms the page;
// - frame cost: the loop's JS time during a tour against standing still.
//
//   node tools/core-nav.mjs [--port 5191] [--out out/core-nav] [--scenes test-room,soundstage,box]
//
// Prints pass/FAIL per check; exits 1 on any failure.

import { mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const PORT = Number(arg('port', 5191));
const OUT = resolve(root, arg('out', 'out/core-nav'));
const SCENES = String(arg('scenes', 'test-room,soundstage,box')).split(',');
mkdirSync(OUT, { recursive: true });

const server = await createServer({
  root,
  configFile: resolve(root, 'tools', 'core-vite.config.mjs'),
  logLevel: 'error',
  server: { port: PORT, strictPort: true, host: '127.0.0.1' },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
};

async function open(scene) {
  const context = await browser.newContext({ viewport: { width: 1710, height: 1107 }, deviceScaleFactor: 2, screen: { width: 1710, height: 1107 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/?e2e&autostart=mouse&reset&scene=${scene}`, { waitUntil: 'load' });
  await page.waitForFunction((id) => {
    const a = window.__wd?.app;
    return a?.host?.current?.id === id && !a.hidden && !a.host.loading;
  }, scene, { timeout: 90000 });
  // The pointer rests in the middle: the eye sits straight in front.
  await page.mouse.move(855, 553);
  await page.waitForTimeout(600);
  return { context, page, errors };
}

const app = (page, fn, a) => page.evaluate(fn, a);
const waitAt = (page, id, ms = 15000) => page.waitForFunction((s) => window.__wd.app.motion.at === s, id, { timeout: ms });

try {
  for (const scene of SCENES) {
    let ctx;
    try {
      ctx = await open(scene);
    } catch (err) {
      check(`${scene}: loads`, false, String(err.message).split('\n')[0]);
      continue;
    }
    const { context, page, errors } = ctx;
    const stations = await app(page, () => window.__wd.app.motion.nav?.stations.map((s) => ({ id: s.id, title: s.title })) ?? null);
    if (!stations) {
      console.log(`info  ${scene}: no nav yet (the window stays at the glass)`);
      await page.screenshot({ path: join(OUT, `${scene}-no-nav.png`) });
      await context.close();
      continue;
    }
    console.log(`info  ${scene}: ${stations.length} stations: ${stations.map((s) => s.id).join(', ')}`);

    // The default rig at the test room's first station: exactly the old camera.
    if (scene === 'test-room') {
      const r = await app(page, () => {
        const a = window.__wd.app;
        const c = a.camera3;
        return { q: c.quaternion.toArray(), pos: c.position.toArray(), eye: a.eyeVec.toArray(), pose: { ...a.motion.pose } };
      });
      check('test room: the first station is the default rig, the camera on the eye with no turn',
        r.q.join() === '0,0,0,1' && r.pos.every((v, i) => v === r.eye[i]), r);
    }

    // eyeWorld given to update() is the camera position, each frame, while moving.
    const eyeCheck = await app(page, () => new Promise((res) => {
      const a = window.__wd.app;
      const inst = a.host.current.inst;
      const orig = inst.update;
      let worst = 0, n = 0, missing = 0, outside = 0;
      const room = a.motion.nav?.room;
      inst.update = function (dt, t, eye, view) {
        if (!view?.eyeWorld) missing++;
        else {
          worst = Math.max(worst, view.eyeWorld.distanceTo(a.camera3.position));
          const p = view.eyeWorld;
          if (room && !(p.x >= room.min[0] - 1e-6 && p.x <= room.max[0] + 1e-6 && p.y >= room.min[1] - 1e-6
            && p.y <= room.max[1] + 1e-6 && p.z >= room.min[2] - 1e-6 && p.z <= room.max[2] + 1e-6)) outside++;
        }
        n++;
        return orig?.call(this, dt, t, eye, view);
      };
      // A tour of every place, the eye swung to the screen's corners on the way.
      a.motion.startTour();
      const corners = [[0, 0], [1710, 0], [1710, 1107], [0, 1107]];
      let k = 0;
      const swing = setInterval(() => { const [x, y] = corners[k++ % 4]; a.mouse.point(x, y, a.vp); }, 700);
      setTimeout(() => { clearInterval(swing); a.motion.stopTour(); inst.update = orig; res({ worst, n, missing, outside, room: !!room }); }, 12000);
    }));
    check(`${scene}: view.eyeWorld is the camera position on every frame${eyeCheck.room ? ', inside the room' : ''}`,
      eyeCheck.missing === 0 && eyeCheck.worst === 0 && eyeCheck.n > 300 && eyeCheck.outside === 0, eyeCheck);

    // A screenshot at every station, after the glide lands.
    for (const [i, s] of stations.entries()) {
      await app(page, (id) => window.__wd.app.goToStation(id), s.id);
      try {
        await waitAt(page, s.id);
      } catch {
        check(`${scene}: arrives at ${s.id}`, false);
        continue;
      }
      await page.waitForTimeout(250); // the caption fades in
      const p = await app(page, () => ({ ...window.__wd.app.motion.pose }));
      const caption = await app(page, () => document.querySelector('.caption')?.textContent);
      const current = await app(page, () => document.querySelector('.stations [aria-current="true"]')?.textContent);
      check(`${scene}: at ${s.id}, caption and strip say "${s.title}"`, caption === s.title && current === s.title, { caption, current, pose: p });
      await page.screenshot({ path: join(OUT, `${scene}-${String(i + 1).padStart(2, '0')}-${s.id}.png`) });
    }

    // The interface awake: the strip above the dock.
    await page.mouse.move(700, 500);
    await page.mouse.move(855, 553, { steps: 4 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(OUT, `${scene}-ui.png`) });

    // Station view limits: at each place with `view`, the limits in force
    // are the station's (the mouse stands in at 1.4x); over a glide between
    // places with different limits, with the eye held off centre, the drawn
    // eye moves without a step.
    const limited = await app(page, () => window.__wd.app.motion.nav.stations.filter((s) => s.view).map((s) => ({ id: s.id, view: s.view })));
    if (limited.length) {
      const wrong = [];
      for (const s of limited) {
        await app(page, (id) => window.__wd.app.goToStation(id), s.id);
        await waitAt(page, s.id).catch(() => {});
        const L = await app(page, () => window.__wd.app.limiter.last);
        const rx = Math.min(1.4, s.view.maxStrength ?? Infinity) / 1.4;
        const z = s.view.maxEyeZ ?? 1.44;
        if (!L || Math.abs(L.ratio.x - rx) > 1e-6 || Math.abs(L.maxEyeZ - z) > 1e-6) wrong.push({ id: s.id, L, rx, z });
      }
      check(`${scene}: each place's head-tracking limits are in force there`, wrong.length === 0, wrong.slice(0, 2));
      const first = stations[0].id;
      // The place that holds the mouse in most (its 1.4x counts as the strength).
      const tight = limited.reduce((a, b) => ((b.view.maxStrength ?? Infinity) < (a.view.maxStrength ?? Infinity) ? b : a));
      await page.mouse.move(1500, 200, { steps: 5 }); // the eye well off centre
      await app(page, (id) => window.__wd.app.goToStation(id), first);
      await waitAt(page, first).catch(() => {});
      await page.waitForTimeout(800);
      const eyes = await app(page, (id) => new Promise((res) => {
        const a = window.__wd.app;
        const out = [];
        a.frameHook = (t, ts, e) => out.push([e.x, e.y, e.z]);
        a.goToStation(id);
        const done = () => {
          if (a.motion.at === id) { a.frameHook = null; res(out); } else setTimeout(done, 100);
        };
        setTimeout(done, 200);
      }), tight.id);
      const steps = eyes.slice(1).map((e, i) => Math.hypot(e[0] - eyes[i][0], e[1] - eyes[i][1], e[2] - eyes[i][2]));
      const moved = Math.hypot(eyes.at(-1)[0] - eyes[0][0], eyes.at(-1)[1] - eyes[0][1], eyes.at(-1)[2] - eyes[0][2]);
      const holdsMouse = (tight.view.maxStrength ?? Infinity) < 1.4;
      check(`${scene}: gliding into ${tight.id}'s limits moves the drawn eye smoothly`, Math.max(...steps) < 0.006 && (moved > 0.005 || !holdsMouse),
        { frames: eyes.length, movedMm: +(moved * 1000).toFixed(1), largestStepMm: +(Math.max(...steps) * 1000).toFixed(2) });
      await page.mouse.move(855, 553, { steps: 5 });
    }

    // Frame cost: standing still against a running tour (the loop's JS time).
    const still = await app(page, () => new Promise((res) => {
      const a = window.__wd.app;
      a.perf.deltas.length = 0;
      a.perf.work.length = 0;
      setTimeout(() => res(a.perfSummary()), 3000);
    }));
    const touring = await app(page, () => new Promise((res) => {
      const a = window.__wd.app;
      a.motion.startTour();
      a.perf.deltas.length = 0;
      a.perf.work.length = 0;
      setTimeout(() => { const s = a.perfSummary(); a.motion.stopTour(); res(s); }, 4000);
    }));
    console.log(`info  ${scene}: still ${still.fps?.toFixed(1)} fps, loop JS p50 ${still.workP50?.toFixed(2)} ms; touring ${touring.fps?.toFixed(1)} fps, p50 ${touring.workP50?.toFixed(2)} ms, p99 ${touring.workP99?.toFixed(2)} ms`);

    check(`${scene}: no page errors`, errors.length === 0, errors.slice(0, 3));
    await context.close();
  }

  // Keys and pointer in the test room.
  {
    const { context, page, errors } = await open('test-room');
    const pose = () => app(page, () => ({ ...window.__wd.app.motion.pose, at: window.__wd.app.motion.at, tour: window.__wd.app.motion.tour.on }));
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(800);
    await page.keyboard.up('ArrowUp');
    await page.waitForTimeout(900);
    let p = await pose();
    check('keys: holding the up arrow moves forward (into the scene)', p.z < -0.08 && Math.abs(p.x) < 1e-6, p);
    // Shift pressed while an arrow is already held: forward becomes rise at
    // once (no key repeat in Playwright, so only the Shift event can do it).
    const y0 = p.y;
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(150);
    await page.keyboard.down('Shift');
    await page.waitForTimeout(500);
    await page.keyboard.up('Shift');
    await page.keyboard.up('ArrowUp');
    await page.waitForTimeout(900);
    p = await pose();
    check('keys: Shift pressed during a held arrow switches to rising', p.y > y0 + 0.02, { y0, y: p.y });
    // Moving keys leave the interface faded.
    await page.waitForFunction(() => document.body.classList.contains('idle'), null, { timeout: 8000 }).catch(() => {});
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(600);
    await page.keyboard.up('ArrowDown');
    const idle = await app(page, () => document.body.classList.contains('idle'));
    check('keys: moving does not wake the faded interface', idle);
    await page.keyboard.down('Shift');
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('Shift');
    await page.waitForTimeout(900);
    p = await pose();
    check('keys: Shift + left turns left', p.yaw > 10, p);
    const s0 = p.scale;
    await page.keyboard.press('+');
    await page.waitForTimeout(900);
    p = await pose();
    check('keys: + shrinks the viewer into the set', Math.abs(p.scale / s0 - 0.8) < 0.01, p);
    await page.keyboard.press('Meta+ArrowUp');
    await page.waitForTimeout(400);
    const p2 = await pose();
    check('keys: Cmd + up arrow is left to the browser', Math.abs(p2.z - p.z) < 1e-4, { before: p.z, after: p2.z });
    await page.keyboard.press('h');
    await page.waitForFunction(() => window.__wd.app.motion.at === 'glass', null, { timeout: 15000 }).catch(() => {});
    p = await pose();
    check('keys: H glides back to the first place', p.at === 'glass', p);
    await page.keyboard.press('t');
    await page.waitForTimeout(300);
    p = await pose();
    const status = await app(page, () => document.querySelector('.status .label')?.textContent);
    check('keys: T starts the tour and says how to stop it', p.tour && /Tour/.test(status), { tour: p.tour, status });
    await page.keyboard.press('Escape');
    p = await pose();
    check('keys: Esc stops the tour', !p.tour, p);
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(100);
    await page.keyboard.up('ArrowDown');
    p = await pose();
    check('keys: any move stops the tour', !p.tour, p);
    const target = await app(page, () => {
      const m = window.__wd.app.motion;
      return m.nav.stations[(m.last + 1) % m.nav.stations.length].id;
    });
    const t0 = Date.now();
    await page.keyboard.press('n');
    const headed = await app(page, () => window.__wd.app.motion.nav.stations[window.__wd.app.motion.last].id);
    await page.waitForFunction(() => window.__wd.app.motion.at !== null, null, { timeout: 30000 }).catch(() => {});
    p = await pose();
    const fps = await app(page, () => window.__wd.app.fps);
    check('keys: N glides to the next place', headed === target && p.at === target, { target, headed, at: p.at, seconds: (Date.now() - t0) / 1000, fps });

    // The controls fade after a place or Tour is clicked in the strip (the
    // button keeps the focus after a click; only keyboard focus holds them).
    const idleNow = () => app(page, () => document.body.classList.contains('idle'));
    await page.mouse.move(700, 520);
    await page.mouse.move(855, 553, { steps: 3 });
    await page.waitForTimeout(300);
    await page.click('.stations .stations-list .chip-btn:nth-child(2)');
    // A key pressed after the click (Chrome would make a kept focus visible).
    await page.waitForTimeout(400);
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(100);
    await page.keyboard.up('ArrowLeft');
    await page.waitForTimeout(3600);
    const afterPlace = { idle: await idleNow(), focus: await app(page, () => document.activeElement?.tagName) };
    check('strip: the controls fade 3.6 s after clicking a place, also after a key', afterPlace.idle && afterPlace.focus === 'BODY', afterPlace);
    await page.mouse.move(850, 553);
    await page.waitForTimeout(300);
    await page.click('.stations .tour-btn');
    await page.waitForTimeout(3600);
    const afterTour = { idle: await idleNow(), tour: await app(page, () => window.__wd.app.motion.tour.on) };
    check('strip: the controls fade during a tour started from the Tour button', afterTour.idle && afterTour.tour, afterTour);
    // ...and a keyboard user's focus keeps them.
    await page.keyboard.press('Escape'); // stop the tour
    // Tab into the controls (Chrome may first step out of the page from where focus last was).
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      if (await app(page, () => !!document.activeElement?.closest('.ui'))) break;
    }
    await page.waitForTimeout(3600);
    const kbd = {
      idle: await idleNow(),
      visible: await app(page, () => document.activeElement?.matches(':focus-visible')),
      focus: await app(page, () => { const a = document.activeElement; return a ? `${a.tagName}.${a.className} ${a.textContent?.slice(0, 20)}` : null; }),
    };
    check('keyboard focus in the controls keeps them shown', !kbd.idle && kbd.visible, kbd);
    await app(page, () => document.activeElement?.blur());
    // A drag on the scene does not wake them.
    await page.mouse.move(855, 553);
    await page.waitForFunction(() => document.body.classList.contains('idle'), null, { timeout: 8000 }).catch(() => {});
    await page.mouse.down();
    await page.mouse.move(900, 560, { steps: 8 });
    const dragIdle = await idleNow();
    await page.mouse.up();
    check('a drag on the scene leaves the controls faded', dragIdle);

    // Drag: the eye (the mouse) holds still while the window turns.
    const before = await app(page, () => ({ yaw: window.__wd.app.motion.goal[3], eye: { ...window.__wd.app.mouse.target } }));
    await page.mouse.move(800, 550);
    await page.waitForTimeout(100);
    const eyeBefore = await app(page, () => ({ ...window.__wd.app.mouse.target }));
    await page.mouse.down();
    await page.mouse.move(1000, 550, { steps: 10 });
    const during = await app(page, () => ({ yaw: window.__wd.app.motion.goal[3], eye: { ...window.__wd.app.mouse.target } }));
    await page.mouse.up();
    check('drag: the window turns with the pointer (200 px right turns 20 degrees left)', Math.abs(during.yaw - before.yaw - 20) < 0.5, { before: before.yaw, during: during.yaw });
    check('drag: with the mouse as the eye, the eye holds still while dragging', Math.abs(during.eye.x - eyeBefore.x) < 1e-9 && Math.abs(during.eye.y - eyeBefore.y) < 1e-9, { eyeBefore, eyeDuring: during.eye });

    // Two-finger swipe and pinch.
    const z0 = await app(page, () => window.__wd.app.motion.goal[2]);
    await page.mouse.move(855, 553);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(200);
    const z1 = await app(page, () => window.__wd.app.motion.goal[2]);
    check('swipe: up (positive deltaY) moves forward', z1 < z0 || Math.abs(z1 - (-0.4)) < 1e-6, { z0, z1 });
    const zoom0 = await app(page, () => window.devicePixelRatio);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);
    const zoom1 = await app(page, () => window.devicePixelRatio);
    check('pinch: never zooms the page', zoom0 === zoom1, { zoom0, zoom1 });

    // Settings open: the arrows are the sheet's (it scrolls), the window stays.
    await page.keyboard.press('s');
    await page.waitForTimeout(300);
    const zs = await app(page, () => window.__wd.app.motion.goal[2]);
    const scrolled = await app(page, () => {
      const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowDown');
    const ze = await app(page, () => window.__wd.app.motion.goal[2]);
    check('settings open: arrows are left to the sheet and the window stays put', !scrolled && ze === zs, { prevented: scrolled, before: zs, after: ze });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Steady check: the rig steps aside (the check is drawn at the glass).
    await page.keyboard.press('c');
    await page.waitForTimeout(400);
    const steady = await app(page, () => ({ q: window.__wd.app.camera3.quaternion.toArray(), strip: document.querySelector('.stations').hidden }));
    check('steady check: drawn at the glass, the strip hidden', steady.q.join() === '0,0,0,1' && steady.strip, steady);
    await page.keyboard.press('Escape');
    check('test room keys: no page errors', errors.length === 0, errors.slice(0, 3));
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(failed ? `core nav: ${failed} FAILED` : 'core nav: ok');
process.exit(failed ? 1 : 0);
