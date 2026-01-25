import express from 'express';
import { prepare } from '../db/index.js';
import { parseAmountToCents } from '../lib/amount.js';

const router = express.Router();

/**
 * POST /liquidity/opening-balance
 * Crea un balance inicial de liquidez
 */
router.post('/opening-balance', async (req, res) => {
  try {
    const {
      datetime,
      currency = 'ARS',
      amount,
      description
    } = req.body;

    if (!datetime || amount === undefined) {
      return res.status(400).json({
        error: {
          code: 'MISSING_FIELDS',
          message: 'Se requieren datetime y amount'
        }
      });
    }

    // Validar CURRENCY
    const validCurrencies = ['ARS', 'USD'];
    if (!validCurrencies.includes(currency)) {
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

    // Insertar balance inicial
    const stmt = prepare(`
      INSERT INTO LIQUIDITY_OPENING_BALANCE (
        DATETIME, CURRENCY, AMOUNT, DESCRIPTION
      ) VALUES (?, ?, ?, ?)
    `);

    const result = await stmt.run(
      datetime,
      currency,
      amountCents,
      description || null
    );
    await stmt.finalize();

    res.status(201).json({
      id: result.lastInsertRowid,
      message: 'Balance inicial creado exitosamente'
    });
  } catch (err) {
    console.error('Error en POST /liquidity/opening-balance:', err);
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
 * POST /liquidity/adjust
 * Ajusta la liquidez manualmente (puede ser positivo o negativo para correcciones)
 */
router.post('/adjust', async (req, res) => {
  try {
    const {
      datetime,
      currency = 'ARS',
      amount,
      description
    } = req.body;

    if (!datetime || amount === undefined) {
      return res.status(400).json({
        error: {
          code: 'MISSING_FIELDS',
          message: 'Se requieren datetime y amount'
        }
      });
    }

    // Validar CURRENCY
    const validCurrencies = ['ARS', 'USD'];
    if (!validCurrencies.includes(currency)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_CURRENCY',
          message: `CURRENCY debe ser uno de: ${validCurrencies.join(', ')}`
        }
      });
    }

    // Parsear amount a centavos (puede ser negativo)
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

    // Insertar ajuste (usa la misma tabla que opening balance)
    const stmt = prepare(`
      INSERT INTO LIQUIDITY_OPENING_BALANCE (
        DATETIME, CURRENCY, AMOUNT, DESCRIPTION
      ) VALUES (?, ?, ?, ?)
    `);

    const result = await stmt.run(
      datetime,
      currency,
      amountCents,
      description || 'Ajuste manual de liquidez'
    );
    await stmt.finalize();

    res.status(201).json({
      id: result.lastInsertRowid,
      amount: amountCents / 100,
      amount_cents: amountCents,
      message: 'Ajuste de liquidez creado exitosamente'
    });
  } catch (err) {
    console.error('Error en POST /liquidity/adjust:', err);
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
 * GET /liquidity/history
 * Obtiene el historial de balances y ajustes de liquidez
 */
router.get('/history', async (req, res) => {
  try {
    const { currency = 'ARS' } = req.query;

    const stmt = prepare(`
      SELECT 
        ID, DATETIME, CURRENCY, AMOUNT, DESCRIPTION
      FROM LIQUIDITY_OPENING_BALANCE
      WHERE CURRENCY = ?
      ORDER BY DATETIME DESC
    `);

    const records = await stmt.all(currency);
    await stmt.finalize();

    const formatted = records.map(record => ({
      id: record.ID,
      datetime: record.DATETIME,
      currency: record.CURRENCY,
      amount: record.AMOUNT / 100,
      amount_cents: record.AMOUNT,
      description: record.DESCRIPTION
    }));

    res.json({
      currency,
      records: formatted,
      total: formatted.reduce((sum, r) => sum + r.amount_cents, 0) / 100,
      total_cents: formatted.reduce((sum, r) => sum + r.amount_cents, 0)
    });
  } catch (err) {
    console.error('Error en GET /liquidity/history:', err);
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
 * GET /liquidity/current
 * Obtiene la liquidez actual
 */
router.get('/current', async (req, res) => {
  try {
    const { currency = 'ARS' } = req.query;

    // SUM(LIQUIDITY_OPENING_BALANCE.AMOUNT) - incluye balances iniciales y ajustes
    const openingBalanceStmt = prepare(`
      SELECT COALESCE(SUM(AMOUNT), 0) as total
      FROM LIQUIDITY_OPENING_BALANCE
      WHERE CURRENCY = ?
    `);
    const openingResult = await openingBalanceStmt.get(currency);
    await openingBalanceStmt.finalize();
    const opening_balance = openingResult?.total || 0;

    // Calcular transacciones: INCOME suma, EXPENSE resta
    // SUM(CASE WHEN TYPE='INCOME' THEN AMOUNT ELSE -AMOUNT END WHERE AFFECTS_LIQUIDITY=1)
    const transactionsStmt = prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN TYPE = 'INCOME' THEN AMOUNT ELSE -AMOUNT END), 0) as total
      FROM TRANSACTIONS
      WHERE AFFECTS_LIQUIDITY = 1 AND CURRENCY = ?
    `);
    const transactionsResult = await transactionsStmt.get(currency);
    await transactionsStmt.finalize();
    const liquidity_transactions = transactionsResult?.total || 0;

    const current = opening_balance + liquidity_transactions;

    res.json({
      currency,
      opening_balance: opening_balance / 100,
      opening_balance_cents: opening_balance,
      liquidity_transactions: liquidity_transactions / 100,
      liquidity_transactions_cents: liquidity_transactions,
      current: current / 100,
      current_cents: current
    });
  } catch (err) {
    console.error('Error en GET /liquidity/current:', err);
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
