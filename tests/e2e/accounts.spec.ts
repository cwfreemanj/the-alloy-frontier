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
  await a.evaluate(() => (window as unknown as { __alloy: { session: () => { talk: (n: string) => void; addCoins: (n: number) => void } } }).__alloy.session().talk('orla'));
  await a.evaluate(() => (window as unknown as { __alloy: { coins: (n: number) => void } }).__alloy.coins(123));
  const before = await state(a);
  expect(before.quest.step).toBe('first_blood');
  expect(before.equipped?.name).toBeTruthy();
  await a.evaluate(() => (window as unknown as { __alloy: { save: () => string } }).__alloy.save());
  await a.waitForTimeout(800); // let the save reach the server

  // Browser 2: a completely separate browser signs in and continues the same character.
  const b = await freshBrowser(browser);
  await signIn(b, user, pw, false);
  await b.getByTestId('acct-continue').click();
  await expect.poll(async () => (await state(b)).started).toBe(true);
  const after = await state(b);
  expect(after.quest.step).toBe(before.quest.step);
  expect(after.coins).toBe(before.coins);
  expect(after.equipped?.name).toBe(before.equipped?.name);

  // Browser 1 is sent back to the title screen with an explanation.
  await expect(a.getByTestId('acct-error')).toContainText('another device', { timeout: 15_000 });
  expect((await state(a)).started).toBe(false);
  await a.context().close();
  await b.context().close();
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
