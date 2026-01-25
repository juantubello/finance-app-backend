import express from 'express';
import { prepare } from '../db/index.js';

const router = express.Router();

/**
 * GET /income
 * Obtiene ingresos con filtros opcionales de año y mes
 * Query params:
 * - year: año (requerido)
 * - month: mes (opcional, 1-12)
 * - currency: moneda (default: 'ARS')
 */
router.get('/', async (req, res) => {
  try {
    const { year, month, currency = 'ARS' } = req.query;

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
      WHERE YEAR = ? AND TYPE = 'INCOME' AND CURRENCY = ?
    `;
    const params = [yearInt, currency];

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
    const income = await stmt.all(...params);
    await stmt.finalize();

    // Convertir AMOUNT de centavos a unidades
    const formatted = income.map(item => ({
      uuid: item.UUID,
      datetime: item.DATETIME,
      year: item.YEAR,
      month: item.MONTH,
      type: item.TYPE,
      amount: item.AMOUNT / 100,
      amount_cents: item.AMOUNT,
      currency: item.CURRENCY,
      category: item.CATEGORY,
      description: item.DESCRIPTION,
      affects_liquidity: item.AFFECTS_LIQUIDITY
    }));

    res.json({
      year: yearInt,
      month: month ? parseInt(month, 10) : null,
      currency,
      total: formatted.length,
      total_amount: formatted.reduce((sum, i) => sum + i.amount, 0),
      total_amount_cents: formatted.reduce((sum, i) => sum + i.amount_cents, 0),
      income: formatted
    });
  } catch (err) {
    console.error('Error en GET /income:', err);
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
