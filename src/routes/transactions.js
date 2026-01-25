import express from 'express';
import { prepare } from '../db/index.js';
import { parseAmountToCents } from '../lib/amount.js';

const router = express.Router();

/**
 * POST /transactions
 * Inserta una transacción
 */
router.post('/', async (req, res) => {
  try {
    const {
      uuid,
      datetime,
      year,
      month,
      type,
      amount,
      currency = 'ARS',
      category,
      description,
      affects_liquidity
    } = req.body;

    // Validaciones
    if (!uuid || !datetime || !type || amount === undefined || !category) {
      return res.status(400).json({
        error: {
          code: 'MISSING_FIELDS',
          message: 'Faltan campos requeridos: uuid, datetime, type, amount, category'
        }
      });
    }

    // Validar TYPE
    const validTypes = ['INCOME', 'EXPENSE', 'SAVING'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_TYPE',
          message: `TYPE debe ser uno de: ${validTypes.join(', ')}`
        }
      });
    }

    // Detectar currency automáticamente si no se especifica explícitamente
    // Si viene explícitamente, usarlo; si no, detectar desde categoría/descripción
    let finalCurrency = currency;
    if (!finalCurrency || finalCurrency === 'ARS') {
      // Si no se especifica o es el default, intentar detectar desde categoría/descripción
      const categoryLower = (category || '').toLowerCase();
      const descriptionLower = (description || '').toLowerCase();
      if (categoryLower.includes('usd') || descriptionLower.includes('usd')) {
        finalCurrency = 'USD';
      } else {
        finalCurrency = 'ARS'; // Default
      }
    }

    // Validar CURRENCY
    const validCurrencies = ['ARS', 'USD'];
    if (!validCurrencies.includes(finalCurrency)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_CURRENCY',
          message: `CURRENCY debe ser uno de: ${validCurrencies.join(', ')}`
        }
      });
    }

    // Parsear amount a centavos
    let amountCents;
    try {
      amountCents = parseAmountToCents(amount);
    } catch (err) {
      return res.status(400).json({
        error: {
          code: 'INVALID_AMOUNT',
          message: `Error parseando amount: ${err.message}`
        }
      });
    }

    // Calcular YEAR y MONTH desde DATETIME si no vienen
    let finalYear = year;
    let finalMonth = month;
    if (!finalYear || !finalMonth) {
      const date = new Date(datetime);
      if (isNaN(date.getTime())) {
        return res.status(400).json({
          error: {
            code: 'INVALID_DATETIME',
            message: 'datetime inválido o year/month faltantes'
          }
        });
      }
      finalYear = date.getFullYear();
      finalMonth = date.getMonth() + 1;
    }

    // Calcular AFFECTS_LIQUIDITY según TYPE si no viene
    let finalAffectsLiquidity = affects_liquidity;
    if (finalAffectsLiquidity === undefined || finalAffectsLiquidity === null) {
      finalAffectsLiquidity = (type === 'INCOME' || type === 'EXPENSE') ? 1 : 0;
    }

    // Insertar transacción
    const stmt = prepare(`
      INSERT INTO TRANSACTIONS (
        UUID, DATETIME, YEAR, MONTH, TYPE, AMOUNT, CURRENCY, 
        CATEGORY, DESCRIPTION, AFFECTS_LIQUIDITY
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      const result =       await stmt.run(
        uuid,
        datetime,
        finalYear,
        finalMonth,
        type,
        amountCents,
        finalCurrency,
        category,
        description || null,
        finalAffectsLiquidity
      );

      await stmt.finalize();

      res.status(201).json({
        id: result.lastInsertRowid,
        uuid,
        message: 'Transacción creada exitosamente'
      });
    } catch (err) {
      await stmt.finalize();
      if (err.code === 'SQLITE_CONSTRAINT' || err.message.includes('UNIQUE')) {
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_UUID',
            message: 'Ya existe una transacción con este UUID'
          }
        });
      }
      throw err;
    }
  } catch (err) {
    console.error('Error en POST /transactions:', err);
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
 * GET /transactions
 * Obtiene transacciones con filtros opcionales
 */
router.get('/', async (req, res) => {
  try {
    const { year, month, type, currency, uuid } = req.query;

    let query = 'SELECT * FROM TRANSACTIONS WHERE 1=1';
    const params = [];

    if (uuid) {
      query += ' AND UUID = ?';
      params.push(uuid);
    }

    if (year) {
      query += ' AND YEAR = ?';
      params.push(parseInt(year, 10));
    }

    if (month) {
      query += ' AND MONTH = ?';
      params.push(parseInt(month, 10));
    }

    if (type) {
      query += ' AND TYPE = ?';
      params.push(type);
    }

    if (currency) {
      query += ' AND CURRENCY = ?';
      params.push(currency);
    }

    query += ' ORDER BY DATETIME DESC';

    const stmt = prepare(query);
    const transactions = await stmt.all(...params);
    await stmt.finalize();

    // Convertir AMOUNT de centavos a unidades para la respuesta
    const formatted = transactions.map(t => ({
      ...t,
      amount: t.AMOUNT / 100,
      amount_cents: t.AMOUNT
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Error en GET /transactions:', err);
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
 * GET /transactions/:uuid
 * Obtiene una transacción por UUID
 */
router.get('/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;

    const stmt = prepare('SELECT * FROM TRANSACTIONS WHERE UUID = ?');
    const transaction = await stmt.get(uuid);
    await stmt.finalize();

    if (!transaction) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Transacción no encontrada'
        }
      });
    }

    res.json({
      ...transaction,
      amount: transaction.AMOUNT / 100,
      amount_cents: transaction.AMOUNT
    });
  } catch (err) {
    console.error('Error en GET /transactions/:uuid:', err);
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
