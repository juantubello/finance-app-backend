import express from 'express';
import { prepare } from '../db/index.js';

const router = express.Router();

/**
 * GET /cards/statements
 * Obtiene gastos de tarjetas para un mes/año específico
 * Query params:
 * - year: año (requerido)
 * - month: mes (requerido, 1-12)
 */
router.get('/statements', async (req, res) => {
  let statementsStmt = null;
  let paymentFxStmt = null;
  let itemsStmt = null;

  try {
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMS',
          message: 'Se requieren los parámetros year y month'
        }
      });
    }

    const yearInt = parseInt(year, 10);
    const monthInt = parseInt(month, 10);

    if (monthInt < 1 || monthInt > 12) {
      return res.status(400).json({
        error: {
          code: 'INVALID_MONTH',
          message: 'El mes debe estar entre 1 y 12'
        }
      });
    }

    // Obtener statements del mes/año
    statementsStmt = prepare(`
      SELECT 
        UUID, YEAR, MONTH, CARD_TYPE, FILENAME,
        AMOUNT_ARS, AMOUNT_USD, CONVERSION_AMOUNT,
        TOTAL_AMOUNT_ARS, AMOUNT_TOTAL_ARS
      FROM CARD_STATEMENTS
      WHERE YEAR = ? AND MONTH = ?
      ORDER BY CARD_TYPE
    `);

    const statements = await statementsStmt.all(yearInt, monthInt);
    await statementsStmt.finalize();
    statementsStmt = null;

    if (statements.length === 0) {
      return res.json({
        year: yearInt,
        month: monthInt,
        total_cuotas: 0,
        total_cuotas_cents: 0,
        total_pagos_unicos: 0,
        total_pagos_unicos_cents: 0,
        conversion_amount: null,
        total_visa: 0,
        total_visa_cents: 0,
        total_mastercard: 0,
        total_mastercard_cents: 0,
        total_cuotas_visa: 0,
        total_cuotas_visa_cents: 0,
        total_cuotas_mastercard: 0,
        total_cuotas_mastercard_cents: 0,
        total_pagos_unicos_visa: 0,
        total_pagos_unicos_visa_cents: 0,
        total_pagos_unicos_mastercard: 0,
        total_pagos_unicos_mastercard_cents: 0,
        consumos: {
          visa: [],
          mastercard: []
        }
      });
    }

    // Buscar si existe un tipo de cambio guardado para este mes/año
    paymentFxStmt = prepare(`
      SELECT CONVERSION_AMOUNT
      FROM CARD_PAYMENT_FX
      WHERE YEAR = ? AND MONTH = ?
    `);
    const paymentFx = await paymentFxStmt.get(yearInt, monthInt);
    await paymentFxStmt.finalize();
    paymentFxStmt = null;

    // Si existe tipo de cambio guardado, usarlo; si no, usar el calculado del PDF
    let conversionAmount = null;
    if (paymentFx) {
      conversionAmount = paymentFx.CONVERSION_AMOUNT / 100;
    } else {
      // Obtener el conversion_amount más alto de los statements (calculado del PDF)
      const conversionAmounts = statements
        .map(s => s.CONVERSION_AMOUNT / 100)
        .filter(c => c > 0);
      conversionAmount = conversionAmounts.length > 0 
        ? Math.max(...conversionAmounts) 
        : null;
    }

    // Obtener todos los items de los statements
    const statementUuids = statements.map(s => s.UUID);
    const placeholders = statementUuids.map(() => '?').join(',');
    
    itemsStmt = prepare(`
      SELECT 
        UUID, POSITION, AMOUNT_ARS, AMOUNT_USD, HOLDER,
        DESCRIPTION, IS_CUOTA, DATE_STRING, DATETIME
      FROM CARD_STATEMENT_ITEMS
      WHERE UUID IN (${placeholders})
      ORDER BY UUID, POSITION
    `);

    const items = await itemsStmt.all(...statementUuids);
    await itemsStmt.finalize();
    itemsStmt = null;

    // Separar items por tarjeta y calcular totales
    const visaStatement = statements.find(s => s.CARD_TYPE === 'VISA');
    const mastercardStatement = statements.find(s => s.CARD_TYPE === 'MASTERCARD');

    const visaUuid = visaStatement ? visaStatement.UUID : null;
    const mastercardUuid = mastercardStatement ? mastercardStatement.UUID : null;

    const visaItems = items.filter(i => i.UUID === visaUuid);
    const mastercardItems = items.filter(i => i.UUID === mastercardUuid);

    // Calcular totales
    const calculateTotals = (itemsList, conversionAmountValue) => {
      const cuotas = itemsList.filter(i => i.IS_CUOTA === 1);
      const pagosUnicos = itemsList.filter(i => i.IS_CUOTA === 0);
      
      // Función para obtener el monto en pesos de un item
      // Si el item tiene AMOUNT_USD > 0, AMOUNT_ARS ya está actualizado con el tipo de cambio correcto
      // Si no tiene USD, AMOUNT_ARS es el valor directo
      const getAmountArsCents = (item) => {
        // AMOUNT_ARS ya incluye los USD convertidos si el item tiene USD
        // No necesitamos convertir de nuevo porque ya está actualizado en la BD
        return item.AMOUNT_ARS || 0;
      };
      
      const totalCuotasCents = cuotas.reduce((sum, i) => sum + getAmountArsCents(i), 0);
      const totalPagosUnicosCents = pagosUnicos.reduce((sum, i) => sum + getAmountArsCents(i), 0);
      const totalCents = totalCuotasCents + totalPagosUnicosCents;

      return {
        total_cuotas: totalCuotasCents / 100,
        total_cuotas_cents: totalCuotasCents,
        total_pagos_unicos: totalPagosUnicosCents / 100,
        total_pagos_unicos_cents: totalPagosUnicosCents,
        total: totalCents / 100,
        total_cents: totalCents
      };
    };

    // Usar el conversion_amount del paymentFx si existe, si no usar el del statement
    // Como el paymentFx aplica para ambas tarjetas, usamos el mismo valor
    const visaConversionAmount = conversionAmount;
    const mastercardConversionAmount = conversionAmount;

    // Calcular cuotas y pagos únicos desde items (para desglose)
    const visaTotalsItems = visaItems.length > 0 ? calculateTotals(visaItems, visaConversionAmount) : {
      total_cuotas: 0, total_cuotas_cents: 0,
      total_pagos_unicos: 0, total_pagos_unicos_cents: 0,
      total: 0, total_cents: 0
    };

    const mastercardTotalsItems = mastercardItems.length > 0 ? calculateTotals(mastercardItems, mastercardConversionAmount) : {
      total_cuotas: 0, total_cuotas_cents: 0,
      total_pagos_unicos: 0, total_pagos_unicos_cents: 0,
      total: 0, total_cents: 0
    };

    // Función para calcular el total de un statement
    // Si hay registro en CARD_PAYMENT_FX, calcular desde TOTAL_AMOUNT_ARS + (USD * tipo_cambio)
    // Si no hay registro, usar AMOUNT_TOTAL_ARS del statement
    const calculateStatementTotal = (statement, items) => {
      if (!statement) return 0;
      
      if (paymentFx && conversionAmount) {
        // Calcular desde items: TOTAL_AMOUNT_ARS (ARS + impuestos) + (USD * tipo_cambio_paymentFx)
        // TOTAL_AMOUNT_ARS viene del PDF y ya incluye consumos ARS + impuestos sobre ARS
        
        // Items en USD - convertir con el tipo de cambio de paymentFx
        const itemsUsd = items.filter(i => i.AMOUNT_USD > 0);
        const totalUsdCents = itemsUsd.reduce((sum, i) => sum + i.AMOUNT_USD, 0);
        const totalUsdEnPesosCents = Math.round((totalUsdCents / 100) * conversionAmount * 100);
        
        // Total = TOTAL_AMOUNT_ARS (ARS + impuestos) + USD convertidos
        const totalCents = statement.TOTAL_AMOUNT_ARS + totalUsdEnPesosCents;
        
        return totalCents;
      } else {
        // Usar AMOUNT_TOTAL_ARS del statement (lógica original)
        return statement.AMOUNT_TOTAL_ARS;
      }
    };

    const visaTotalCents = calculateStatementTotal(visaStatement, visaItems);
    const mastercardTotalCents = calculateStatementTotal(mastercardStatement, mastercardItems);

    const visaTotals = {
      total_cuotas: visaTotalsItems.total_cuotas,
      total_cuotas_cents: visaTotalsItems.total_cuotas_cents,
      total_pagos_unicos: visaTotalsItems.total_pagos_unicos,
      total_pagos_unicos_cents: visaTotalsItems.total_pagos_unicos_cents,
      total: visaTotalCents / 100,
      total_cents: visaTotalCents
    };

    const mastercardTotals = {
      total_cuotas: mastercardTotalsItems.total_cuotas,
      total_cuotas_cents: mastercardTotalsItems.total_cuotas_cents,
      total_pagos_unicos: mastercardTotalsItems.total_pagos_unicos,
      total_pagos_unicos_cents: mastercardTotalsItems.total_pagos_unicos_cents,
      total: mastercardTotalCents / 100,
      total_cents: mastercardTotalCents
    };

    // Totales generales (suma de Visa + Mastercard)
    const totalCuotasCents = visaTotalsItems.total_cuotas_cents + mastercardTotalsItems.total_cuotas_cents;
    const totalPagosUnicosCents = visaTotalsItems.total_pagos_unicos_cents + mastercardTotalsItems.total_pagos_unicos_cents;

    // Formatear consumos
    const formatConsumos = (itemsList) => {
      return itemsList.map(item => ({
        importe: item.AMOUNT_ARS / 100,
        importe_cents: item.AMOUNT_ARS,
        holder: item.HOLDER,
        descripcion: item.DESCRIPTION,
        fecha: item.DATE_STRING,
        is_cuota: item.IS_CUOTA === 1
      }));
    };

    // Total general (suma de ambos statements usando AMOUNT_TOTAL_ARS)
    const totalGeneralCents = visaTotals.total_cents + mastercardTotals.total_cents;

    res.json({
      year: yearInt,
      month: monthInt,
      total: totalGeneralCents / 100,
      total_cents: totalGeneralCents,
      total_cuotas: totalCuotasCents / 100,
      total_cuotas_cents: totalCuotasCents,
      total_pagos_unicos: totalPagosUnicosCents / 100,
      total_pagos_unicos_cents: totalPagosUnicosCents,
      conversion_amount: conversionAmount,
      total_visa: visaTotals.total,
      total_visa_cents: visaTotals.total_cents,
      total_mastercard: mastercardTotals.total,
      total_mastercard_cents: mastercardTotals.total_cents,
      total_cuotas_visa: visaTotals.total_cuotas,
      total_cuotas_visa_cents: visaTotals.total_cuotas_cents,
      total_cuotas_mastercard: mastercardTotals.total_cuotas,
      total_cuotas_mastercard_cents: mastercardTotals.total_cuotas_cents,
      total_pagos_unicos_visa: visaTotals.total_pagos_unicos,
      total_pagos_unicos_visa_cents: visaTotals.total_pagos_unicos_cents,
      total_pagos_unicos_mastercard: mastercardTotals.total_pagos_unicos,
      total_pagos_unicos_mastercard_cents: mastercardTotals.total_pagos_unicos_cents,
      consumos: {
        visa: formatConsumos(visaItems),
        mastercard: formatConsumos(mastercardItems)
      }
    });
  } catch (err) {
    // Asegurar que todos los statements se finalicen incluso si hay error
    const statements = [statementsStmt, paymentFxStmt, itemsStmt];
    for (const stmt of statements) {
      if (stmt) {
        try {
          await stmt.finalize();
        } catch (finalizeErr) {
          console.error('Error finalizando statement:', finalizeErr);
        }
      }
    }
    console.error('Error en GET /cards/statements:', err);
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
 * GET /cards/statements/annual
 * Obtiene totales anuales de tarjetas en pesos (ARS) para gráfico
 * Query params:
 * - year: año (requerido)
 */
router.get('/statements/annual', async (req, res) => {
  try {
    const { year } = req.query;

    if (!year) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMS',
          message: 'Se requiere el parámetro year'
        }
      });
    }

    const yearInt = parseInt(year, 10);

    // Obtener statements del año
    const statementsStmt = prepare(`
      SELECT 
        UUID, YEAR, MONTH, CARD_TYPE,
        AMOUNT_TOTAL_ARS
      FROM CARD_STATEMENTS
      WHERE YEAR = ?
      ORDER BY MONTH, CARD_TYPE
    `);

    const statements = await statementsStmt.all(yearInt);
    await statementsStmt.finalize();

    if (statements.length === 0) {
      return res.json({
        year: yearInt,
        total: 0,
        total_cents: 0,
        total_visa: 0,
        total_visa_cents: 0,
        total_mastercard: 0,
        total_mastercard_cents: 0,
        months: []
      });
    }

    // Agrupar por mes y calcular totales
    const meses = {};
    let totalVisaCents = 0;
    let totalMastercardCents = 0;

    for (const statement of statements) {
      const month = statement.MONTH;
      const amountTotalArsCents = statement.AMOUNT_TOTAL_ARS;
      
      // Inicializar mes si no existe
      if (!meses[month]) {
        meses[month] = {
          month,
          total: 0,
          total_cents: 0,
          total_visa: 0,
          total_visa_cents: 0,
          total_mastercard: 0,
          total_mastercard_cents: 0
        };
      }
      
      // Sumar al mes correspondiente
      meses[month].total_cents += amountTotalArsCents;
      meses[month].total = meses[month].total_cents / 100;
      
      if (statement.CARD_TYPE === 'VISA') {
        meses[month].total_visa_cents += amountTotalArsCents;
        meses[month].total_visa = meses[month].total_visa_cents / 100;
        totalVisaCents += amountTotalArsCents;
      } else if (statement.CARD_TYPE === 'MASTERCARD') {
        meses[month].total_mastercard_cents += amountTotalArsCents;
        meses[month].total_mastercard = meses[month].total_mastercard_cents / 100;
        totalMastercardCents += amountTotalArsCents;
      }
    }

    // Convertir a array y ordenar por mes
    const mesesArray = Object.values(meses).sort((a, b) => a.month - b.month);

    const totalCents = totalVisaCents + totalMastercardCents;

    res.json({
      year: yearInt,
      total: totalCents / 100,
      total_cents: totalCents,
      total_visa: totalVisaCents / 100,
      total_visa_cents: totalVisaCents,
      total_mastercard: totalMastercardCents / 100,
      total_mastercard_cents: totalMastercardCents,
      months: mesesArray
    });
  } catch (err) {
    console.error('Error en GET /cards/statements/annual:', err);
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
 * Función para categorizar un gasto según su descripción
 */
function categorizarGasto(descripcion) {
  if (!descripcion) return null;
  
  const descUpper = descripcion.toUpperCase();
  
  // Verificar XBOX primero (antes de MICROSOFT) para el caso especial MICROSOFT*XBOX
  if (descUpper.includes('XBOX')) {
    return 'Subscripciones';
  }
  
  // MERPAGO* → Mercadolibre
  if (descUpper.includes('MERPAGO')) {
    return 'Mercadolibre';
  }
  
  // RAPPI o PEDIDOSYA → Delivery
  if (descUpper.includes('RAPPI') || descUpper.includes('PEDIDOSYA')) {
    return 'Delivery';
  }
  
  // OSDE → OSDE
  if (descUpper.includes('OSDE')) {
    return 'OSDE';
  }
  
  // FEDERACION → Seguro
  if (descUpper.includes('FEDERACION')) {
    return 'Seguro';
  }
  
  // ABL → ABL
  if (descUpper.includes('ABL')) {
    return 'ABL';
  }
  
  // PERSONAL → Personal (internet/linea, Tuenti)
  if (descUpper.includes('INTERNET') || descUpper.includes('LINEA') || descUpper.includes('TUENTI') || descUpper.includes('PERSONAL')) {
    return 'Personal';
  }
  
  // Plataformas → Subscripciones
  const plataformas = ['NETFLIX', 'HBO', 'SPOTIFY', 'GOOGLE', 'DISCORD', 'STEAM', 'PRIMEVIDEO', 'MICROSOFT'];
  if (plataformas.some(plataforma => descUpper.includes(plataforma))) {
    return 'Subscripciones';
  }
  
  // CABIFY, UBER → Transporte
  if (descUpper.includes('CABIFY') || descUpper.includes('UBER')) {
    return 'Transporte';
  }
  
  return null; // No coincide con ninguna categoría
}

/**
 * GET /cards/statements/categories
 * Obtiene gastos agrupados por categorías específicas para un mes/año
 * Query params:
 * - year: año (requerido)
 * - month: mes (requerido, 1-12)
 */
router.get('/statements/categories', async (req, res) => {
  try {
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMS',
          message: 'Se requieren los parámetros year y month'
        }
      });
    }

    const yearInt = parseInt(year, 10);
    const monthInt = parseInt(month, 10);

    if (monthInt < 1 || monthInt > 12) {
      return res.status(400).json({
        error: {
          code: 'INVALID_MONTH',
          message: 'El mes debe estar entre 1 y 12'
        }
      });
    }

    // Obtener statements del mes/año
    const statementsStmt = prepare(`
      SELECT UUID
      FROM CARD_STATEMENTS
      WHERE YEAR = ? AND MONTH = ?
    `);

    const statements = await statementsStmt.all(yearInt, monthInt);
    await statementsStmt.finalize();

    if (statements.length === 0) {
      return res.json({
        year: yearInt,
        month: monthInt,
        categories: []
      });
    }

    // Obtener todos los items de los statements
    const statementUuids = statements.map(s => s.UUID);
    const placeholders = statementUuids.map(() => '?').join(',');
    
    const itemsStmt = prepare(`
      SELECT 
        AMOUNT_ARS, DESCRIPTION
      FROM CARD_STATEMENT_ITEMS
      WHERE UUID IN (${placeholders})
    `);

    const items = await itemsStmt.all(...statementUuids);
    await itemsStmt.finalize();

    // Agrupar por categoría
    const categorias = {};

    for (const item of items) {
      const categoria = categorizarGasto(item.DESCRIPTION);
      
      if (categoria) {
        if (!categorias[categoria]) {
          categorias[categoria] = {
            categoria,
            total: 0,
            total_cents: 0
          };
        }
        
        categorias[categoria].total_cents += item.AMOUNT_ARS;
        categorias[categoria].total = categorias[categoria].total_cents / 100;
      }
    }

    // Convertir a array y ordenar por total descendente
    const categoriasArray = Object.values(categorias).sort((a, b) => b.total_cents - a.total_cents);

    res.json({
      year: yearInt,
      month: monthInt,
      categories: categoriasArray
    });
  } catch (err) {
    console.error('Error en GET /cards/statements/categories:', err);
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
 * GET /cards/payment-fx
 * Obtiene el tipo de cambio guardado para un mes/año específico
 * Query params:
 * - year: año (requerido)
 * - month: mes (requerido)
 * 
 * Devuelve el tipo de cambio si existe, o null si no hay registro
 */
router.get('/payment-fx', async (req, res) => {
  try {
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMS',
          message: 'Se requieren los parámetros year y month'
        }
      });
    }

    const yearInt = parseInt(year, 10);
    const monthInt = parseInt(month, 10);

    if (monthInt < 1 || monthInt > 12) {
      return res.status(400).json({
        error: {
          code: 'INVALID_MONTH',
          message: 'El mes debe estar entre 1 y 12'
        }
      });
    }

    // Buscar si existe un tipo de cambio guardado para este mes/año
    const paymentFxStmt = prepare(`
      SELECT CONVERSION_AMOUNT, DATETIME
      FROM CARD_PAYMENT_FX
      WHERE YEAR = ? AND MONTH = ?
    `);
    const paymentFx = await paymentFxStmt.get(yearInt, monthInt);
    await paymentFxStmt.finalize();

    if (!paymentFx) {
      return res.json({
        success: true,
        year: yearInt,
        month: monthInt,
        conversion_amount: null,
        conversion_amount_cents: null,
        datetime: null,
        exists: false
      });
    }

    return res.json({
      success: true,
      year: yearInt,
      month: monthInt,
      conversion_amount: paymentFx.CONVERSION_AMOUNT / 100,
      conversion_amount_cents: paymentFx.CONVERSION_AMOUNT,
      datetime: paymentFx.DATETIME,
      exists: true
    });
  } catch (err) {
    console.error('Error en GET /cards/payment-fx:', err);
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
 * POST /cards/payment-fx
 * Guarda o actualiza el tipo de cambio usado por el banco al pagar el resumen
 * Body params:
 * - year: año (requerido)
 * - month: mes (requerido, 1-12)
 * - amount: tipo de cambio en pesos (requerido, ej: 1470)
 * 
 * Este endpoint actualiza:
 * 1. Guarda el tipo de cambio en CARD_PAYMENT_FX
 * 2. Actualiza todos los items en USD de ambos statements (VISA y MASTERCARD) del mes
 * 3. Recalcula los totales de ambos statements
 */
router.post('/payment-fx', async (req, res) => {
  try {
    const { year, month, amount } = req.body;

    if (!year || !month || amount === undefined) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMS',
          message: 'Se requieren los parámetros year, month y amount'
        }
      });
    }

    const yearInt = parseInt(year, 10);
    const monthInt = parseInt(month, 10);
    const conversionAmount = parseFloat(amount);

    if (monthInt < 1 || monthInt > 12) {
      return res.status(400).json({
        error: {
          code: 'INVALID_MONTH',
          message: 'El mes debe estar entre 1 y 12'
        }
      });
    }

    if (isNaN(conversionAmount) || conversionAmount <= 0) {
      return res.status(400).json({
        error: {
          code: 'INVALID_AMOUNT',
          message: 'El amount debe ser un número positivo'
        }
      });
    }

    const conversionAmountCents = Math.round(conversionAmount * 100);
    const now = new Date().toISOString();

    // 1. Guardar o actualizar el tipo de cambio
    const upsertFxStmt = prepare(`
      INSERT INTO CARD_PAYMENT_FX (YEAR, MONTH, CONVERSION_AMOUNT, DATETIME)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(YEAR, MONTH) DO UPDATE SET
        CONVERSION_AMOUNT = excluded.CONVERSION_AMOUNT,
        DATETIME = excluded.DATETIME
    `);

    await upsertFxStmt.run(yearInt, monthInt, conversionAmountCents, now);
    await upsertFxStmt.finalize();

    // 2. Obtener todos los statements del mes/año
    const statementsStmt = prepare(`
      SELECT UUID, CARD_TYPE, AMOUNT_ARS, AMOUNT_USD, CONVERSION_AMOUNT, TOTAL_AMOUNT_ARS, AMOUNT_TOTAL_ARS
      FROM CARD_STATEMENTS
      WHERE YEAR = ? AND MONTH = ?
    `);

    const statements = await statementsStmt.all(yearInt, monthInt);
    await statementsStmt.finalize();

    if (statements.length === 0) {
      return res.json({
        success: true,
        message: 'Tipo de cambio guardado, pero no se encontraron statements para actualizar',
        year: yearInt,
        month: monthInt,
        conversion_amount: conversionAmount,
        conversion_amount_cents: conversionAmountCents,
        statements_updated: 0
      });
    }

    // 3. Para cada statement, actualizar items en USD y recalcular totales
    const updateItemStmt = prepare(`
      UPDATE CARD_STATEMENT_ITEMS
      SET AMOUNT_ARS = ?
      WHERE UUID = ? AND AMOUNT_USD > 0 AND ID = ?
    `);

    const updateStatementStmt = prepare(`
      UPDATE CARD_STATEMENTS
      SET CONVERSION_AMOUNT = ?,
          AMOUNT_TOTAL_ARS = ?
      WHERE UUID = ?
    `);

    let itemsUpdated = 0;
    let statementsUpdated = 0;

    for (const statement of statements) {
      // Obtener todos los items del statement
      const itemsStmt = prepare(`
        SELECT ID, AMOUNT_ARS, AMOUNT_USD
        FROM CARD_STATEMENT_ITEMS
        WHERE UUID = ? AND AMOUNT_USD > 0
      `);

      const items = await itemsStmt.all(statement.UUID);
      await itemsStmt.finalize();

      // Actualizar cada item en USD
      for (const item of items) {
        const usdAmount = item.AMOUNT_USD / 100; // Convertir centavos a dólares
        const newAmountArsCents = Math.round(usdAmount * conversionAmount * 100);
        
        await updateItemStmt.run(newAmountArsCents, statement.UUID, item.ID);
        itemsUpdated++;
      }

      // Recalcular totales del statement
      // Obtener todos los items (ARS y USD actualizados)
      const allItemsStmt = prepare(`
        SELECT AMOUNT_ARS, AMOUNT_USD
        FROM CARD_STATEMENT_ITEMS
        WHERE UUID = ?
      `);

      const allItems = await allItemsStmt.all(statement.UUID);
      await allItemsStmt.finalize();

      // Calcular nuevos totales desde los items actualizados
      const totalAmountArsCents = allItems.reduce((sum, i) => sum + i.AMOUNT_ARS, 0);
      const totalAmountUsdCents = allItems.reduce((sum, i) => sum + i.AMOUNT_USD, 0);

      // Recalcular AMOUNT_TOTAL_ARS
      // TOTAL_AMOUNT_ARS viene del PDF (SALDO ACTUAL $) e incluye:
      // - Consumos en ARS + impuestos sobre ARS
      // - NO incluye USD convertidos
      //
      // AMOUNT_TOTAL_ARS = TOTAL_AMOUNT_ARS + (USD convertidos)
      //
      // Los items en USD ya están actualizados con el nuevo tipo de cambio en AMOUNT_ARS
      const totalAmountArs = statement.TOTAL_AMOUNT_ARS / 100;
      
      // Obtener USD convertidos con el nuevo tipo (ya están en AMOUNT_ARS de los items USD)
      const itemsUsdStmt = prepare(`
        SELECT AMOUNT_ARS
        FROM CARD_STATEMENT_ITEMS
        WHERE UUID = ? AND AMOUNT_USD > 0
      `);
      const itemsUsd = await itemsUsdStmt.all(statement.UUID);
      await itemsUsdStmt.finalize();
      
      const usdConvertidosCents = itemsUsd.reduce((sum, i) => sum + i.AMOUNT_ARS, 0);
      const usdEnPesos = usdConvertidosCents / 100;
      
      // AMOUNT_TOTAL_ARS = TOTAL_AMOUNT_ARS + USD convertidos con nuevo tipo
      const amountTotalArs = totalAmountArs + usdEnPesos;
      const amountTotalArsCents = Math.round(amountTotalArs * 100);

      // Actualizar statement
      await updateStatementStmt.run(
        conversionAmountCents,
        amountTotalArsCents,
        statement.UUID
      );

      statementsUpdated++;
    }

    await updateItemStmt.finalize();
    await updateStatementStmt.finalize();

    // Obtener información de debug de los statements actualizados
    const debugStmt = prepare(`
      SELECT 
        CARD_TYPE,
        AMOUNT_ARS,
        AMOUNT_USD,
        CONVERSION_AMOUNT,
        TOTAL_AMOUNT_ARS,
        AMOUNT_TOTAL_ARS
      FROM CARD_STATEMENTS
      WHERE YEAR = ? AND MONTH = ?
    `);
    const debugStatements = await debugStmt.all(yearInt, monthInt);
    await debugStmt.finalize();

    res.json({
      success: true,
      message: 'Tipo de cambio guardado y statements actualizados',
      year: yearInt,
      month: monthInt,
      conversion_amount: conversionAmount,
      conversion_amount_cents: conversionAmountCents,
      statements_updated: statementsUpdated,
      items_updated: itemsUpdated,
      debug: {
        statements: debugStatements.map(s => ({
          card_type: s.CARD_TYPE,
          amount_ars: s.AMOUNT_ARS / 100,
          amount_usd: s.AMOUNT_USD / 100,
          conversion_amount: s.CONVERSION_AMOUNT / 100,
          total_amount_ars: s.TOTAL_AMOUNT_ARS / 100,
          amount_total_ars: s.AMOUNT_TOTAL_ARS / 100
        }))
      }
    });
  } catch (err) {
    console.error('Error en POST /cards/payment-fx:', err);
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
