import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { Api } from '../src/preload'

test('command palette quick-adds transactions, shows help and switches theme', async () => {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'buri-palette-'))}`]
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: 'Your net worth starts here' })).toBeVisible()
    await page.evaluate(async () => {
      const api = (window as unknown as { api: Api }).api
      for (const name of ['Wallet', 'GoTyme']) {
        await api.accounts.create({
          name,
          type: 'asset',
          institution: null,
          currency: 'PHP',
          parentId: null,
          openingBalanceMinor: 0,
          openingDate: new Date().toLocaleDateString('en-CA')
        })
      }
    })
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    const list = (): Promise<unknown> =>
      page.evaluate(() => (window as unknown as { api: Api }).api.transactions.list())

    // Quick add an income to a named account, from the overview.
    await page.keyboard.press('ControlOrMeta+k')
    await palette.getByRole('combobox').fill('+1,500 Salary @goty')
    await expect(palette.getByRole('option').first()).toHaveText(
      /Add income of PHP 1,500.00 · Salary · GoTyme · today/
    )
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(palette).toBeHidden()
    await expect(
      page.getByText('Added income of PHP 1,500.00 to GoTyme', { exact: true })
    ).toBeVisible()
    await expect.poll(list).toMatchObject([{ payee: 'Salary', amountMinor: 150000 }])

    // The page shown reloads after a quick add.
    await page.keyboard.press('ControlOrMeta+3')
    await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+k')
    await palette.getByRole('combobox').fill('120 Coffee')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('row', { name: /Coffee/ })).toBeVisible()

    // Help, from the palette and by shortcut.
    await page.keyboard.press('ControlOrMeta+k')
    await palette.getByRole('combobox').fill('?')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    const help = page.getByRole('dialog', { name: 'Help' })
    await expect(help).toContainText('Quick add')
    await page.keyboard.press('Escape')
    await expect(help).toBeHidden()
    await page.keyboard.press('ControlOrMeta+/')
    await expect(help).toBeVisible()
    await page.keyboard.press('Escape')

    // Theme switch persists to settings.
    await page.keyboard.press('ControlOrMeta+k')
    await palette.getByRole('combobox').fill('dark theme')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { api: Api }).api.settings.get()))
      .toMatchObject({ themeMode: 'dark' })

    // Add transaction dialog by shortcut.
    await page.keyboard.press('ControlOrMeta+n')
    await expect(page.getByRole('dialog', { name: 'Add transaction' })).toBeVisible()
  } finally {
    await app.close()
  }
})
