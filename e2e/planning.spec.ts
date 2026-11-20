import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'

let page: Page
let dialog: Locator

const go = (name: string): Promise<void> =>
  page.getByRole('link', { name }).or(page.getByRole('button', { name })).first().click()
// Takes a screenshot, and fails if a table needs sideways scrolling or a cell clips its content
// at the default window size.
async function shot(name: string): Promise<void> {
  await page.screenshot({ path: `e2e/screenshots/${name}.png` })
  const overflowing = await page.evaluate(() =>
    [...document.querySelectorAll('.astryx-table-scroll-wrapper, td, th')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map(
        (el) =>
          `${el.tagName} "${el.textContent?.slice(0, 40)}" ${el.scrollWidth}>${el.clientWidth}`
      )
  )
  expect(overflowing, name).toEqual([])
}
const row = (name: RegExp): Locator => page.getByRole('row', { name }).first()

async function choose(label: string, option: string): Promise<void> {
  await dialog.getByRole('combobox', { name: label }).click()
  await page.getByRole('option', { name: option }).click()
}

// Opens a form with `button`, fills it, saves with `submit`, and waits for it to close.
async function form(button: string, submit: string, fill: () => Promise<void>): Promise<void> {
  await page.getByRole('button', { name: button }).first().click()
  await fill()
  await dialog.getByRole('button', { name: submit }).click()
  await expect(dialog).toBeHidden()
}

const addAccount = (preset: string, balance: string): Promise<void> =>
  form('Add account', 'Save account', async () => {
    await choose('Institution', preset)
    await dialog.getByLabel(/Current balance/).fill(balance)
  })

test('budgets, goals and investments work end to end', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'buri-e2e-'))
  const app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`] })
  page = await app.firstWindow()
  dialog = page.getByRole('dialog')

  await go('Accounts')
  await addAccount('GoTyme', '100,000')
  await addAccount('DragonFi', '50,000')
  await addAccount('GoTrade', '')

  // Budgets: categories, a monthly budget with rollover, and an income rule.
  await go('Budgets')
  await expect(page.getByRole('heading', { name: 'No categories yet' })).toBeVisible()
  for (const name of ['Food', 'Savings']) {
    await form('Add category', 'Save category', () => dialog.getByLabel('Category name').fill(name))
  }
  await form('Set budget for Food', 'Save budget', async () => {
    await dialog.getByLabel(/Monthly budget/).fill('10,000')
    await dialog.getByRole('switch', { name: 'Roll over unspent money' }).check()
  })
  await form('Add rule', 'Save rule', async () => {
    await choose('Category', 'Savings')
    await dialog.getByLabel('Percent', { exact: true }).fill('20')
  })
  await expect(row(/20\.00% of income/)).toContainText('Savings')

  // Income is proposed across budgets by the rule; the user edits the split, then confirms.
  await go('Transactions')
  await page.getByRole('button', { name: 'Add transaction' }).first().click()
  await dialog.getByRole('radio', { name: 'Income' }).click()
  await choose('Account', 'GoTyme')
  await dialog.getByLabel(/^Amount/).fill('50,000')
  await dialog.getByLabel('Received from').fill('Salary')
  await dialog.getByRole('button', { name: 'Save transaction' }).click()
  await expect(dialog.getByRole('heading', { name: 'Allocate this income' })).toBeVisible()
  await expect(dialog.getByLabel('Savings (PHP)')).toHaveValue('10,000.00')
  await shot('7-allocate-income')
  await dialog.getByLabel('Savings (PHP)').fill('8,000')
  await dialog.getByRole('button', { name: 'Confirm and save' }).click()
  await expect(dialog).toBeHidden()

  await form('Add transaction', 'Save transaction', async () => {
    await choose('Account', 'GoTyme')
    await dialog.getByLabel(/^Amount/).fill('1,250.50')
    await dialog.getByLabel('Paid to').fill('Groceries')
    await choose('Category', 'Food')
  })
  await expect(row(/Groceries/)).toContainText('Food')

  await go('Budgets')
  await expect(row(/Food/)).toContainText('PHP 10,000.00')
  await expect(row(/Food/)).toContainText('PHP 1,250.50')
  await expect(row(/Food/)).toContainText('PHP 8,749.50')
  await expect(row(/Savings/)).toContainText('PHP 8,000.00')
  await shot('8-budgets')

  // Unspent money rolls into next month; the weekly view shows a pro-rated share.
  await page.getByRole('button', { name: 'Next period' }).click()
  await expect(row(/Food/)).toContainText('PHP 8,749.50')
  await expect(row(/Food/)).toContainText('PHP 0.00')
  await page.getByRole('button', { name: 'Previous period' }).click()
  await page.getByRole('radio', { name: 'Weekly' }).click()
  await expect(page.getByText(/this week's share of the month's budget/)).toBeVisible()
  await expect(row(/Food/)).not.toContainText('PHP 10,000.00')
  await shot('9-budgets-weekly')
  await page.getByRole('radio', { name: 'Monthly' }).click()

  // Goals: GoTyme holds 100,000 + 50,000 - 1,250.50 = 148,749.50 of a 200,000 target.
  await go('Goals')
  await expect(page.getByRole('heading', { name: 'No goals yet' })).toBeVisible()
  await form('Add goal', 'Save goal', async () => {
    await dialog.getByLabel('Goal name').fill('Emergency fund')
    await dialog.getByLabel('Target amount').fill('200,000')
    await choose('Account', 'GoTyme')
  })
  await expect(row(/Emergency fund/)).toContainText('74% · PHP 148,749.50 saved')
  await expect(row(/Emergency fund/)).toContainText('PHP 51,250.50 to go')
  await shot('10-goals')

  // Investments: buy with cash, reprice, sell part, and a fractional US holding.
  await go('Investments')
  await expect(page.getByRole('heading', { name: 'No holdings yet' })).toBeVisible()
  await form('Add holding', 'Save holding', async () => {
    await choose('Account', 'DragonFi')
    await dialog.getByLabel('Symbol').fill('bdo')
    await dialog.getByLabel('Quantity', { exact: true }).fill('100')
    await dialog.getByLabel(/Price per share/).fill('128.50')
  })
  await expect(row(/BDO.*DragonFi/)).toContainText('PHP 12,850.00')
  await form('Update BDO price', 'Save price', () =>
    dialog.getByLabel(/Price per share/).fill('140.25')
  )
  await expect(row(/BDO.*DragonFi/)).toContainText('PHP 14,025.00')
  await expect(row(/BDO.*DragonFi/)).toContainText('PHP 1,175.00')
  await form('Sell BDO', 'Record sale', async () => {
    await dialog.getByLabel('Quantity to sell').fill('40')
    await dialog.getByLabel(/Sale price per share/).fill('150')
  })
  // 60 shares left at the sale price of 150, carrying 60% of the cost
  await expect(row(/BDO.*DragonFi/)).toContainText('PHP 7,710.00')
  await expect(row(/BDO.*DragonFi/)).toContainText('PHP 9,000.00')
  await form('Add holding', 'Save holding', async () => {
    await choose('Account', 'GoTrade')
    await dialog.getByLabel('Symbol').fill('AAPL')
    await dialog.getByLabel('Quantity', { exact: true }).fill('0.5')
    await dialog.getByLabel(/Price per share/).fill('200')
    await dialog.getByRole('switch', { name: /Paid from this account/ }).uncheck()
  })
  await expect(row(/AAPL.*GoTrade/)).toContainText('USD 100.00')
  await form('Set exchange rate', 'Save rate', () =>
    dialog.getByLabel('PHP for 1 USD').fill('58.25')
  )
  await expect(row(/1 USD = PHP 58\.25/)).toBeVisible()
  await shot('11-investments')

  // Overview. PHP: GoTyme 148,749.50 + DragonFi cash 50,000 - 12,850 + 6,000 + holdings 9,000
  // = 200,899.50. USD 100.00 at 58.25 = 5,825.00. Total 206,724.50.
  await go('Overview')
  await expect(page.getByText('₱200,899.50').first()).toBeVisible()
  await expect(page.getByText('₱206,724.50').first()).toBeVisible()
  await expect(page.getByText(/\$1 = ₱58\.25 · rate of/)).toBeVisible()
  // The accounts card shows DragonFi's cash 43,150.00 plus holdings 9,000.00
  await expect(page.getByText('₱52,150.00').first()).toBeVisible()
  await shot('12-overview-converted')

  // The sale and purchase reached the ledger as cash movements.
  await go('Transactions')
  await expect(row(/Buy BDO/)).toContainText('-PHP 12,850.00')
  await expect(row(/Sell BDO/)).toContainText('PHP 6,000.00')
  await shot('13-transactions')

  // Settings: week start is saved.
  await go('Settings')
  await page.getByRole('combobox', { name: 'Week starts on' }).click()
  await page.getByRole('option', { name: 'Sunday' }).click()
  await expect(page.getByRole('combobox', { name: 'Week starts on' })).toContainText('Sunday')

  await app.close()
})
