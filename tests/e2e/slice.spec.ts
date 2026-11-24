/**
 * End-to-end browser checks of the production build (GDD 6.14 "Build", "Combat", "Browser quality").
 * Uses the `?debug` hooks only to read state and to skip travel/gathering time where noted.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

type AlloyState = {
  modal: string | null;
  pos: { x: number; z: number };
  phase: string;
  health: number;
  maxHealth: number;
  maxStamina: number;
  stamina: number;
  attributes: Record<string, { level: number; xp: number }>;
  quest: { step: string; index: number };
  totals: Record<string, number>;
  equipped: { damage: number; source: string; imbuements: string[] } | null;
  enemies: Array<{ id: string; state: string; hp: number }>;
};

const state = (page: Page) => page.evaluate(() => (window as unknown as { __alloy: { state: () => AlloyState } }).__alloy.state());
const call = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as unknown as Record<string, Record<string, (...x: unknown[]) => unknown>>).__alloy[f as string](...(a as unknown[])), [fn, args] as const);

// CI has no GPU: at the default preset SwiftShader runs below the game's 20 fps time-step
// floor, so game time lags the real-time waits below. Use the game's own "low" preset there.
// An init script re-applies it after newGame() clears localStorage and reloads.
if (process.env.CI) {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try {
        const key = 'alloy-frontier.settings.v1';
        const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
        localStorage.setItem(key, JSON.stringify({ ...s, quality: 'low' }));
      } catch {
        /* ignore */
      }
    });
  });
}

async function newGame(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?debug&world=off'); // single-player checks: never join a running world server
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('new-game').click();
  await expect.poll(async () => (await state(page)).modal).toBeNull();
  return errors;
}

test('boots the production build and renders the 3D scene without errors', async ({ page }) => {
  const errors = await newGame(page);
  await expect(page.locator('canvas#game-canvas')).toBeVisible();
  await expect(page.getByTestId('objective')).toContainText("A Smith's Commission");
  const pixels = await page.evaluate(() => {
    const c = document.getElementById('game-canvas') as HTMLCanvasElement;
    return { w: c.width, h: c.height };
  });
  expect(pixels.w).toBeGreaterThan(500);
  expect(errors).toEqual([]);
});

test('WASD movement, sprint stamina drain and jump', async ({ page }) => {
  await newGame(page);
  const s0 = await state(page);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyW');
  const s1 = await state(page);
  expect(Math.hypot(s1.pos.x - s0.pos.x, s1.pos.z - s0.pos.z)).toBeGreaterThan(2);
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(1500);
  const s2 = await state(page);
  await page.keyboard.up('KeyS');
  await page.keyboard.up('ShiftLeft');
  expect(s2.stamina).toBeLessThan(100);
  expect(s2.stamina).toBeGreaterThan(99); // ~0.333/s: long-duration endurance
});

test('A and D strafe toward screen left and right', async ({ page }) => {
  await newGame(page);
  // Where the player is on screen (0 = left edge, 1 = right edge).
  const screenX = () =>
    page.evaluate(() => {
      const g = (window as unknown as { __alloy: { game: { camera: import('three').Camera; player: { position: import('three').Vector3 } } } }).__alloy.game;
      return (g.player.position.clone().project(g.camera).x + 1) / 2;
    });
  for (const [key, dir] of [
    ['KeyD', 1],
    ['KeyA', -1],
  ] as const) {
    const x0 = await screenX();
    await page.keyboard.down(key);
    await page.waitForTimeout(500);
    const x1 = await screenX();
    await page.keyboard.up(key);
    await page.waitForTimeout(1200); // let the camera settle behind again
    expect(Math.sign(x1 - x0), `${key} should move the player ${dir > 0 ? 'right' : 'left'} on screen`).toBe(dir);
  }
});

test('combat: combo damages the training post exactly once per swing', async ({ page }) => {
  await newGame(page);
  await call(page, 'teleport', -8, 4.5);
  await call(page, 'face', 0.6);
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyE');
  await page.locator('[data-option="0"]').click();
  await expect.poll(async () => (await state(page)).equipped?.damage).toBe(14);
  await call(page, 'teleport', 5, -7.6);
  await call(page, 'face', Math.PI);
  await page.waitForTimeout(300);
  const hp0 = (await state(page)).enemies.find((e) => e.id === 'dummy-1')!.hp;
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(700);
  const hp1 = (await state(page)).enemies.find((e) => e.id === 'dummy-1')!.hp;
  // One light hit of a 14-damage sword vs 0 defense: exactly 14 (crit would be 21).
  expect([14, 21]).toContain(Math.round(hp0 - hp1));
  const st = await state(page);
  expect(st.stamina).toBeLessThan(100);
});

test('full loop: gather, forge (quick + masterwork UI), equip, elite, report, save/load', async ({ page }) => {
  test.setTimeout(300_000);
  const t0 = Date.now();
  await newGame(page);
  // Talk to Orla
  await call(page, 'teleport', -8, 4.5);
  await page.waitForTimeout(150);
  await page.keyboard.press('KeyE');
  await page.locator('[data-option="0"]').click();
  // Real gather at a node
  await call(page, 'teleport', -6, 38.2);
  await call(page, 'face', 0);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('prompt')).toContainText('Gather');
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await state(page)).totals.iron_ore, { timeout: 5000 }).toBeGreaterThan(0);
  // Debug top-up to skip travel time; the quest still requires a kill.
  await call(page, 'give', 'iron_ore', 6, 0.6);
  await call(page, 'give', 'ironwood', 3, 0.55);
  await call(page, 'give', 'ironglass', 4, 0.75);
  await page.evaluate(() => {
    const a = (window as unknown as { __alloy: { session: () => { recordKill: (t: string) => void; talk: (n: string) => void } } }).__alloy;
    a.session().recordKill('scavenger');
    a.session().talk('orla');
  });
  expect((await state(page)).quest.step).toBe('compare');
  // Merchant comparison
  await call(page, 'teleport', 9.5, 4);
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyE');
  await expect(page.getByText("Bram's Frontier Goods")).toBeVisible();
  await page.keyboard.press('Escape');
  // Forge: Quick
  await call(page, 'teleport', -11.5, 9);
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyE');
  await page.getByTestId('quick-forge-confirm').click();
  await expect(page.getByTestId('forge-result')).toContainText('Quick Forge');
  // Forge: Masterwork (heat, hammer via hint, temper)
  await page.getByRole('button', { name: 'Forge another' }).click();
  await page.locator('[data-blueprint="ironglass_longsword"]').click();
  await page.locator('[data-mode="masterwork"]').click();
  await page.locator('[data-spec="heavy"]').click();
  await page.getByTestId('mw-begin').click();
  await page.locator('[data-heat="cherry"]').click();
  await page.getByTestId('mw-heat-confirm').click();
  for (let i = 0; i < 12; i++) {
    if (!(await page.locator('.board').isVisible())) break;
    const clicked = await page.getByRole('button', { name: 'Hint' }).click({ timeout: 1500 }).then(() => true, () => false);
    if (!clicked) break;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(80);
  }
  if (await page.getByTestId('mw-hammer-done').isVisible()) await page.getByTestId('mw-hammer-done').click();
  await page.locator('[data-temper="oil"]').click();
  await page.getByTestId('mw-finish').click();
  await expect(page.getByTestId('forge-result')).toContainText('Masterwork Forge');
  await page.getByTestId('equip-result').click();
  await page.keyboard.press('Escape');
  const eq = (await state(page)).equipped!;
  expect(eq.source).toBe('masterwork_forge');
  expect(eq.damage).toBeGreaterThan(20);
  expect((await state(page)).quest.step).toBe('foundry');
  // Elite (scripted inputs; heals keep the bot alive — this checks the loop, not difficulty)
  await call(page, 'teleport', 2, 236);
  await page.waitForTimeout(1200);
  await page.keyboard.press('Tab');
  for (let i = 0; i < 500; i++) {
    const s = await state(page);
    const w = s.enemies.find((e) => e.id === 'warden')!;
    if (w.state === 'dead') break;
    if (s.health < 80) await call(page, 'heal');
    const key = w.state === 'telegraph' ? 'KeyQ' : i % 6 === 0 ? 'KeyR' : i % 10 === 0 ? 'KeyF' : 'KeyJ';
    await page.keyboard.press(key);
    await page.waitForTimeout(180);
  }
  await expect.poll(async () => (await state(page)).quest.step).toBe('report');
  console.log(`elite defeated after ${((Date.now() - t0) / 1000).toFixed(0)}s of test time`);
  // Report → summary
  await call(page, 'teleport', -8, 4.5);
  await expect.poll(async () => (await state(page)).phase, { timeout: 5000 }).toBe('idle');
  await expect(page.getByTestId('prompt')).toContainText('Orla');
  await page.keyboard.press('KeyE');
  await page.locator('[data-option="0"]').click();
  await expect(page.getByText('Quest complete — The Edge You Made')).toBeVisible();
  // Save/load
  await call(page, 'save');
  const before = await state(page);
  await page.reload();
  await page.getByTestId('continue').click();
  const after = await state(page);
  expect(after.quest).toEqual(before.quest);
  expect(after.equipped).toEqual(before.equipped);
  expect(after.totals).toEqual(before.totals);
  expect(after.enemies.find((e) => e.id === 'warden')!.state).toBe('dead');
});

test('character window: tabs, attributes that grow by use, derived stats', async ({ page }) => {
  const errors = await newGame(page);
  // O opens the Character tab; I and U switch tabs; the same key again closes the window.
  await page.keyboard.press('KeyO');
  const win = page.getByTestId('character-window');
  await expect(win).toHaveAttribute('data-tab', 'character');
  await expect(page.getByTestId('attr-strength')).toHaveText('1');
  await expect(win.locator('[data-stat="Max health"]')).toHaveText('200');
  await expect(win.locator('[data-slot="main"]')).toContainText('Empty');
  await expect(win.locator('[data-slot="head"]')).toContainText('Coming soon');
  await page.keyboard.press('KeyI');
  await expect(win).toHaveAttribute('data-tab', 'inventory');
  await page.getByTestId('tab-skills').click();
  await expect(page.getByTestId('character-window')).toHaveAttribute('data-tab', 'skills');
  await expect(page.getByTestId('skill-smith')).toContainText('Blacksmithing');
  await page.keyboard.press('KeyU');
  await expect.poll(async () => (await state(page)).modal).toBeNull();

  // Mining ore grows Strength and Endurance (the shared rules, run locally for a guest).
  await call(page, 'teleport', -6, 38.2);
  await call(page, 'face', 0);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('prompt')).toContainText('Gather');
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await state(page)).totals.iron_ore, { timeout: 5000 }).toBeGreaterThan(0);
  const a = (await state(page)).attributes;
  expect(a.strength.xp).toBeGreaterThan(0);
  expect(a.endurance.xp).toBeGreaterThan(0);

  // A Vitality level raises max health in play and on the character sheet.
  await page.evaluate(() => (window as unknown as { __alloy: { session: () => { gainAttributes: (g: Array<[string, number]>) => void } } }).__alloy.session().gainAttributes([['vitality', 40]]));
  await expect.poll(async () => (await state(page)).maxHealth).toBe(205);
  await page.keyboard.press('KeyO');
  await expect(page.getByTestId('attr-vitality')).toHaveText('2');
  await expect(page.getByTestId('character-window').locator('[data-stat="Max health"]')).toHaveText('205');
  expect(errors).toEqual([]);
});

test('performance capture (1920x1080, medium preset)', async ({ page }) => {
  await newGame(page);
  const results: Record<string, unknown> = {};
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return { domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd, transferKB: performance.getEntriesByType('resource').reduce((a, r) => a + ((r as PerformanceResourceTiming).transferSize || 0), 0) / 1024 };
  });
  results.navigation = nav;
  results.gl = await page.evaluate(() => {
    const gl = (document.getElementById('game-canvas') as HTMLCanvasElement).getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  for (const [name, x, z] of [
    ['village', 0, -4],
    ['trail', 14, 80],
    ['quarry', 40, 165],
    ['foundry', 2, 236],
  ] as const) {
    await call(page, 'teleport', x, z);
    await page.waitForTimeout(5500);
    results[name] = await call(page, 'perf');
  }
  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/perf-latest.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
});
