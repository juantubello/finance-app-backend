import express from 'express';
import { prepare } from '../db/index.js';

const router = express.Router();

/**
 * GET /expenses
 * Obtiene gastos con filtros opcionales de año y mes
 * Query params:
 * - year: año (requerido)
 * - month: mes (opcional, 1-12)
 * - currency: moneda (opcional, si no se especifica devuelve todas las monedas)
 */
router.get('/', async (req, res) => {
  try {
    const { year, month, currency } = req.query;

    if (!year) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMS',
          message: 'Se requiere el parámetro year'
        }
      });
    }

    const yearInt = parseInt(year, 10);
    let query = `
      SELECT 
        UUID, DATETIME, YEAR, MONTH, TYPE, AMOUNT, CURRENCY,
        CATEGORY, DESCRIPTION, AFFECTS_LIQUIDITY
      FROM TRANSACTIONS
      WHERE YEAR = ? AND TYPE = 'EXPENSE'
    `;
    const params = [yearInt];
    
    // Si se especifica currency, filtrar por esa moneda
    if (currency) {
      query += ' AND CURRENCY = ?';
      params.push(currency);
    }

    if (month) {
      const monthInt = parseInt(month, 10);
      if (monthInt < 1 || monthInt > 12) {
        return res.status(400).json({
          error: {
            code: 'INVALID_MONTH',
            message: 'El mes debe estar entre 1 y 12'
          }
        });
      }
      query += ' AND MONTH = ?';
      params.push(monthInt);
    }

    query += ' ORDER BY DATETIME DESC';

    const stmt = prepare(query);
    const expenses = await stmt.all(...params);
    await stmt.finalize();

    // Convertir AMOUNT de centavos a unidades
    const formatted = expenses.map(expense => ({
      uuid: expense.UUID,
      datetime: expense.DATETIME,
      year: expense.YEAR,
      month: expense.MONTH,
      type: expense.TYPE,
      amount: expense.AMOUNT / 100,
      amount_cents: expense.AMOUNT,
      currency: expense.CURRENCY,
      category: expense.CATEGORY,
      description: expense.DESCRIPTION,
      affects_liquidity: expense.AFFECTS_LIQUIDITY
    }));

    // Calcular totales por moneda si no se especificó una moneda específica
    const totalsByCurrency = currency ? null : formatted.reduce((acc, e) => {
      if (!acc[e.currency]) {
        acc[e.currency] = { total: 0, total_cents: 0, count: 0 };
      }
      acc[e.currency].total += e.amount;
      acc[e.currency].total_cents += e.amount_cents;
      acc[e.currency].count += 1;
      return acc;
    }, {});

    res.json({
      year: yearInt,
      month: month ? parseInt(month, 10) : null,
      currency: currency || 'ALL',
      total: formatted.length,
      total_amount: formatted.reduce((sum, e) => sum + e.amount, 0),
      total_amount_cents: formatted.reduce((sum, e) => sum + e.amount_cents, 0),
      totals_by_currency: totalsByCurrency,
      expenses: formatted
    });
  } catch (err) {
    console.error('Error en GET /expenses:', err);
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
