import express from 'express';
import { prepare } from '../db/index.js';
import { parseAmountToCents } from '../lib/amount.js';

const router = express.Router();

/**
 * POST /patrimonio
 * Crea o actualiza un registro de patrimonio
 * Body:
 * - type: 'BITCOIN' | 'CEDEAR' | 'PATRIMONIO_USD' | 'USD_FISICO'
 * - quantity: número (para BITCOIN y CEDEAR)
 * - value_usd: número en USD (para PATRIMONIO_USD, en centavos de USD)
 * - description: string (para PATRIMONIO_USD, ej: "Auto")
 * - datetime: string ISO (opcional, usa fecha actual si no se proporciona)
 */
router.post('/', async (req, res) => {
  try {
    const {
      type,
      quantity,
      value_usd,
      description,
      datetime
    } = req.body;

    // Validar type
    const validTypes = ['BITCOIN', 'CEDEAR', 'PATRIMONIO_USD', 'USD_FISICO'];
    if (!type || !validTypes.includes(type)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_TYPE',
          message: `type debe ser uno de: ${validTypes.join(', ')}`
        }
      });
    }

    // Validar campos según tipo
    if (type === 'BITCOIN' || type === 'CEDEAR') {
      if (quantity === undefined || quantity === null) {
        return res.status(400).json({
          error: {
            code: 'MISSING_FIELD',
            message: `quantity es requerido para tipo ${type}`
          }
        });
      }
      const quantityNum = parseFloat(quantity);
      if (isNaN(quantityNum) || quantityNum < 0) {
        return res.status(400).json({
          error: {
            code: 'INVALID_QUANTITY',
            message: 'quantity debe ser un número positivo'
          }
        });
      }
    }

    if (type === 'PATRIMONIO_USD') {
      if (value_usd === undefined || value_usd === null) {
        return res.status(400).json({
          error: {
            code: 'MISSING_FIELD',
            message: 'value_usd es requerido para tipo PATRIMONIO_USD'
          }
        });
      }
      if (!description || !description.trim()) {
        return res.status(400).json({
          error: {
            code: 'MISSING_FIELD',
            message: 'description es requerido para tipo PATRIMONIO_USD'
          }
        });
      }
    }

    // USD_FISICO requiere value_usd como valor base inicial
    if (type === 'USD_FISICO') {
      if (value_usd === undefined || value_usd === null) {
        return res.status(400).json({
          error: {
            code: 'MISSING_FIELD',
            message: 'value_usd es requerido para tipo USD_FISICO (valor base inicial)'
          }
        });
      }
    }

    // Parsear value_usd a centavos si viene
    let valueUsdCents = null;
    if (value_usd !== undefined && value_usd !== null) {
      try {
        valueUsdCents = parseAmountToCents(value_usd);
      } catch (err) {
        return res.status(400).json({
          error: {
            code: 'INVALID_VALUE_USD',
            message: `Error parseando value_usd: ${err.message}`
          }
        });
      }
    }

    // Usar datetime proporcionado o fecha actual
    const finalDatetime = datetime || new Date().toISOString();

    // Desactivar registros anteriores del mismo tipo (excepto si es PATRIMONIO_USD con diferente descripción)
    if (type === 'BITCOIN' || type === 'CEDEAR' || type === 'USD_FISICO') {
      const deactivateStmt = prepare(`
        UPDATE PATRIMONIO
        SET ACTIVE = 0
        WHERE TYPE = ? AND ACTIVE = 1
      `);
      await deactivateStmt.run(type);
      await deactivateStmt.finalize();
    } else if (type === 'PATRIMONIO_USD') {
      // Para PATRIMONIO_USD, solo desactivar si tiene la misma descripción
      const deactivateStmt = prepare(`
        UPDATE PATRIMONIO
        SET ACTIVE = 0
        WHERE TYPE = ? AND DESCRIPTION = ? AND ACTIVE = 1
      `);
      await deactivateStmt.run(type, description.trim());
      await deactivateStmt.finalize();
    }

    // Insertar nuevo registro
    const stmt = prepare(`
      INSERT INTO PATRIMONIO (
        TYPE, QUANTITY, VALUE_USD, DESCRIPTION, DATETIME, ACTIVE
      ) VALUES (?, ?, ?, ?, ?, 1)
    `);

    const result = await stmt.run(
      type,
      type === 'BITCOIN' || type === 'CEDEAR' ? parseFloat(quantity) : null,
      type === 'PATRIMONIO_USD' || type === 'USD_FISICO' ? valueUsdCents : null,
      type === 'PATRIMONIO_USD' ? description.trim() : null,
      finalDatetime
    );
    await stmt.finalize();

    res.status(201).json({
      id: result.lastInsertRowid,
      type,
      quantity: type === 'BITCOIN' || type === 'CEDEAR' ? parseFloat(quantity) : null,
      value_usd: type === 'PATRIMONIO_USD' || type === 'USD_FISICO' ? valueUsdCents / 100 : null,
      value_usd_cents: type === 'PATRIMONIO_USD' || type === 'USD_FISICO' ? valueUsdCents : null,
      description: type === 'PATRIMONIO_USD' ? description.trim() : null,
      datetime: finalDatetime,
      message: 'Registro de patrimonio creado exitosamente'
    });
  } catch (err) {
    console.error('Error en POST /patrimonio:', err);
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
 * GET /patrimonio
 * Obtiene todos los registros de patrimonio activos, discriminados por tipo
 * Calcula automáticamente USD_FISICO desde las transacciones SAVING en USD
 */
router.get('/', async (req, res) => {
  try {
    // Obtener registros activos de la tabla
    const stmt = prepare(`
      SELECT 
        ID, TYPE, QUANTITY, VALUE_USD, DESCRIPTION, DATETIME
      FROM PATRIMONIO
      WHERE ACTIVE = 1
      ORDER BY TYPE, DESCRIPTION
    `);

    const records = await stmt.all();
    await stmt.finalize();

    // Obtener valor base de USD_FISICO de la tabla (si existe)
    let usdFisicoBaseCents = 0;
    for (const record of records) {
      if (record.TYPE === 'USD_FISICO') {
        usdFisicoBaseCents = record.VALUE_USD || 0;
        break;
      }
    }

    // Calcular ahorros en USD desde transacciones SAVING en USD
    // Incluir tanto CURRENCY='USD' como CURRENCY='ARS' con USD en categoría/descripción (legacy)
    const usdFisicoStmt = prepare(`
      SELECT COALESCE(SUM(AMOUNT), 0) as total_cents
      FROM TRANSACTIONS
      WHERE TYPE = 'SAVING' AND (
        CURRENCY = 'USD' 
        OR (CURRENCY = 'ARS' AND (LOWER(CATEGORY) LIKE '%usd%' OR LOWER(DESCRIPTION) LIKE '%usd%'))
      )
    `);
    const usdFisicoResult = await usdFisicoStmt.get();
    await usdFisicoStmt.finalize();
    const usdFisicoAhorrosCents = usdFisicoResult?.total_cents || 0;

    // Total USD_FISICO = base + ahorros
    const usdFisicoTotalCents = usdFisicoBaseCents + usdFisicoAhorrosCents;

    // Agrupar por tipo
    const patrimonio = {
      bitcoin: null,
      cedear: null,
      patrimonio_usd: [],
      usd_fisico: {
        base: usdFisicoBaseCents / 100,
        base_cents: usdFisicoBaseCents,
        ahorros: usdFisicoAhorrosCents / 100,
        ahorros_cents: usdFisicoAhorrosCents,
        total: usdFisicoTotalCents / 100,
        total_cents: usdFisicoTotalCents
      }
    };

    for (const record of records) {
      if (record.TYPE === 'BITCOIN') {
        patrimonio.bitcoin = {
          quantity: record.QUANTITY,
          datetime: record.DATETIME
        };
      } else if (record.TYPE === 'CEDEAR') {
        patrimonio.cedear = {
          quantity: record.QUANTITY,
          datetime: record.DATETIME
        };
      } else if (record.TYPE === 'PATRIMONIO_USD') {
        patrimonio.patrimonio_usd.push({
          description: record.DESCRIPTION,
          value_usd: record.VALUE_USD / 100,
          value_usd_cents: record.VALUE_USD,
          datetime: record.DATETIME
        });
      }
    }

    res.json(patrimonio);
  } catch (err) {
    console.error('Error en GET /patrimonio:', err);
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
