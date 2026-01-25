import express from 'express';
import { prepare } from '../db/index.js';

const router = express.Router();

/**
 * GET /dashboard/summary
 * Resumen mensual del dashboard
 */
router.get('/summary', async (req, res) => {
  try {
    const { year, month, currency = 'ARS' } = req.query;

    if (!year || !month) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMS',
          message: 'Se requieren year y month'
        }
      });
    }

    const yearInt = parseInt(year, 10);
    const monthInt = parseInt(month, 10);

    // Obtener totales por tipo
    const incomeStmt = prepare(`
      SELECT COALESCE(SUM(AMOUNT), 0) as total
      FROM TRANSACTIONS
      WHERE YEAR = ? AND MONTH = ? AND TYPE = 'INCOME' AND CURRENCY = ?
    `);
    const incomeResult = await incomeStmt.get(yearInt, monthInt, currency);
    await incomeStmt.finalize();
    const income_total = incomeResult?.total || 0;

    const expenseStmt = prepare(`
      SELECT COALESCE(SUM(AMOUNT), 0) as total
      FROM TRANSACTIONS
      WHERE YEAR = ? AND MONTH = ? AND TYPE = 'EXPENSE' AND CURRENCY = ?
    `);
    const expenseResult = await expenseStmt.get(yearInt, monthInt, currency);
    await expenseStmt.finalize();
    const expense_total = expenseResult?.total || 0;

    const savingStmt = prepare(`
      SELECT COALESCE(SUM(AMOUNT), 0) as total
      FROM TRANSACTIONS
      WHERE YEAR = ? AND MONTH = ? AND TYPE = 'SAVING' AND CURRENCY = ?
    `);
    const savingResult = await savingStmt.get(yearInt, monthInt, currency);
    await savingStmt.finalize();
    const saving_total = savingResult?.total || 0;

    // Calcular liquidez actual
    // SUM(LIQUIDITY_OPENING_BALANCE) + SUM(TRANSACTIONS WHERE AFFECTS_LIQUIDITY=1)
    const openingBalanceStmt = prepare(`
      SELECT COALESCE(SUM(AMOUNT), 0) as total
      FROM LIQUIDITY_OPENING_BALANCE
      WHERE CURRENCY = ?
    `);
    const openingResult = await openingBalanceStmt.get(currency);
    await openingBalanceStmt.finalize();
    const opening_balance = openingResult?.total || 0;

    // Calcular transacciones: INCOME suma, EXPENSE resta
    const liquidityTransactionsStmt = prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN TYPE = 'INCOME' THEN AMOUNT ELSE -AMOUNT END), 0) as total
      FROM TRANSACTIONS
      WHERE AFFECTS_LIQUIDITY = 1 AND CURRENCY = ?
    `);
    const liquidityResult = await liquidityTransactionsStmt.get(currency);
    await liquidityTransactionsStmt.finalize();
    const liquidity_transactions = liquidityResult?.total || 0;

    const liquidity_current = opening_balance + liquidity_transactions;

    // Breakdown por categoría para gastos
    const categoryBreakdownStmt = prepare(`
      SELECT 
        CATEGORY,
        COALESCE(SUM(AMOUNT), 0) as total_cents
      FROM TRANSACTIONS
      WHERE YEAR = ? AND MONTH = ? AND TYPE = 'EXPENSE' AND CURRENCY = ?
      GROUP BY CATEGORY
      ORDER BY total_cents DESC
    `);
    const categoryBreakdown = await categoryBreakdownStmt.all(yearInt, monthInt, currency);
    await categoryBreakdownStmt.finalize();

    const breakdown = categoryBreakdown.map(cat => ({
      category: cat.CATEGORY,
      total: cat.total_cents / 100,
      total_cents: cat.total_cents
    }));

    res.json({
      year: yearInt,
      month: monthInt,
      currency,
      income_total: income_total / 100,
      income_total_cents: income_total,
      expense_total: expense_total / 100,
      expense_total_cents: expense_total,
      saving_total: saving_total / 100,
      saving_total_cents: saving_total,
      liquidity_current: liquidity_current / 100,
      liquidity_current_cents: liquidity_current,
      category_breakdown: breakdown
    });
  } catch (err) {
    console.error('Error en GET /dashboard/summary:', err);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Error interno del servidor',
        details: err.message
      }
    });
  }
});

export default router;
