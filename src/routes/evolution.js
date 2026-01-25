import express from 'express';
import { prepare } from '../db/index.js';

const router = express.Router();

/**
 * GET /evolution/income-vs-expense
 * Obtiene serie mensual de ingresos vs gastos
 */
router.get('/income-vs-expense', async (req, res) => {
  try {
    const { year, month, monthsBack = 12, currency = 'ARS' } = req.query;

    if (!year || !month) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMS',
          message: 'Se requieren year y month'
        }
      });
    }

    const startYear = parseInt(year, 10);
    const startMonth = parseInt(month, 10);
    const monthsBackInt = parseInt(monthsBack, 10);

    // Calcular rango de fechas
    const series = [];
    for (let i = monthsBackInt - 1; i >= 0; i--) {
      let y = startYear;
      let m = startMonth - i;
      
      while (m <= 0) {
        m += 12;
        y -= 1;
      }
      while (m > 12) {
        m -= 12;
        y += 1;
      }

      // Obtener ingresos del mes
      const incomeStmt = prepare(`
        SELECT COALESCE(SUM(AMOUNT), 0) as total
        FROM TRANSACTIONS
        WHERE YEAR = ? AND MONTH = ? AND TYPE = 'INCOME' AND CURRENCY = ?
      `);
      const incomeResult = await incomeStmt.get(y, m, currency);
      await incomeStmt.finalize();
      const income = incomeResult?.total || 0;

      // Obtener gastos del mes
      const expenseStmt = prepare(`
        SELECT COALESCE(SUM(AMOUNT), 0) as total
        FROM TRANSACTIONS
        WHERE YEAR = ? AND MONTH = ? AND TYPE = 'EXPENSE' AND CURRENCY = ?
      `);
      const expenseResult = await expenseStmt.get(y, m, currency);
      await expenseStmt.finalize();
      const expense = expenseResult?.total || 0;

      series.push({
        year: y,
        month: m,
        income: income / 100,
        income_cents: income,
        expense: expense / 100,
        expense_cents: expense
      });
    }

    res.json({
      currency,
      series
    });
  } catch (err) {
    console.error('Error en GET /evolution/income-vs-expense:', err);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Error interno del servidor',
        details: err.message
      }
    });
  }
});

/**
 * GET /evolution/savings
 * Obtiene serie mensual de ahorros
 */
router.get('/savings', async (req, res) => {
  try {
    const { year, month, monthsBack = 12, currency = 'ARS' } = req.query;

    if (!year || !month) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMS',
          message: 'Se requieren year y month'
        }
      });
    }

    const startYear = parseInt(year, 10);
    const startMonth = parseInt(month, 10);
    const monthsBackInt = parseInt(monthsBack, 10);

    // Calcular rango de fechas
    const series = [];
    for (let i = monthsBackInt - 1; i >= 0; i--) {
      let y = startYear;
      let m = startMonth - i;
      
      while (m <= 0) {
        m += 12;
        y -= 1;
      }
      while (m > 12) {
        m -= 12;
        y += 1;
      }

      // Obtener ahorros del mes
      const savingStmt = prepare(`
        SELECT COALESCE(SUM(AMOUNT), 0) as total
        FROM TRANSACTIONS
        WHERE YEAR = ? AND MONTH = ? AND TYPE = 'SAVING' AND CURRENCY = ?
      `);
      const savingResult = await savingStmt.get(y, m, currency);
      await savingStmt.finalize();
      const saving = savingResult?.total || 0;

      series.push({
        year: y,
        month: m,
        saving: saving / 100,
        saving_cents: saving
      });
    }

    res.json({
      currency,
      series
    });
  } catch (err) {
    console.error('Error en GET /evolution/savings:', err);
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
