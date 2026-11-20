import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { Api } from '../src/preload'

test('pages history, navigates calendar months and updates markers after deletion', async () => {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'buri-calendar-'))}`]
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: 'Your net worth starts here' })).toBeVisible()
    const dates = await page.evaluate(async () => {
      const api = (window as unknown as { api: Api }).api
      const now = new Date()
      const current = new Date(now.getFullYear(), now.getMonth(), 15).toLocaleDateString('en-CA')
      const previous = new Date(now.getFullYear(), now.getMonth() - 1, 15).toLocaleDateString(
        'en-CA'
      )
      const account = await api.accounts.create({
        name: 'Wallet',
        type: 'asset',
        institution: null,
        currency: 'PHP',
        parentId: null,
        openingBalanceMinor: 0,
        openingDate: current
      })
      for (let i = 0; i < 21; i++) {
        await api.transactions.create({
          kind: 'expense',
          accountId: account.id,
          amountMinor: 100,
          categoryId: null,
          date: i === 0 ? previous : current,
          payee: i === 20 ? `Entry 20 ${'Long description '.repeat(10)}` : `Entry ${i}`,
          memo: i === 20 ? 'Full memo shown only in transaction details' : ''
        })
      }
      return { current, previous }
    })
    await page
      .getByRole('link', { name: 'Transactions', exact: true })
      .or(page.getByRole('button', { name: 'Transactions', exact: true }))
      .first()
      .click()
    const table = page.getByRole('table')
    await expect(table.getByRole('row')).toHaveCount(21) // header plus 20 transactions
    await expect(table).not.toContainText('Entry 0')
    await expect(
      page.getByRole('group', { name: `${dates.current}: 20 transactions`, exact: true })
    ).toBeVisible()
    const day = page.getByRole('group', { name: `${dates.current}: 20 transactions`, exact: true })
    await expect(day).toHaveAttribute('data-variant', 'blue')
    const preview = day.getByRole('button', { name: /^View Entry 20 / })
    const previewText = preview.locator('[data-color="negative"]')
    await expect(previewText).toHaveCount(1)
    expect(await previewText.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    await expect(day.getByRole('button')).toHaveCount(4) // three previews plus View all
    await preview.focus()
    await page.keyboard.press('Enter')
    const details = page.getByRole('dialog', { name: `Transactions on ${dates.current}` })
    await expect(details).toBeVisible()
    await expect(details).toContainText(`Entry 20 ${'Long description '.repeat(10).trim()}`)
    await expect(details).toContainText('Full memo shown only in transaction details')
    await expect(details).toContainText('Account: Wallet')
    await expect(details).toContainText('Category: Uncategorized')
    await expect(details).toContainText('-PHP 1.00')
    await expect(details).toContainText('Entry 1') // includes entries hidden from the preview
    await page.screenshot({ path: '/tmp/buri-transaction-details.png', animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(details).toBeHidden()
    await expect(preview).toBeFocused()
    const pagination = page.getByRole('navigation', { name: 'Transaction pages' })
    await pagination.getByRole('button', { name: /next/i }).click()
    await expect(table.getByRole('row')).toHaveCount(2)
    await expect(table).toContainText('Entry 0')
    // Calendar counts cover all pages, not just the visible row.
    await expect(
      page.getByRole('group', { name: `${dates.current}: 20 transactions`, exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Previous month', exact: true }).click()
    await expect(
      page.getByRole('group', { name: `${dates.previous}: 1 transaction`, exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: /Delete Entry 0 on/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(table.getByRole('row')).toHaveCount(21)
    await expect(pagination).toHaveCount(0)
    await expect(
      page.getByRole('group', { name: `${dates.previous}: 0 transactions`, exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Next month', exact: true }).click()
    await expect(
      page.getByRole('group', { name: `${dates.current}: 20 transactions`, exact: true })
    ).toBeVisible()
    await page.screenshot({
      path: '/tmp/buri-transaction-calendar.png',
      fullPage: true,
      animations: 'disabled'
    })
  } finally {
    await app.close()
  }
})
