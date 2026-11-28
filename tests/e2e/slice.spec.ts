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

async function newGame(page: Page, opts: { audio?: boolean } = {}) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // Single-player checks: never join a running world server. Silent (audio costs CPU on slow
  // test machines); the boot test checks audio on its own.
  await page.goto(`/?debug&world=off${opts.audio ? '' : '&noaudio'}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('new-game').click();
  await expect.poll(async () => (await state(page)).modal).toBeNull();
  return errors;
}

test('boots the production build and renders the 3D scene without errors', async ({ page }) => {
  const errors = await newGame(page, { audio: true });
  await expect(page.locator('canvas#game-canvas')).toBeVisible();
  await expect(page.getByTestId('objective')).toContainText("A Smith's Commission");
  // Audio starts with the first click (New game): the village plays the town theme.
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __alloy: { state: () => { audio: { unlocked: boolean; track: string | null } } } }).__alloy.state().audio))).toMatchObject({ unlocked: true, track: 'town' });
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
  // Walk until 2 m are covered (on a slow machine the game runs behind real time).
  await page.keyboard.down('KeyW');
  await expect.poll(async () => { const s = await state(page); return Math.hypot(s.pos.x - s0.pos.x, s.pos.z - s0.pos.z); }, { timeout: 6000 }).toBeGreaterThan(2);
  await page.keyboard.up('KeyW');
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
  // Talk (press E again if a slow frame missed the key), then pick the first option.
  await expect(async () => {
    await page.keyboard.press('KeyE');
    await expect(page.locator('[data-option="0"]')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
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

test('a pointer lock granted after a menu opened is released, so the menu stays clickable', async ({ page }) => {
  // The browser grants pointer lock asynchronously. Make that slow (as on a busy machine) so the
  // next menu opens before the lock from closing the last one arrives.
  await page.addInitScript(() => {
    const req = HTMLCanvasElement.prototype.requestPointerLock;
    HTMLCanvasElement.prototype.requestPointerLock = function (this: HTMLCanvasElement, ...a: unknown[]) {
      setTimeout(() => void (req as (...x: unknown[]) => unknown).apply(this, a), 600);
      return Promise.resolve() as never;
    };
  });
  await newGame(page);
  await page.keyboard.press('KeyI');
  await expect.poll(async () => (await state(page)).modal).toBe('inventory');
  await page.keyboard.press('KeyI'); // close: asks for the mouse (granted 600 ms later)
  await expect.poll(async () => (await state(page)).modal).toBeNull();
  await page.keyboard.press('KeyI'); // reopen before the grant arrives
  await expect.poll(async () => (await state(page)).modal).toBe('inventory');
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
});

test('full loop: gather, forge (quick + masterwork UI), equip, elite, report, save/load', async ({ page }) => {
  test.setTimeout(300_000);
  const t0 = Date.now();
  await newGame(page);
  // Talk to Orla
  await call(page, 'teleport', -8, 4.5);
  await page.waitForTimeout(150);
  // Talk (press E again if a slow frame missed the key), then pick the first option.
  await expect(async () => {
    await page.keyboard.press('KeyE');
    await expect(page.locator('[data-option="0"]')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
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
  await call(page, 'teleport', -14.94, 13.4); // inside the forge, in front of the anvil
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyE');
  // Orla explains the current step in plain words.
  await expect(page.getByTestId('forge-guide')).toContainText('Quick Forge makes a solid blade');
  // Everything on the forge screen is visible at once: no column overflows (no scrollbars).
  expect(await page.evaluate(() => [...document.querySelectorAll('.fx .forge-col')].map((c) => c.scrollHeight - c.clientHeight))).toEqual([0, 0, 0]);
  // Nothing covers the Forge button and the game hasn't captured the mouse (a late pointer lock
  // would send every click to the game canvas instead).
  await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
  expect(
    await page.evaluate(() => {
      const b = document.querySelector('[data-testid="quick-forge-confirm"]')!;
      const r = b.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b;
    }),
  ).toBe(true);
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
  // Generous budget: on slow machines the game runs behind real time.
  for (let i = 0; i < 900; i++) {
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
  // Talk (press E again if a slow frame missed the key), then pick the first option.
  await expect(async () => {
    await page.keyboard.press('KeyE');
    await expect(page.locator('[data-option="0"]')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
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
  // I opens the Character screen; the top tabs and Q / E switch screens; I again closes.
  await page.keyboard.press('KeyI');
  const win = page.getByTestId('character-window');
  await expect(win).toHaveAttribute('data-tab', 'character');
  await expect(page.getByTestId('attr-strength')).toHaveText('1');
  await expect(win.locator('[data-stat="Max health"]')).toHaveText('200');
  await expect(win.locator('[data-stat="Damage type"]')).toHaveText('Blunt'); // unarmed: fists
  await expect(win.locator('[data-slot="weapon"]')).toContainText('Empty');
  await expect(win.locator('[data-slot="head"]')).toContainText('Empty');
  await expect(win.locator('[data-slot="tool"]')).toContainText('Worn Pickaxe');
  await expect(page.getByTestId('character-preview')).toBeVisible(); // the live 3D model
  await page.getByTestId('tab-inventory').click();
  await expect(win).toHaveAttribute('data-tab', 'inventory');
  await page.keyboard.press('KeyE'); // next screen
  await expect(win).toHaveAttribute('data-tab', 'proficiencies');
  // The proficiency tree: three branches (Smithing is blacksmithing mastery), each with its gathering root.
  await expect(page.getByTestId('branch-smithing')).toContainText('Smithing');
  await expect(page.getByTestId('branch-alchemy')).toContainText('Root: Herbalism');
  await expect(page.getByTestId('branch-crafting')).toContainText('Crafting');
  await expect(page.getByTestId('skill-longsword')).toContainText('Longsword mastery');
  await expect(page.getByTestId('prof-mining')).toContainText('Mining');
  await page.getByTestId('tab-skills').click();
  await expect(win).toHaveAttribute('data-tab', 'skills');
  await expect(win.locator('[data-attack="guardbreaker"]')).toContainText('Guardbreaker');
  await page.keyboard.press('KeyQ'); // previous screen
  await expect(win).toHaveAttribute('data-tab', 'proficiencies');
  await page.keyboard.press('KeyI');
  await expect.poll(async () => (await state(page)).modal).toBeNull();

  // Mining ore grows Strength and Endurance (the shared rules, run locally for a guest).
  await call(page, 'teleport', -6, 38.2);
  await call(page, 'face', 0);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('prompt')).toContainText('Gather');
  // The gather action itself (scavengers on the trail can interrupt a held gather; the
  // full-loop test covers gathering with the E key).
  // Trail scavengers can knock the player out of reach: step back in and retry.
  await expect(async () => {
    await call(page, 'teleport', -6, 38.2);
    expect(await call(page, 'act', { k: 'gather', node: 'ore-t1' })).toMatchObject({ ok: true });
  }).toPass({ timeout: 15_000 });
  await expect.poll(async () => (await state(page)).totals.iron_ore).toBeGreaterThan(0);
  const a = (await state(page)).attributes;
  expect(a.strength.xp).toBeGreaterThan(0);
  expect(a.endurance.xp).toBeGreaterThan(0);

  // Ironwood needs a hatchet: with the pickaxe in the tool slot, gathering swaps the hatchet in.
  const toolOf = () => page.evaluate(() => {
    const s = (window as unknown as { __alloy: { session: () => { inventory: { equipped: { tool: string | null }; items: Record<string, { blueprintId: string }> } } } }).__alloy.session();
    return s.inventory.equipped.tool ? s.inventory.items[s.inventory.equipped.tool].blueprintId : null;
  });
  expect(await toolOf()).toBe('worn_pickaxe');
  // Retry if a scavenger interrupts the gather or knocks the player out of reach.
  await expect(async () => {
    await call(page, 'teleport', 10, 34);
    await call(page, 'face', 0);
    await page.waitForTimeout(300);
    await expect(page.getByTestId('prompt')).toContainText('Gather');
    await page.keyboard.press('KeyE');
    await expect.poll(async () => (await state(page)).totals.ironwood, { timeout: 4000 }).toBeGreaterThan(0);
  }).toPass({ timeout: 25_000 });
  expect(await toolOf()).toBe('worn_hatchet');

  // The tool slot on the sheet: Unequip and Equip again from the item details.
  await page.keyboard.press('KeyI');
  await expect(page.getByTestId('character-window').locator('[data-slot="tool"]')).toContainText('Worn Hatchet');
  await page.getByTestId('character-window').locator('[data-slot="tool"]').click();
  await page.getByTestId('inv-unequip').click();
  await expect.poll(toolOf).toBeNull();
  await page.getByTestId('inv-equip').click();
  await expect.poll(toolOf).toBe('worn_hatchet');
  await page.keyboard.press('KeyI');
  await expect.poll(async () => (await state(page)).modal).toBeNull();

  // A Vitality level raises max health in play and on the character sheet.
  await page.evaluate(() => (window as unknown as { __alloy: { session: () => { gainAttributes: (g: Array<[string, number]>) => void } } }).__alloy.session().gainAttributes([['vitality', 40]]));
  await expect.poll(async () => (await state(page)).maxHealth).toBe(205);
  await page.keyboard.press('KeyI');
  await expect(page.getByTestId('attr-vitality')).toHaveText('2');
  await expect(page.getByTestId('character-window').locator('[data-stat="Max health"]')).toHaveText('205');

  // Stat points: none at rank 1; 3 per rank after. Spending adds to the total; Reset refunds.
  await expect(page.getByTestId('unspent-points')).toHaveText('0');
  await expect(page.getByTestId('add-strength')).toBeDisabled();
  await page.evaluate(() => (window as unknown as { __alloy: { session: () => { gainAdventurer: (xp: number) => void } } }).__alloy.session().gainAdventurer(100));
  // Reopen the window so it shows the new points (wait for the close: two quick presses can land in one frame).
  await page.keyboard.press('KeyI');
  await expect.poll(async () => (await state(page)).modal).toBeNull();
  await page.keyboard.press('KeyI');
  await expect(page.getByTestId('unspent-points')).toHaveText('3');
  const str = Number(await page.getByTestId('attr-strength').textContent());
  await page.getByTestId('add-strength').click();
  await expect(page.getByTestId('attr-strength')).toHaveText(String(str + 1));
  await expect(page.getByTestId('unspent-points')).toHaveText('2');
  await page.getByTestId('respec').click();
  await expect(page.getByTestId('unspent-points')).toHaveText('3');
  await expect(page.getByTestId('attr-strength')).toHaveText(String(str));
  expect(errors).toEqual([]);
});

test('skills: learned at a mastery milestone, used from the skill bar, rearranged on the Skills screen', async ({ page }) => {
  const errors = await newGame(page);
  // A longsword in hand, then longsword mastery 3 (debug shortcut for the XP).
  await page.evaluate(() => {
    const s = (window as unknown as { __alloy: { session: () => { talk: (n: string) => void; gainWeaponXp: (x: number) => void; weaponLevel: number } } }).__alloy.session();
    s.talk('orla');
    while (s.weaponLevel < 3) s.gainWeaponXp(50);
  });
  await expect(page.getByTestId('skill-slot-1')).toContainText('Lunging');
  await page.keyboard.press('Digit1');
  await expect.poll(async () => ((await page.evaluate(() => (window as unknown as { __alloy: { state: () => { attack: string | null } } }).__alloy.state().attack)))).toBe('lunging_thrust');
  // Move it to key 3 on the Skills screen.
  await page.waitForTimeout(1200);
  await page.keyboard.press('KeyI');
  await page.getByTestId('tab-skills').click();
  await expect(page.getByTestId('skill-status-lunging_thrust')).toContainText('Learned');
  await expect(page.getByTestId('skill-status-final_slash')).toContainText('Longsword mastery 6');
  await page.getByTestId('assign-lunging_thrust-3').click();
  await page.keyboard.press('KeyI');
  await expect(page.getByTestId('skill-slot-3')).toContainText('Lunging');
  await expect(page.getByTestId('skill-slot-1')).not.toContainText('Lunging');
  expect(errors).toEqual([]);
});

test('versioned build and performance report (M4 evidence)', async ({ page }) => {
  const errors = await newGame(page);
  // The title screen showed the build; the pause menu shows it too, with the performance report.
  await page.waitForTimeout(1500); // a little frame history for the report
  await page.evaluate(() => (window as unknown as { __alloy: { game: { openPause: () => void } } }).__alloy.game.openPause());
  await expect(page.getByTestId('build-label')).toContainText(/Build v\d+\.\d+\.\d+ \(/);
  await page.getByTestId('copy-perf-report').click();
  const report = page.getByTestId('perf-report');
  await expect(report).toBeVisible();
  const text = await report.inputValue();
  expect(text).toContain('Alloy Frontier performance report');
  expect(text).toMatch(/Build: v\d+\.\d+\.\d+/);
  expect(text).toMatch(/Frame rate \(last \d+ frames\): average \d+ FPS/);
  expect(text).toContain('graphics preset:');
  expect(errors).toEqual([]);
});

test('herbs and potions: pick Emberleaf, brew a salve, heal with key 5', async ({ page }) => {
  const errors = await newGame(page);
  const herb = { id: 'herb-0', x: 4.32, z: -9 }; // HERB_NODES[0]
  // Stand next to the patch, facing it, and pick it by hand (E). Retry if interrupted.
  await expect(async () => {
    await call(page, 'teleport', herb.x, herb.z - 1.6);
    await call(page, 'face', 0);
    await page.waitForTimeout(300);
    await expect(page.getByTestId('prompt')).toContainText('Emberleaf');
    await page.keyboard.press('KeyE');
    await expect.poll(async () => (await state(page)).totals.emberleaf ?? 0, { timeout: 4000 }).toBeGreaterThan(0);
  }).toPass({ timeout: 20_000 });
  // Top up herbs (debug) and brew a salve on the Inventory screen.
  await call(page, 'give', 'emberleaf', 4, 0.6);
  await page.keyboard.press('KeyI');
  await page.getByTestId('tab-inventory').click();
  await page.getByTestId('brew-healing_salve-1').click();
  await expect(page.getByTestId('have-healing_salve')).toHaveText('×1');
  await page.keyboard.press('KeyI');
  await expect.poll(async () => (await state(page)).modal).toBeNull();
  // Take some damage (debug), then heal with key 5.
  await page.evaluate(() => ((window as unknown as { __alloy: { hurt?: (n: number) => void } }).__alloy.hurt ?? (() => undefined))(100));
  const before = (await state(page)).health;
  expect(before).toBeLessThan(200);
  await page.keyboard.press('Digit5');
  await expect.poll(async () => (await state(page)).health).toBeGreaterThan(before);
  await expect(page.getByTestId('potion-slot-5')).toContainText('×0');
  expect(errors).toEqual([]);
});

test('walk-in forge: examine Emberwake, search barrels, read an enemy level', async ({ page }) => {
  const errors = await newGame(page);
  // Inside the forge, in front of Orla's masterwork on the left wall.
  await expect(async () => {
    await call(page, 'teleport', -13.24, 15.63);
    await page.waitForTimeout(300);
    await expect(page.getByTestId('prompt')).toContainText('Emberwake', { timeout: 2000 });
    await page.keyboard.press('KeyE');
    await expect(page.getByRole('dialog', { name: 'Emberwake' })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByRole('dialog', { name: 'Emberwake' })).toContainText('Master Smith Orla');
  await page.locator('[data-option="0"]').click();
  await expect.poll(async () => (await state(page)).modal).toBeNull();
  // The barrels by the forge: search once, then they are empty until they refill.
  await expect(async () => {
    await call(page, 'teleport', -18.34, 9.88);
    await page.waitForTimeout(300);
    await expect(page.getByTestId('prompt')).toContainText('Search the barrels', { timeout: 2000 });
    await page.keyboard.press('KeyE');
    await expect(page.getByTestId('prompt')).toContainText('Searched', { timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  // Scavengers on the trail show their level from a distance.
  await call(page, 'teleport', 4, 30);
  await call(page, 'face', 0);
  await expect(page.getByTestId('enemy-level-scav-1')).toHaveText('Lv 1', { timeout: 10_000 });
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

test('forge expansion: forge a shield, helmet and mace from their tabs; they show on the character', async ({ page }) => {
  const errors = await newGame(page);
  // A smith past the forge introduction, with materials, at the anvil.
  await page.evaluate(() => {
    const a = (window as unknown as { __alloy: Record<string, (...x: unknown[]) => unknown> }).__alloy;
    const s = a.session() as { data: { quest: { stepIndex: number }; progression: { professions: { blacksmithing: { mastery: number } } } } };
    s.data.quest.stepIndex = 8;
    s.data.progression.professions.blacksmithing.mastery = 5;
    for (const m of ['iron_ore', 'ironwood', 'binding_flux']) a.give(m, 30, 0.6);
    a.teleport(-14, 13.5);
    (a.game as unknown as { openForge: () => void }).openForge();
  });
  await expect(page.locator('[data-category]')).toHaveCount(5);
  for (const [tab, bp] of [['shields', 'iron_shield'], ['helmets', 'iron_helmet'], ['maces', 'iron_mace']] as const) {
    await page.locator(`[data-category="${tab}"]`).click();
    await page.locator(`[data-blueprint="${bp}"]`).click();
    // Armor shows defense; the mace shows damage.
    await expect(page.locator('.stat-table').filter({ hasText: 'Equipment rating' }).first()).toContainText(bp === 'iron_mace' ? 'Damage' : 'Defense');
    await page.getByTestId('quick-forge-confirm').click();
    await page.getByTestId('equip-result').click();
    await expect(page.getByTestId('equip-result')).toHaveText('Equipped');
    await page.getByRole('button', { name: 'Forge another' }).click();
  }
  // The shield rides the left forearm and the helmet the head (built by the workshop generator).
  await expect
    .poll(() => page.evaluate(() => ((window as unknown as { __alloy: { game: { player: { gearRack: { pieces: Array<{ parent: { name: string } | null }> } } } } }).__alloy.game.player.gearRack.pieces.map((p) => p.parent?.name).sort())), { timeout: 15_000 })
    .toEqual(['Head', 'LeftForeArm']);
  const eq = await page.evaluate(() => {
    const s = (window as unknown as { __alloy: { session: () => { data: { inventory: { equipped: Record<string, string | null>; items: Record<string, { blueprintId: string }> } } } } }).__alloy.session();
    const inv = s.data.inventory;
    return Object.fromEntries(['weapon', 'offhand', 'head'].map((k) => [k, inv.items[inv.equipped[k] ?? '']?.blueprintId ?? null]));
  });
  expect(eq).toEqual({ weapon: 'iron_mace', offhand: 'iron_shield', head: 'iron_helmet' });
  expect(errors).toEqual([]);
});

test('found blueprints: learn a scroll in the inventory (it stays), then forge it at the anvil', async ({ page }) => {
  const errors = await newGame(page);
  type A = Record<string, (...x: unknown[]) => unknown>;
  const scroll = (await page.evaluate(() => {
    const a = (window as unknown as { __alloy: A }).__alloy;
    const s = a.session() as { data: { quest: { stepIndex: number }; progression: { professions: { blacksmithing: { mastery: number } } } } };
    s.data.quest.stepIndex = 8;
    s.data.progression.professions.blacksmithing.mastery = 60;
    for (const m of ['iron_ore', 'ironwood', 'ironglass', 'binding_flux']) a.give(m, 40, 0.6);
    return a.blueprint('trail', 'e2e-blueprint', 5);
  })) as string;
  expect(scroll).toMatch(/^scr-/);
  // Learn it on the Inventory screen; the scroll stays, and learning again isn't offered.
  await page.keyboard.press('KeyI');
  await page.getByRole('tab', { name: 'Inventory' }).click();
  await page.getByTestId(`learn-${scroll}`).click();
  await expect(page.getByTestId(`learn-${scroll}`)).toHaveText('Learned');
  await expect(page.locator(`[data-scroll="${scroll}"]`)).toBeVisible();
  // The scroll shows the range of stats it makes (the creative director's yes, 28 Nov).
  await expect(page.getByTestId(`estimate-${scroll}`)).toHaveText(/^Estimated \d+–\d+ (damage|defense)$/);
  await page.keyboard.press('Escape');
  // Forge it: it is listed under its category, marked Found.
  const bp = await page.evaluate(() => {
    const a = (window as unknown as { __alloy: A }).__alloy;
    const inv = (a.session() as { data: { inventory: { learned: Record<string, { id: string; piece: { family: string } }> } } }).data.inventory;
    a.teleport(-14, 13.5);
    (a.game as unknown as { openForge: () => void }).openForge();
    return Object.values(inv.learned)[0];
  });
  const tab = ({ longsword: 'swords', mace: 'maces', shield: 'shields', helmet: 'helmets', chest: 'body', legs: 'body' } as Record<string, string>)[bp.piece.family];
  await page.locator(`[data-category="${tab}"]`).click();
  const card = page.locator(`[data-blueprint="${bp.id}"]`);
  await expect(card).toContainText('Found');
  await card.click();
  await page.getByTestId('quick-forge-confirm').click();
  await expect(page.getByTestId('equip-result')).toBeVisible();
  const made = await page.evaluate((id) => {
    const inv = ((window as unknown as { __alloy: A }).__alloy.session() as { data: { inventory: { items: Record<string, { blueprintId: string; blueprint?: { id: string } }> } } }).data.inventory;
    return Object.values(inv.items).find((i) => i.blueprintId === id)?.blueprint?.id ?? null;
  }, bp.id);
  expect(made).toBe(bp.id);
  expect(errors).toEqual([]);
});

test('perk choices: pick Weaponsmith on the Proficiencies screen, and the next sword carries it', async ({ page }) => {
  const errors = await newGame(page);
  type A = Record<string, (...x: unknown[]) => unknown>;
  await page.keyboard.press('KeyI');
  await page.getByRole('tab', { name: 'Proficiencies' }).click();
  // A new smith starts at Smithing 10: the first choice is waiting.
  await expect(page.getByTestId('perk-smithing-10')).toContainText('choose one');
  await expect(page.getByTestId('perk-crafting-10')).toContainText('Jeweler or Tailor');
  await expect(page.getByTestId('perk-crafting-20')).toContainText('coming soon');
  await page.locator('[data-perk="weaponsmith"]').click();
  await expect(page.getByTestId('perk-smithing-10')).toContainText('Weaponsmith ✓');
  await expect(page.getByTestId('perk-respec-smithing')).toContainText('50');
  await page.keyboard.press('Escape');
  const perks = await page.evaluate(() => {
    const a = (window as unknown as { __alloy: A }).__alloy;
    const s = a.session() as { data: { quest: { stepIndex: number }; inventory: { items: Record<string, { blueprintId: string; forge: { perks?: string[] } }> } }; forge: (r: unknown) => { ok: boolean } };
    s.data.quest.stepIndex = 8;
    for (const m of ['iron_ore', 'ironwood', 'binding_flux']) a.give(m, 20, 0.6);
    a.teleport(-14, 13.5);
    s.forge({ txId: 'e2e-perk', blueprintId: 'iron_longsword', mode: 'quick', bufferQuantity: 2 });
    return Object.values(s.data.inventory.items).find((i) => i.blueprintId === 'iron_longsword')?.forge.perks ?? null;
  });
  expect(perks).toEqual(['weaponsmith']);
  expect(errors).toEqual([]);
});

test('the workbench: press E at it, craft a ring, equip it; Crafting XP rises', async ({ page }) => {
  const errors = await newGame(page);
  type A = Record<string, (...x: unknown[]) => unknown>;
  await page.evaluate(() => {
    const a = (window as unknown as { __alloy: A }).__alloy;
    const s = a.session() as { data: { quest: { stepIndex: number } } };
    s.data.quest.stepIndex = 8;
    for (const m of ['iron_ore', 'ironglass', 'binding_flux', 'emberleaf', 'ironwood']) a.give(m, 10, 0.6);
    a.teleport(-18.86, 13.33);
  });
  await expect(page.getByTestId('prompt')).toContainText('Use the workbench');
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await state(page)).modal).toBe('workbench');
  await expect(page.locator('[data-recipe]')).toHaveCount(4);
  await expect(page.locator('[data-recipe="ironglass_ring"]')).toContainText('Crafting 5'); // locked at level 1
  await page.getByTestId('craft-iron_band').click();
  await expect(page.getByTestId('crafted')).toContainText('Iron Signet Band');
  await page.getByTestId('equip-crafted').click();
  await expect(page.getByTestId('equip-crafted')).toHaveText('Equipped');
  const after = await page.evaluate(() => {
    const s = ((window as unknown as { __alloy: A }).__alloy.session() as { data: { inventory: { equipped: Record<string, string | null>; items: Record<string, { family: string }> }; progression: { professions: { crafting?: { xp: number } } } } }).data;
    return { ring: s.inventory.items[s.inventory.equipped.ring1 ?? '']?.family ?? null, xp: s.progression.professions.crafting?.xp ?? 0 };
  });
  expect(after.ring).toBe('ring');
  expect(after.xp).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('sell a blueprint scroll to Bram, and show a title earned at Smithing 25', async ({ page }) => {
  const errors = await newGame(page);
  type A = Record<string, (...x: unknown[]) => unknown>;
  const scroll = (await page.evaluate(() => {
    const a = (window as unknown as { __alloy: A }).__alloy;
    const id = a.blueprint('trail', 'e2e-sell', 3);
    a.teleport(11, 6.5);
    (a.game as unknown as { openMerchant: () => void }).openMerchant();
    return id;
  })) as string;
  const coins = () => page.evaluate(() => ((window as unknown as { __alloy: A }).__alloy.session() as { data: { inventory: { coins: number } } }).data.inventory.coins);
  const before = await coins();
  await page.getByTestId(`sell-${scroll}`).click();
  await expect.poll(coins).toBeGreaterThan(before);
  await expect(page.getByTestId(`sell-${scroll}`)).toHaveCount(0);
  await page.keyboard.press('Escape');
  // A title: earned at Smithing 25, shown from the Proficiencies screen.
  await page.evaluate(() => {
    ((window as unknown as { __alloy: A }).__alloy.session() as { data: { progression: { professions: { blacksmithing: { mastery: number } } } } }).data.progression.professions.blacksmithing.mastery = 25;
  });
  await page.keyboard.press('KeyI');
  await page.getByRole('tab', { name: 'Proficiencies' }).click();
  await page.getByTestId('title-journeyman_smith').click();
  await expect(page.getByTestId('titles')).toContainText('Shown above your name: Journeyman Smith');
  await expect(page.getByTestId('title-forgewright')).toHaveCount(0); // not earned yet
  expect(errors).toEqual([]);
});
