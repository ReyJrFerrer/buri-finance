import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { Api } from '../src/preload'

test('limits transaction text to 200 characters and displays a long memo once without overlap', async () => {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'buri-text-'))}`]
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: 'Your net worth starts here' })).toBeVisible()
    const date = await page.evaluate(async () => {
      const api = (window as unknown as { api: Api }).api
      const date = new Date().toLocaleDateString('en-CA')
      await api.accounts.create({
        name: 'Wallet',
        type: 'asset',
        institution: null,
        currency: 'PHP',
        parentId: null,
        openingBalanceMinor: 0,
        openingDate: date
      })
      return date
    })
    await page
      .getByRole('link', { name: 'Transactions', exact: true })
      .or(page.getByRole('button', { name: 'Transactions', exact: true }))
      .first()
      .click()
    await page.getByRole('button', { name: 'Add transaction' }).click()
    const form = page.getByRole('dialog', { name: 'Add transaction' })
    await form.getByLabel(/^Amount/).fill('2')
    await expect(form).not.toContainText('Up to 200 characters')
    await form.getByLabel('Paid to').fill('p'.repeat(201))
    await expect(form.getByLabel('Paid to')).toHaveValue('p'.repeat(200))
    await form.getByLabel('Paid to').fill('')
    await form.getByLabel('Note').fill('m'.repeat(201))
    await expect(form.getByLabel('Note')).toHaveValue('m'.repeat(200))
    await form.getByRole('button', { name: 'Save transaction' }).click()
    await expect(form).toBeHidden()
    await page.getByRole('button', { name: `View ${'m'.repeat(200)} on ${date}` }).click()
    const details = page.getByRole('dialog', { name: `Transactions on ${date}` })
    await expect(details).toBeVisible()
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 480, height: 700 })
    await expect(details.getByText('m'.repeat(200), { exact: false })).toHaveCount(1)
    const memo = details.getByText(`Memo: ${'m'.repeat(200)}`, { exact: true })
    await expect(memo).toBeVisible()
    const memoBox = await memo.boundingBox()
    const amountBox = await details.getByText('-PHP 2.00', { exact: true }).boundingBox()
    expect(memoBox).not.toBeNull()
    expect(amountBox).not.toBeNull()
    expect(amountBox!.y).toBeGreaterThanOrEqual(memoBox!.y + memoBox!.height)
    expect(await memo.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: '/tmp/buri-long-memo-dark.png', animations: 'disabled' })
  } finally {
    await app.close()
  }
})

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
    await expect(table.getByRole('row')).toHaveCount(11) // header plus 10 transactions
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
    await expect(day.getByRole('button')).toHaveCount(3)
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
    await expect(table.getByRole('row')).toHaveCount(11) // last page clamps from 3 to 2
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
