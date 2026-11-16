import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'

// Each launch gets a fresh data folder, so the test never touches real data.
const launch = (dir: string): Promise<ElectronApplication> =>
  electron.launch({ args: ['.', `--user-data-dir=${dir}`] })

async function addAccount(page: Page, preset: string, balance: string): Promise<void> {
  await page.getByRole('button', { name: 'Add account' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: 'Institution' }).click()
  await page.getByRole('option', { name: preset }).click()
  await expect(dialog.getByLabel('Account name')).toHaveValue(preset)
  await dialog.getByLabel(/Current balance/).fill(balance)
  await dialog.getByRole('button', { name: 'Save account' }).click()
  await expect(dialog).toBeHidden()
}

async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole('dialog').getByRole('combobox', { name: label }).click()
  await page.getByRole('option', { name: option }).click()
}

test('accounts, transactions and net worth work end to end and survive a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'buri-e2e-'))
  let app = await launch(dir)
  let page = await app.firstWindow()
  const nav = (name: string): Promise<void> =>
    page.getByRole('link', { name }).or(page.getByRole('button', { name })).first().click()
  const shot = (name: string): Promise<Buffer> =>
    page.screenshot({ path: `e2e/screenshots/${name}.png` })

  // The renderer is isolated from Node and only sees the typed API.
  expect(await page.evaluate(() => typeof (window as never)['require'])).toBe('undefined')
  expect(
    await page.evaluate(() => Object.keys((window as unknown as { api: object }).api).sort())
  ).toEqual([
    'accounts',
    'bills',
    'budgets',
    'categories',
    'goals',
    'investments',
    'netWorth',
    'rules',
    'settings',
    'transactions'
  ])

  await expect(page.getByRole('heading', { name: 'Your net worth starts here' })).toBeVisible()
  await shot('1-empty-overview')
  await page.getByRole('button', { name: 'Add account' }).click()
  await expect(page.getByRole('heading', { name: 'No accounts yet' })).toBeVisible()

  await addAccount(page, 'GoTyme', '10,000')
  await addAccount(page, 'GoTrade', '0')
  await expect(page.getByRole('row', { name: /GoTyme/ })).toContainText('PHP 10,000.00')
  await expect(page.getByRole('row', { name: /GoTrade/ })).toContainText('USD 0.00')
  await shot('2-accounts')

  await nav('Transactions')
  const dialog = page.getByRole('dialog')
  const add = async (fill: () => Promise<void>): Promise<void> => {
    await page.getByRole('button', { name: 'Add transaction' }).first().click()
    await fill()
    await dialog.getByRole('button', { name: 'Save transaction' }).click()
    await expect(dialog).toBeHidden()
  }

  // Invalid input is refused before anything is saved.
  await page.getByRole('button', { name: 'Add transaction' }).first().click()
  await dialog.getByRole('button', { name: 'Save transaction' }).click()
  await expect(dialog.getByText('Choose an account', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Enter an amount like 1,234.50', { exact: true })).toBeVisible()
  await shot('3-validation')
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  await add(async () => {
    await choose(page, 'Account', 'GoTyme')
    await dialog.getByLabel(/^Amount/).fill('19.99')
    await dialog.getByLabel('Paid to').fill('Lunch')
  })
  await add(async () => {
    await dialog.getByRole('radio', { name: 'Income' }).click()
    await choose(page, 'Account', 'GoTyme')
    await dialog.getByLabel(/^Amount/).fill('50,000')
    await dialog.getByLabel('Received from').fill('Salary')
  })
  await add(async () => {
    await dialog.getByRole('radio', { name: 'Transfer' }).click()
    await choose(page, 'From account', 'GoTyme')
    await choose(page, 'To account', 'GoTrade')
    await dialog.getByLabel(/Amount sent \(PHP\)/).fill('5,800')
    await dialog.getByLabel(/Amount received \(USD\)/).fill('100')
  })
  await expect(page.getByRole('row', { name: /Lunch/ })).toContainText('-PHP 19.99')
  await expect(page.getByRole('row', { name: /Salary/ })).toContainText('PHP 50,000.00')
  await expect(page.getByRole('row', { name: /GoTyme → GoTrade/ })).toContainText('USD 100.00')
  await shot('4-transactions')

  // 10,000 - 19.99 + 50,000 - 5,800 = 54,180.01
  await nav('Overview')
  await expect(page.getByText('Net worth · PHP')).toBeVisible()
  await expect(page.getByText('PHP 54,180.01').first()).toBeVisible()
  await expect(page.getByText('USD 100.00').first()).toBeVisible()
  await shot('5-overview')

  // Deleting a transaction puts the balance back.
  await nav('Transactions')
  await page.getByRole('button', { name: /Delete Lunch/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('row', { name: /Lunch/ })).toHaveCount(0)

  // Command palette and dark mode.
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByRole('combobox').fill('Sett')
  await expect(page.getByRole('option')).toHaveCount(1)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await page.getByRole('radio', { name: 'Dark' }).click()
  await nav('Overview')
  await expect(page.getByText('PHP 54,200.00').first()).toBeVisible()
  await shot('6-overview-dark')
  await app.close()

  // Data and settings persist in the encrypted database.
  app = await launch(dir)
  page = await app.firstWindow()
  await expect(page.getByText('PHP 54,200.00').first()).toBeVisible()
  await nav('Settings')
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked()
  await app.close()
})
