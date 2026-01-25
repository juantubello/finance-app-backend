import express from 'express';
import { prepare } from '../db/index.js';

const router = express.Router();

/**
 * GET /annual/expenses
 * Obtiene gastos anuales agrupados por categoría y mes
 */
router.get('/expenses', async (req, res) => {
  try {
    const { year, currency = 'ARS' } = req.query;

    if (!year) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMS',
          message: 'Se requiere year'
        }
      });
    }

    const yearInt = parseInt(year, 10);

    // Query para obtener datos en formato pivot (CATEGORY, MONTH, TOTAL)
    const stmt = prepare(`
      SELECT 
        CATEGORY,
        MONTH,
        COALESCE(SUM(AMOUNT), 0) as total_cents
      FROM TRANSACTIONS
      WHERE YEAR = ? AND TYPE = 'EXPENSE' AND CURRENCY = ?
      GROUP BY CATEGORY, MONTH
      ORDER BY CATEGORY, MONTH
    `);

    const results = await stmt.all(yearInt, currency);
    await stmt.finalize();

    // Formatear resultados
    const pivotData = results.map(row => ({
      category: row.CATEGORY,
      month: row.MONTH,
      total: row.total_cents / 100,
      total_cents: row.total_cents
    }));

    // También generar una grilla estructurada
    const categories = [...new Set(results.map(r => r.CATEGORY))];
    const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    const grid = categories.map(category => {
      const categoryData = results.filter(r => r.CATEGORY === category);
      const monthData = {};
      
      categoryData.forEach(row => {
        monthData[row.MONTH] = {
          total: row.total_cents / 100,
          total_cents: row.total_cents
        };
      });

      const row = {
        category,
        months: months.map(month => ({
          month,
          total: monthData[month]?.total || 0,
          total_cents: monthData[month]?.total_cents || 0
        }))
      };

      return row;
    });

    res.json({
      year: yearInt,
      currency,
      format: 'pivot',
      data: pivotData,
      grid: grid
    });
  } catch (err) {
    console.error('Error en GET /annual/expenses:', err);
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
 * GET /annual/income
 * Obtiene ingresos anuales agrupados por categoría y mes
 */
router.get('/income', async (req, res) => {
  try {
    const { year, currency = 'ARS' } = req.query;

    if (!year) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMS',
          message: 'Se requiere year'
        }
      });
    }

    const yearInt = parseInt(year, 10);

    // Query para obtener datos en formato pivot (CATEGORY, MONTH, TOTAL)
    const stmt = prepare(`
      SELECT 
        CATEGORY,
        MONTH,
        COALESCE(SUM(AMOUNT), 0) as total_cents
      FROM TRANSACTIONS
      WHERE YEAR = ? AND TYPE = 'INCOME' AND CURRENCY = ?
      GROUP BY CATEGORY, MONTH
      ORDER BY CATEGORY, MONTH
    `);

    const results = await stmt.all(yearInt, currency);
    await stmt.finalize();

    // Formatear resultados
    const pivotData = results.map(row => ({
      category: row.CATEGORY,
      month: row.MONTH,
      total: row.total_cents / 100,
      total_cents: row.total_cents
    }));

    // También generar una grilla estructurada
    const categories = [...new Set(results.map(r => r.CATEGORY))];
    const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    const grid = categories.map(category => {
      const categoryData = results.filter(r => r.CATEGORY === category);
      const monthData = {};
      
      categoryData.forEach(row => {
        monthData[row.MONTH] = {
          total: row.total_cents / 100,
          total_cents: row.total_cents
        };
      });

      const row = {
        category,
        months: months.map(month => ({
          month,
          total: monthData[month]?.total || 0,
          total_cents: monthData[month]?.total_cents || 0
        }))
      };

      return row;
    });

    res.json({
      year: yearInt,
      currency,
      format: 'pivot',
      data: pivotData,
      grid: grid
    });
  } catch (err) {
    console.error('Error en GET /annual/income:', err);
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
 * GET /annual/savings
 * Obtiene ahorros anuales agrupados por categoría y mes
 * Query params:
 * - year: año (requerido)
 * - currency: moneda ('ARS', 'USD', o 'all' para ambos - default: 'all')
 */
router.get('/savings', async (req, res) => {
  try {
    const { year, currency = 'all' } = req.query;

    if (!year) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMS',
          message: 'Se requiere year'
        }
      });
    }

    const yearInt = parseInt(year, 10);

    // Query para obtener datos en formato pivot (CATEGORY, MONTH, TOTAL)
    // Incluir detección de USD desde categoría/descripción (legacy)
    let query = `
      SELECT 
        CATEGORY,
        MONTH,
        COALESCE(SUM(AMOUNT), 0) as total_cents,
        CURRENCY,
        DESCRIPTION
      FROM TRANSACTIONS
      WHERE YEAR = ? AND TYPE = 'SAVING'
    `;
    const params = [yearInt];

    // Filtrar por currency si no es 'all'
    if (currency !== 'all') {
      if (currency === 'USD') {
        query += ` AND (
          CURRENCY = 'USD' 
          OR (CURRENCY = 'ARS' AND (LOWER(CATEGORY) LIKE '%usd%' OR LOWER(DESCRIPTION) LIKE '%usd%'))
        )`;
      } else {
        query += ` AND CURRENCY = ? AND (LOWER(CATEGORY) NOT LIKE '%usd%' AND LOWER(DESCRIPTION) NOT LIKE '%usd%')`;
        params.push(currency);
      }
    }

    query += ` GROUP BY CATEGORY, MONTH, CURRENCY, DESCRIPTION ORDER BY CATEGORY, MONTH`;

    const stmt = prepare(query);
    const results = await stmt.all(...params);
    await stmt.finalize();

    // Normalizar currency en los resultados
    const normalizedResults = results.map(row => {
      const categoryLower = (row.CATEGORY || '').toLowerCase();
      const descriptionLower = (row.DESCRIPTION || '').toLowerCase();
      const normalizedCurrency = categoryLower.includes('usd') || descriptionLower.includes('usd') 
        ? 'USD' 
        : (row.CURRENCY || 'ARS');
      
      return {
        ...row,
        normalized_currency: normalizedCurrency
      };
    });

    // Separar por currency
    const resultsARS = normalizedResults.filter(r => r.normalized_currency === 'ARS');
    const resultsUSD = normalizedResults.filter(r => r.normalized_currency === 'USD');

    // Formatear resultados
    const pivotData = normalizedResults.map(row => ({
      category: row.CATEGORY,
      month: row.MONTH,
      currency: row.normalized_currency,
      total: row.total_cents / 100,
      total_cents: row.total_cents
    }));

    // También generar una grilla estructurada
    const categories = [...new Set(normalizedResults.map(r => r.CATEGORY))];
    const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    const grid = categories.map(category => {
      const categoryData = normalizedResults.filter(r => r.CATEGORY === category);
      const monthData = {};
      
      categoryData.forEach(row => {
        monthData[row.MONTH] = {
          total: row.total_cents / 100,
          total_cents: row.total_cents,
          currency: row.normalized_currency
        };
      });

      const row = {
        category,
        months: months.map(month => ({
          month,
          total: monthData[month]?.total || 0,
          total_cents: monthData[month]?.total_cents || 0,
          currency: monthData[month]?.currency || 'ARS'
        }))
      };

      return row;
    });

    // Calcular totales
    const totalARS = resultsARS.reduce((sum, r) => sum + r.total_cents, 0);
    const totalUSD = resultsUSD.reduce((sum, r) => sum + r.total_cents, 0);

    res.json({
      year: yearInt,
      currency: currency === 'all' ? 'all' : currency,
      format: 'pivot',
      total_ars: totalARS / 100,
      total_ars_cents: totalARS,
      total_usd: totalUSD / 100,
      total_usd_cents: totalUSD,
      data: pivotData,
      grid: grid
    });
  } catch (err) {
    console.error('Error en GET /annual/savings:', err);
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
