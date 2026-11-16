import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'

let page: Page
let dialog: Locator

// Each launch gets a fresh data folder, so the test never touches real data.
const launch = async (dir: string): Promise<ElectronApplication> => {
  const app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`] })
  page = await app.firstWindow()
  dialog = page.getByRole('dialog')
  return app
}
const go = (name: string): Promise<void> =>
  page.getByRole('link', { name }).or(page.getByRole('button', { name })).first().click()
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

// Fails the test on any error banner, such as a missing IPC handler. Astryx keeps an empty
// screen-reader live region with the alert role on every page; it is not an error.
const expectNoError = (): Promise<void> =>
  expect(page.locator('[role=alert]:not([data-astryx-live-region])')).toHaveCount(0)

test('budget page: planned income, weekly budgets and due dates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'buri-e2e-'))
  let app = await launch(dir)

  await go('Accounts')
  await form('Add account', 'Save account', async () => {
    await choose('Institution', 'GoTyme')
    await dialog.getByLabel(/Current balance/).fill('100,000')
  })

  await go('Budgets')
  for (const name of ['Food', 'Savings', 'Investments']) {
    await form('Add category', 'Save category', () => dialog.getByLabel('Category name').fill(name))
  }
  await expect(page.getByText('No budgets set for this period yet.')).toBeVisible()
  await expect(page.getByText('Expected income')).toHaveCount(0)
  await form('Set budget for Food', 'Save budget', async () => {
    await expect(dialog.getByRole('radio', { name: 'Every month' })).toBeChecked()
    await expect(dialog.getByRole('radio', { name: 'Fixed amount' })).toBeChecked()
    await dialog.getByLabel(/Monthly budget/).fill('10,000')
  })
  await expect(row(/Food/)).toContainText('PHP 10,000.00')
  // A percentage budget is nothing until income is planned
  await form('Set budget for Investments', 'Save budget', async () => {
    await dialog.getByRole('radio', { name: 'Percent of income' }).click()
    await dialog.getByLabel('Percent of income', { exact: true }).fill('20')
  })
  await expectNoError()
  await expect(row(/Investments/)).toContainText('20.00% of income')
  await expect(row(/Investments/)).toContainText('PHP 0.00')
  await form('Add rule', 'Save rule', async () => {
    await choose('Category', 'Savings')
    await dialog.getByLabel('Percent', { exact: true }).fill('20')
  })

  // Planned income: an estimate per month, not tied to an account. The rule fills Savings, the
  // current budget fills Food, and Investments takes its 20% by itself.
  await page.getByRole('button', { name: 'Plan income' }).click()
  await expect(dialog.getByRole('heading', { name: "Plan this month's income" })).toBeVisible()
  await expect(dialog.getByLabel('Account')).toHaveCount(0)
  await expect(dialog.getByLabel('Investments (PHP)')).toHaveCount(0)
  await dialog.getByLabel(/Expected income per month/).fill('60,000')
  await dialog.getByRole('button', { name: 'Fill from income rules' }).click()
  await expect(dialog.getByLabel('Savings (PHP)')).toHaveValue('12,000.00')
  await expect(dialog.getByLabel('Food (PHP)')).toHaveValue('10,000.00')
  const pie = dialog.getByRole('img', { name: /^Plan:/ })
  await expect(pie).toHaveAccessibleName(/Investments \(20\.00%\) PHP 12,000\.00/)
  await expect(pie).toHaveAccessibleName(/Not budgeted PHP 26,000\.00/)
  await dialog.getByLabel('Food (PHP)').fill('70,000')
  await expect(dialog.getByText(/PHP 34,000\.00 more than the expected income/)).toBeVisible()
  await dialog.getByLabel('Food (PHP)').fill('15,000')
  await page.screenshot({ path: 'e2e/screenshots/14-plan-income.png' })
  await dialog.getByRole('button', { name: 'Save plan' }).click()
  await expect(dialog).toBeHidden()
  await expectNoError()
  const summary =
    'Expected income PHP 60,000.00 · Budgeted PHP 39,000.00 · Not budgeted PHP 21,000.00'
  await expect(page.getByText(summary)).toBeVisible()
  await expect(row(/Food/)).toContainText('PHP 15,000.00')
  await expect(row(/Savings/)).toContainText('PHP 12,000.00')
  await expect(row(/Investments/)).toContainText('PHP 12,000.00')
  await expect(page.getByRole('img', { name: /^Budgeted: Food PHP 15,000\.00/ })).toBeVisible()
  // No transaction was recorded
  await go('Transactions')
  await expect(page.getByRole('row', { name: /Salary|Income/ })).toHaveCount(0)
  await go('Budgets')

  // The income and the percentage carry into next month; Food's fixed amount was for this month.
  await page.getByRole('button', { name: 'Next period' }).click()
  await expect(page.getByText(/^Expected income PHP 60,000\.00 · /)).toBeVisible()
  await expect(row(/Investments/)).toContainText('PHP 12,000.00')
  await expect(row(/Food/)).not.toContainText('PHP 15,000.00')
  await page.getByRole('button', { name: 'Previous period' }).click()

  // Planning again starts from the saved plan
  await page.getByRole('button', { name: 'Plan income' }).click()
  await expect(dialog.getByLabel(/Expected income/)).toHaveValue('60,000.00')
  await expect(dialog.getByLabel('Food (PHP)')).toHaveValue('15,000.00')
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // A weekly budget repeats every week.
  await form('Add category', 'Save category', () =>
    dialog.getByLabel('Category name').fill('Transport')
  )
  await form('Set budget for Transport', 'Save budget', async () => {
    await dialog.getByRole('radio', { name: 'Every week' }).click()
    await dialog.getByLabel(/Weekly budget/).fill('1,400')
  })
  await expectNoError()
  await expect(row(/Transport/)).toContainText('Weekly')

  // The weekly view shows the week's share of the monthly income, and percentages follow it.
  await page.getByRole('radio', { name: 'Weekly' }).click()
  await expect(
    page.getByText(/^Expected income PHP [\d,]+\.\d\d \(from PHP 60,000\.00 a month\) · /)
  ).toBeVisible()
  await expect(row(/Investments/)).toContainText('20.00% of income')
  await expect(row(/Transport/)).toContainText('PHP 1,400.00')
  await page.getByRole('button', { name: 'Next period' }).click()
  await expect(row(/Transport/)).toContainText('PHP 1,400.00')
  await page.getByRole('button', { name: 'Previous period' }).click()
  await page.screenshot({ path: 'e2e/screenshots/15-budgets-weekly.png' })
  // Planning in the weekly view would switch to a weekly income, and lists weekly categories only
  await page.getByRole('button', { name: 'Plan income' }).click()
  await expect(dialog.getByRole('heading', { name: "Plan this week's income" })).toBeVisible()
  await expect(
    dialog.getByText(
      'Your income is planned at PHP 60,000.00 a month. Saving here plans it per week instead.'
    )
  ).toBeVisible()
  await expect(dialog.getByLabel(/Expected income per week/)).toHaveValue('')
  await expect(dialog.getByLabel('Transport (PHP)')).toBeVisible()
  await expect(dialog.getByLabel('Food (PHP)')).toHaveCount(0)
  await dialog.getByLabel(/Expected income per week/).fill('60,000')
  await dialog.getByRole('button', { name: 'Save plan' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(/^Expected income PHP 60,000\.00 · /)).toBeVisible()

  // Switching back to a monthly income replaces the weekly one.
  await page.getByRole('radio', { name: 'Monthly' }).click()
  await expect(page.getByText(/\(from PHP 60,000\.00 a week\)/)).toBeVisible()
  await page.getByRole('button', { name: 'Plan income' }).click()
  await expect(
    dialog.getByText(
      'Your income is planned at PHP 60,000.00 a week. Saving here plans it per month instead.'
    )
  ).toBeVisible()
  await dialog.getByLabel(/Expected income per month/).fill('60,000')
  await dialog.getByRole('button', { name: 'Save plan' }).click()
  await expect(dialog).toBeHidden()
  await expectNoError()
  await expect(page.getByText(/^Expected income PHP 60,000\.00 · /)).toBeVisible()
  await expect(page.getByText(/a week\)/)).toHaveCount(0)

  // Stepping forward and back can land in the next month; reopening the page returns to today.
  await go('Overview')
  await go('Budgets')

  // Due dates: a monthly bill on the calendar, paid from an account into its category.
  await expect(page.getByText(/^No payments due in/)).toBeVisible()
  await form('Add bill', 'Save bill', async () => {
    await dialog.getByLabel('Bill name').fill('Electricity')
    await dialog.getByLabel(/^Amount/).fill('2,500')
    await choose('Category', 'Food')
  })
  await expect(row(/Electricity/)).toContainText('Every month')
  await expect(row(/Electricity/)).toContainText('PHP 2,500.00')
  await expect(page.getByText('Electricity', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: /^Mark Electricity due .* paid$/ }).click()
  await choose('Paid from', 'GoTyme')
  await dialog.getByRole('button', { name: 'Record payment' }).click()
  await expect(dialog).toBeHidden()
  await expectNoError()
  await expect(row(/Electricity/)).toContainText('Paid')
  await expect(page.getByText('✓ Electricity')).toBeVisible()
  await expect(row(/Food/)).toContainText('PHP 2,500.00')
  await expect(page.getByRole('img', { name: /^Spent: Food PHP 2,500\.00$/ })).toBeVisible()
  await page.screenshot({ path: 'e2e/screenshots/16-due-dates.png', fullPage: true })

  // The payment is an ordinary expense; deleting it makes the bill unpaid again.
  await go('Transactions')
  await expect(row(/Electricity/)).toContainText('Food')
  await expect(row(/Electricity/)).toContainText('-PHP 2,500.00')
  await page.getByRole('button', { name: /Delete Electricity/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await go('Budgets')
  await expect(page.getByRole('button', { name: /^Mark Electricity due .* paid$/ })).toBeVisible()

  // Everything survives a restart, which also starts a fresh main process.
  await app.close()
  app = await launch(dir)
  await go('Budgets')
  // The month's budgeted total now also counts Transport's weekly amounts
  await expect(page.getByText(/^Expected income PHP 60,000\.00 · Budgeted/)).toBeVisible()
  await expect(row(/Transport/)).toContainText('Weekly')
  await expect(row(/Electricity/)).toContainText('PHP 2,500.00')
  await expectNoError()

  await page.getByRole('button', { name: 'Delete bill Electricity' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Delete/ })
    .click()
  await expect(page.getByText(/^No payments due in/)).toBeVisible()
  await app.close()
})
