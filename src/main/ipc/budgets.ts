import {
  createCategory,
  createRule,
  deleteCategory,
  deleteRule,
  getBudget,
  listCategories,
  listRules,
  planIncome,
  propose,
  setBudget
} from '../db/budgets'
import { createBill, deleteBill, listBills, payBill } from '../db/bills'
import type { Db } from '../db/connection'
import { createGoal, deleteGoal, listGoals } from '../db/goals'
import { getSettings } from '../db/settings'
import { handle } from './handle'

const today = (): string => new Date().toLocaleDateString('en-CA') // local YYYY-MM-DD

export function registerBudgetIpc(db: Db): void {
  handle('categories:list', () => listCategories(db))
  handle('categories:create', ({ name }) => (createCategory(db, name), null))
  handle('categories:delete', ({ id }) => (deleteCategory(db, id), null))
  handle('budgets:get', ({ period, date }) =>
    getBudget(db, period, date, getSettings(db).weekStart)
  )
  handle('budgets:set', (input) => (setBudget(db, input), null))
  handle('budgets:plan', (plan) => (planIncome(db, plan), null))
  handle('bills:list', ({ date }) => listBills(db, date))
  handle('bills:create', (bill) => (createBill(db, bill), null))
  handle('bills:delete', ({ id }) => (deleteBill(db, id), null))
  handle('bills:pay', (payment) => (payBill(db, payment), null))
  handle('budgets:propose', ({ amountMinor }) => propose(db, amountMinor))
  handle('rules:list', () => listRules(db))
  handle('rules:create', (rule) => (createRule(db, rule), null))
  handle('rules:delete', ({ id }) => (deleteRule(db, id), null))
  handle('goals:list', () => listGoals(db, today(), getSettings(db).budgetPeriod))
  handle('goals:create', (input) => (createGoal(db, input), null))
  handle('goals:delete', ({ id }) => (deleteGoal(db, id), null))
}
