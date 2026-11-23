/**
 * Shared world in real browsers: two separate players (separate storage) open the same
 * address, join automatically, see each other, fight the same server-run enemy and both
 * get quest credit for the kill.
 */
import { expect, test, type Page } from '@playwright/test';

const WORLD = 'http://localhost:2569';

type W = { status: string; id: string | null; name: string; others: Array<{ id: string; name: string; x: number; z: number; hp: number | null }> };
type S = { world: W; quest: { step: string }; enemies: Array<{ id: string; state: string; hp: number; x: number; z: number }>; pos: { x: number; z: number } };
const state = (p: Page) => p.evaluate(() => (window as unknown as { __alloy: { state: () => S } }).__alloy.state());
const call = (p: Page, fn: string, ...args: unknown[]) =>
  p.evaluate(([f, a]) => (window as unknown as Record<string, Record<string, (...x: unknown[]) => unknown>>).__alloy[f as string](...(a as unknown[])), [fn, args] as const);

async function enter(page: Page, name: string): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${WORLD}/?debug`);
  await page.getByTestId('player-name').fill(name);
  await page.getByTestId('new-game').click();
  await expect.poll(async () => (await state(page)).world.status, { timeout: 15_000 }).toBe('online');
  expect(errors).toEqual([]);
}

test('two players share one world: presence, movement, a shared fight and shared kill credit', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await enter(a, 'Alpha');
  await enter(b, 'Bravo');

  // Presence: each sees the other by name, with no codes or addresses typed.
  await expect.poll(async () => (await state(a)).world.others.map((o) => o.name), { timeout: 10_000 }).toContain('Bravo (guest)');
  await expect.poll(async () => (await state(b)).world.others.map((o) => o.name), { timeout: 10_000 }).toContain('Alpha (guest)');
  await expect(a.getByTestId('world-status')).toContainText('Bravo');

  // Movement replicates.
  await call(b, 'teleport', 6, 12);
  await expect.poll(async () => (await state(a)).world.others.find((o) => o.name.startsWith('Bravo'))?.z, { timeout: 5_000 }).toBeGreaterThan(10);

  // Both take the quest and a sword from Orla, then meet at the same scavenger.
  for (const p of [a, b]) await p.evaluate(() => (window as unknown as { __alloy: { session: () => { talk: (n: string) => void } } }).__alloy.session().talk('orla'));
  const scav = (await state(a)).enemies.find((e) => e.id === 'scav-1')!;
  await call(a, 'teleport', scav.x, scav.z - 2);
  await call(b, 'teleport', scav.x, scav.z + 2);
  await a.waitForTimeout(600);

  // Fight: each faces the enemy (from its own view of the server's position) and attacks.
  let dead = false;
  for (let i = 0; i < 80 && !dead; i++) {
    for (const p of [a, b]) {
      const s = await state(p);
      const e = s.enemies.find((x) => x.id === 'scav-1')!;
      if (e.state === 'dead') {
        dead = true;
        break;
      }
      if (Math.hypot(e.x - s.pos.x, e.z - s.pos.z) > 2.4) await call(p, 'teleport', e.x - 1.6 * Math.sign(e.x - s.pos.x || 1), e.z);
      await call(p, 'face', Math.atan2(e.x - s.pos.x, e.z - s.pos.z));
      await call(p, 'heal');
      await p.keyboard.press('KeyJ');
    }
    await a.waitForTimeout(250);
  }
  expect(dead).toBe(true);

  // Same enemy is dead in both views, and both players got credit (quest moved past "first blood").
  await expect.poll(async () => (await state(b)).enemies.find((e) => e.id === 'scav-1')!.state, { timeout: 5_000 }).toBe('dead');
  await expect.poll(async () => (await state(a)).quest.step, { timeout: 5_000 }).not.toBe('first_blood');
  await expect.poll(async () => (await state(b)).quest.step, { timeout: 5_000 }).not.toBe('first_blood');

  // Evidence screenshot: Alpha's view with Bravo in it.
  await call(a, 'teleport', 4, 8);
  await call(b, 'teleport', 4, 12);
  await call(a, 'face', 0);
  await a.waitForTimeout(800);
  await a.screenshot({ path: 'docs/multiplayer-view.png' });

  // Leaving is seen by the other player.
  await ctxB.close();
  await expect.poll(async () => (await state(a)).world.others.some((o) => o.name.startsWith('Bravo')), { timeout: 15_000 }).toBe(false);
  await ctxA.close();
});
