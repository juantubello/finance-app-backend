import express from 'express';
import { prepare } from '../db/index.js';

const router = express.Router();

/**
 * GET /savings
 * Obtiene ahorros con filtros opcionales de año y mes
 * Query params:
 * - year: año (requerido)
 * - month: mes (opcional, 1-12)
 * - currency: moneda ('ARS', 'USD', o 'all' para ambos - default: 'all')
 */
router.get('/', async (req, res) => {
  try {
    let { year, month, currency } = req.query;
    
    // Si currency no es válido o no se especifica, usar 'all'
    if (!currency || !['ARS', 'USD', 'all'].includes(currency)) {
      currency = 'all';
    }

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
      WHERE YEAR = ? AND TYPE = 'SAVING'
    `;
    const params = [yearInt];

    // Si currency no es 'all', filtrar por currency
    // También incluir registros que tengan "USD" en categoría o descripción pero CURRENCY='ARS' (legacy)
    if (currency !== 'all') {
      if (currency === 'USD') {
        // Para USD: incluir CURRENCY='USD' O (CURRENCY='ARS' y categoría/descripción contiene USD)
        query += ` AND (
          CURRENCY = 'USD' 
          OR (CURRENCY = 'ARS' AND (LOWER(CATEGORY) LIKE '%usd%' OR LOWER(DESCRIPTION) LIKE '%usd%'))
        )`;
      } else {
        // Para ARS: solo CURRENCY='ARS' y que NO tenga USD en categoría/descripción
        query += ` AND CURRENCY = ? AND (LOWER(CATEGORY) NOT LIKE '%usd%' AND LOWER(DESCRIPTION) NOT LIKE '%usd%')`;
        params.push(currency);
      }
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
    const savings = await stmt.all(...params);
    await stmt.finalize();

    // Normalizar currency: si tiene USD en categoría/descripción pero CURRENCY='ARS', cambiar a USD
    // También si CURRENCY='USD', mantenerlo como USD
    const normalizedSavings = savings.map(saving => {
      const categoryLower = (saving.CATEGORY || '').toLowerCase();
      const descriptionLower = (saving.DESCRIPTION || '').toLowerCase();
      const hasUSDInText = categoryLower.includes('usd') || descriptionLower.includes('usd');
      
      // Determinar currency normalizado
      let normalizedCurrency;
      if (saving.CURRENCY === 'USD') {
        normalizedCurrency = 'USD';
      } else if (hasUSDInText) {
        normalizedCurrency = 'USD'; // Normalizar a USD si tiene "USD" en categoría/descripción
      } else {
        normalizedCurrency = saving.CURRENCY || 'ARS';
      }
      
      return {
        uuid: saving.UUID,
        datetime: saving.DATETIME,
        year: saving.YEAR,
        month: saving.MONTH,
        type: saving.TYPE,
        amount: saving.AMOUNT / 100,
        amount_cents: saving.AMOUNT,
        currency: normalizedCurrency,
        category: saving.CATEGORY,
        description: saving.DESCRIPTION,
        affects_liquidity: saving.AFFECTS_LIQUIDITY
      };
    });

    // Separar por currency para el resumen
    const savingsARS = normalizedSavings.filter(s => s.currency === 'ARS');
    const savingsUSD = normalizedSavings.filter(s => s.currency === 'USD');

    res.json({
      year: yearInt,
      month: month ? parseInt(month, 10) : null,
      currency: currency === 'all' ? 'all' : currency,
      total: normalizedSavings.length,
      total_amount: normalizedSavings.reduce((sum, s) => sum + s.amount, 0),
      total_amount_cents: normalizedSavings.reduce((sum, s) => sum + s.amount_cents, 0),
      total_ars: savingsARS.reduce((sum, s) => sum + s.amount, 0),
      total_ars_cents: savingsARS.reduce((sum, s) => sum + s.amount_cents, 0),
      total_usd: savingsUSD.reduce((sum, s) => sum + s.amount, 0),
      total_usd_cents: savingsUSD.reduce((sum, s) => sum + s.amount_cents, 0),
      savings: normalizedSavings
    });
  } catch (err) {
    console.error('Error en GET /savings:', err);
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
