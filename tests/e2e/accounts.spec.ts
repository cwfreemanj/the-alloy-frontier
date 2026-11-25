/**
 * Accounts in real browsers: the same character on a different browser, one device at a
 * time, and bringing a guest character into a new account.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const WORLD = 'http://localhost:2569';
const uniq = () => `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.slice(0, 20);

type S = { started: boolean; modal: string | null; quest: { step: string }; equipped: { name: string } | null; coins: number; world: { status: string; name: string; mode: string } };
const state = (p: Page) => p.evaluate(() => (window as unknown as { __alloy: { state: () => S } }).__alloy.state());

async function freshBrowser(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); // separate storage = a different browser
  const page = await ctx.newPage();
  await page.goto(`${WORLD}/?debug`);
  return page;
}

type Hooks = {
  teleport: (x: number, z: number) => number;
  act: (a: unknown) => Promise<{ ok: boolean; error?: string }>;
  coins: (n: number) => boolean;
  give: (m: string, q: number) => boolean;
  save: () => string;
};
const ORLA = { x: -9, z: 7.6 };
const act = (p: Page, a: unknown) => p.evaluate((x) => (window as unknown as { __alloy: Hooks }).__alloy.act(x), a);
/** After a teleport, the server learns the new position with the next avatar update; retry until it has. */
const actWhenThere = (p: Page, a: unknown) => expect.poll(async () => (await act(p, a)).ok, { timeout: 15_000, intervals: [300] }).toBe(true);

async function signIn(page: Page, username: string, password: string, create: boolean): Promise<void> {
  await page.getByTestId('acct-username').fill(username);
  await page.getByTestId('acct-password').fill(password);
  await page.getByTestId(create ? 'acct-register' : 'acct-signin').click();
  await expect(page.getByTestId('acct-name')).toHaveText(username, { timeout: 15_000 });
}

test('the same character on a different browser; one device at a time', async ({ browser }) => {
  test.setTimeout(120_000);
  const user = uniq();
  const pw = 'forge-and-anvil';

  // Browser 1: create an account and make progress.
  const a = await freshBrowser(browser);
  await signIn(a, user, pw, true);
  await a.getByTestId('acct-new').click();
  await expect.poll(async () => (await state(a)).world.status, { timeout: 15_000 }).toBe('online');
  expect((await state(a)).world.name).toBe(user);
  // Talk to Orla through the server (it checks we're next to her, then grants the sword).
  await a.evaluate(({ x, z }) => (window as unknown as { __alloy: Hooks }).__alloy.teleport(x, z), ORLA);
  await actWhenThere(a, { k: 'talk', npc: 'orla' });
  const before = await state(a);
  expect(before.quest.step).toBe('first_blood');
  expect(before.equipped?.name).toBeTruthy();
  await a.evaluate(() => (window as unknown as { __alloy: { game: { online: { disconnect: () => void } } } }).__alloy.game.online.disconnect());
  await a.waitForTimeout(500); // leaving the world makes the server write the character

  // Browser 2: a completely separate browser signs in and continues the same character.
  const b = await freshBrowser(browser);
  await signIn(b, user, pw, false);
  await b.getByTestId('acct-continue').click();
  await expect.poll(async () => (await state(b)).started).toBe(true);
  const after = await state(b);
  expect(after.quest.step).toBe(before.quest.step);
  expect(after.coins).toBe(before.coins);
  expect(after.equipped?.name).toBe(before.equipped?.name);

  await a.context().close();
  await b.context().close();
});

test('signing in on a second device signs the first out of the world', async ({ browser }) => {
  test.setTimeout(120_000);
  const user = uniq();
  const a = await freshBrowser(browser);
  await signIn(a, user, 'forge-and-anvil', true);
  await a.getByTestId('acct-new').click();
  await expect.poll(async () => (await state(a)).world.status, { timeout: 15_000 }).toBe('online');
  const b = await freshBrowser(browser);
  await signIn(b, user, 'forge-and-anvil', false);
  await b.getByTestId('acct-continue').click();
  await expect.poll(async () => (await state(b)).world.status, { timeout: 15_000 }).toBe('online');
  // Browser 1 is sent back to the title screen with an explanation.
  await expect(a.getByTestId('acct-error')).toContainText('another device', { timeout: 15_000 });
  expect((await state(a)).started).toBe(false);
  await a.context().close();
  await b.context().close();
});

test('a signed-in character cannot be changed from the browser', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await freshBrowser(browser);
  const user = uniq();
  await signIn(page, user, 'no-cheating-here', true);
  await page.getByTestId('acct-new').click();
  await expect.poll(async () => (await state(page)).world.status, { timeout: 15_000 }).toBe('online');
  const start = await state(page);

  // The debug grants refuse, and nothing changes.
  expect(await page.evaluate(() => (window as unknown as { __alloy: Hooks }).__alloy.coins(999))).toBe(false);
  expect(await page.evaluate(() => (window as unknown as { __alloy: Hooks }).__alloy.give('ironglass', 50))).toBe(false);
  // Editing the in-browser copy directly is overwritten by the server's next update.
  await page.evaluate(() => {
    const s = (window as unknown as { __alloy: { session: () => { addCoins: (n: number) => void } } }).__alloy.session();
    s.addCoins(5000);
  });
  // A real action far from Orla is refused by the server (out of range).
  await page.evaluate(() => (window as unknown as { __alloy: Hooks }).__alloy.teleport(60, 60));
  await page.waitForTimeout(1500);
  expect(await act(page, { k: 'talk', npc: 'orla' })).toMatchObject({ ok: false, error: 'out_of_range' });
  // Gathering through the server works and its update replaces the edited copy.
  const node = { x: -6, z: 40 }; // ore-t1
  await page.evaluate(({ x, z }) => (window as unknown as { __alloy: Hooks }).__alloy.teleport(x + 1, z), node);
  await actWhenThere(page, { k: 'gather', node: 'ore-t1' });
  // The server's character update follows its reply to the action: wait for it.
  await expect.poll(async () => (await state(page)).coins).toBe(start.coins);
  // Uploading a save is no longer possible.
  const status = await page.evaluate(async () => {
    const auth = JSON.parse(localStorage.getItem('alloy-frontier.auth.v1')!);
    const r = await fetch('/api/save', { method: 'PUT', headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ save: '{}', revision: 1 }) });
    return r.status;
  });
  expect(status).toBe(410);
  await page.context().close();
});

test('a guest character can be brought into a new account', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await freshBrowser(browser);
  await expect(page.getByTestId('acct-username')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('new-game').click(); // play as guest
  await page.evaluate(() => (window as unknown as { __alloy: { session: () => { talk: (n: string) => void } } }).__alloy.session().talk('orla'));
  await page.evaluate(() => (window as unknown as { __alloy: { save: () => string } }).__alloy.save());
  await page.reload();

  await signIn(page, uniq(), 'guest-to-account', true);
  await page.getByTestId('acct-import').click();
  await expect.poll(async () => (await state(page)).started).toBe(true);
  expect((await state(page)).quest.step).toBe('first_blood');
  expect((await state(page)).world.mode).toBe('account');
  await page.waitForTimeout(800);

  // Reload: the account now has the character (Continue appears, no import offer).
  await page.reload();
  await expect(page.getByTestId('acct-continue')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('acct-import')).toHaveCount(0);
  await page.context().close();
});

test('wrong password and taken usernames show clear messages', async ({ browser }) => {
  const page = await freshBrowser(browser);
  const user = uniq();
  await signIn(page, user, 'first-password', true);
  await page.getByTestId('acct-signout').click();
  await page.getByTestId('acct-username').fill(user);
  await page.getByTestId('acct-password').fill('not-the-password');
  await page.getByTestId('acct-signin').click();
  await expect(page.getByTestId('acct-error')).toContainText('Wrong username or password');
  await page.getByTestId('acct-username').fill(user.toUpperCase());
  await page.getByTestId('acct-password').fill('another-password');
  await page.getByTestId('acct-register').click();
  await expect(page.getByTestId('acct-error')).toContainText('taken');
  await page.context().close();
});
