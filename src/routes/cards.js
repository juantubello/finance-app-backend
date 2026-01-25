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

    // Obtener el conversion_amount más alto
    const conversionAmounts = statements
      .map(s => s.CONVERSION_AMOUNT / 100)
      .filter(c => c > 0);
    const conversionAmount = conversionAmounts.length > 0 
      ? Math.max(...conversionAmounts) 
      : null;

    // Obtener todos los items de los statements
    const statementUuids = statements.map(s => s.UUID);
    const placeholders = statementUuids.map(() => '?').join(',');
    
    const itemsStmt = prepare(`
      SELECT 
        UUID, POSITION, AMOUNT_ARS, AMOUNT_USD, HOLDER,
        DESCRIPTION, IS_CUOTA, DATE_STRING, DATETIME
      FROM CARD_STATEMENT_ITEMS
      WHERE UUID IN (${placeholders})
      ORDER BY UUID, POSITION
    `);

    const items = await itemsStmt.all(...statementUuids);
    await itemsStmt.finalize();

    // Separar items por tarjeta y calcular totales
    const visaStatement = statements.find(s => s.CARD_TYPE === 'VISA');
    const mastercardStatement = statements.find(s => s.CARD_TYPE === 'MASTERCARD');

    const visaUuid = visaStatement ? visaStatement.UUID : null;
    const mastercardUuid = mastercardStatement ? mastercardStatement.UUID : null;

    const visaItems = items.filter(i => i.UUID === visaUuid);
    const mastercardItems = items.filter(i => i.UUID === mastercardUuid);

    // Calcular totales
    const calculateTotals = (itemsList) => {
      const cuotas = itemsList.filter(i => i.IS_CUOTA === 1);
      const pagosUnicos = itemsList.filter(i => i.IS_CUOTA === 0);
      
      const totalCuotasCents = cuotas.reduce((sum, i) => sum + i.AMOUNT_ARS, 0);
      const totalPagosUnicosCents = pagosUnicos.reduce((sum, i) => sum + i.AMOUNT_ARS, 0);
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

    const visaTotals = visaItems.length > 0 ? calculateTotals(visaItems) : {
      total_cuotas: 0, total_cuotas_cents: 0,
      total_pagos_unicos: 0, total_pagos_unicos_cents: 0,
      total: 0, total_cents: 0
    };

    const mastercardTotals = mastercardItems.length > 0 ? calculateTotals(mastercardItems) : {
      total_cuotas: 0, total_cuotas_cents: 0,
      total_pagos_unicos: 0, total_pagos_unicos_cents: 0,
      total: 0, total_cents: 0
    };

    // Totales generales (suma de Visa + Mastercard)
    const totalCuotasCents = visaTotals.total_cuotas_cents + mastercardTotals.total_cuotas_cents;
    const totalPagosUnicosCents = visaTotals.total_pagos_unicos_cents + mastercardTotals.total_pagos_unicos_cents;

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

    res.json({
      year: yearInt,
      month: monthInt,
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

export default router;
