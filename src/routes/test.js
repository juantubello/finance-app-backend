import express from 'express';
import { recuperarGastos, recuperarGastosTransformados, escribirEnGastos } from '../modules/sheets/googleSheets.js';
import { prepare } from '../db/index.js';

const router = express.Router();

/**
 * GET /test/gastos
 * Recupera todos los gastos de la pestaña "Gastos" (SOLO LECTURA - formato raw)
 * Query params:
 * - inicio: columna de inicio (default: 'A')
 * - fin: columna de fin (default: 'G')
 * 
 * NOTA: Este endpoint NO inserta datos en la base de datos, solo lee de Google Sheets
 */
router.get('/gastos', async (req, res) => {
  try {
    const { inicio = 'A', fin = 'G' } = req.query;

    console.log(`📥 Recuperando gastos (raw) desde ${inicio} hasta ${fin}...`);
    const gastos = await recuperarGastos(inicio, fin);

    res.json({
      success: true,
      total: gastos.length,
      rango: `${inicio}:${fin}`,
      formato: 'raw',
      gastos: gastos
    });
  } catch (error) {
    console.error('❌ Error recuperando gastos:', error);
    res.status(500).json({
      error: {
        code: 'ERROR_RECUPERAR_GASTOS',
        message: 'Error al recuperar gastos',
        details: error.message
      }
    });
  }
});

/**
 * POST /test/escribir
 * Escribe un valor en una celda específica
 * Body:
 * - columna: columna (ej: 'E')
 * - fila: número de fila (ej: 2)
 * - valor: valor a escribir
 */
router.post('/escribir', async (req, res) => {
  try {
    const { columna, fila, valor } = req.body;

    if (!columna || !fila || valor === undefined) {
      return res.status(400).json({
        error: {
          code: 'MISSING_FIELDS',
          message: 'Se requieren: columna, fila y valor'
        }
      });
    }

    console.log(`📝 Escribiendo en celda ${columna}${fila}: ${valor}`);
    await escribirEnGastos(columna, fila, valor);

    res.json({
      success: true,
      message: 'Valor escrito correctamente',
      celda: `${columna}${fila}`,
      valor: valor
    });
  } catch (error) {
    console.error('❌ Error escribiendo:', error);
    res.status(500).json({
      error: {
        code: 'ERROR_ESCRIBIR',
        message: 'Error al escribir en la celda',
        details: error.message
      }
    });
  }
});

/**
 * GET /test/gastos/transformados
 * Recupera todos los gastos transformados al formato de la base de datos (SOLO LECTURA)
 * Query params:
 * - inicio: columna de inicio (default: 'A')
 * - fin: columna de fin (default: 'G')
 * 
 * NOTA: Este endpoint NO inserta datos en la base de datos, solo transforma y devuelve
 */
router.get('/gastos/transformados', async (req, res) => {
  try {
    const { inicio = 'A', fin = 'G' } = req.query;

    console.log(`📥 Recuperando y transformando gastos desde ${inicio} hasta ${fin}...`);
    const gastos = await recuperarGastosTransformados(inicio, fin);

    res.json({
      success: true,
      total: gastos.length,
      rango: `${inicio}:${fin}`,
      formato: 'transformado',
      gastos: gastos
    });
  } catch (error) {
    console.error('❌ Error recuperando gastos transformados:', error);
    res.status(500).json({
      error: {
        code: 'ERROR_RECUPERAR_GASTOS',
        message: 'Error al recuperar y transformar gastos',
        details: error.message
      }
    });
  }
});

/**
 * POST /test/updateDB
 * Recupera datos de Google Sheets, los transforma e inserta en la base de datos
 * Query params:
 * - inicio: columna de inicio (default: 'A')
 * - fin: columna de fin (default: 'G')
 * - clear: si es 'true', elimina todos los datos de TRANSACTIONS antes de insertar (default: false)
 * 
 * Body opcional:
 * - skipDuplicates: si es true, omite transacciones con UUID duplicado (default: true)
 */
router.post('/updateDB', async (req, res) => {
  try {
    const { inicio = 'A', fin = 'G', clear = 'false' } = req.query;
    const { skipDuplicates = true } = req.body || {};
    const shouldClear = clear === 'true';

    console.log(`🔄 Iniciando actualización de base de datos desde ${inicio} hasta ${fin}...`);

    // Si se solicita, eliminar todos los datos
    if (shouldClear) {
      console.log('🗑️  Eliminando todos los datos de TRANSACTIONS...');
      const deleteStmt = prepare('DELETE FROM TRANSACTIONS');
      await deleteStmt.run();
      await deleteStmt.finalize();
      console.log('✅ Datos eliminados');
    }

    // Recuperar y transformar gastos
    console.log(`📥 Recuperando y transformando gastos desde ${inicio} hasta ${fin}...`);
    const gastos = await recuperarGastosTransformados(inicio, fin);

    if (gastos.length === 0) {
      return res.json({
        success: true,
        message: 'No hay gastos para insertar',
        total: 0,
        inserted: 0,
        skipped: 0,
        errors: 0
      });
    }

    // Preparar statement para inserción
    const insertStmt = prepare(`
      INSERT INTO TRANSACTIONS (
        UUID, DATETIME, YEAR, MONTH, TYPE, AMOUNT, CURRENCY, 
        CATEGORY, DESCRIPTION, AFFECTS_LIQUIDITY
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    let skipped = 0;
    let errors = 0;
    const errorDetails = [];

    // Insertar cada gasto
    for (const gasto of gastos) {
      try {
        // Validar que tenga UUID
        if (!gasto.uuid || gasto.uuid.trim() === '') {
          errors++;
          errorDetails.push({
            rowNumber: gasto.rowNumber,
            error: 'UUID faltante'
          });
          continue;
        }

        await insertStmt.run(
          gasto.uuid,
          gasto.datetime,
          gasto.year,
          gasto.month,
          gasto.type,
          gasto.amount,
          gasto.currency,
          gasto.category,
          gasto.description || null,
          gasto.affects_liquidity
        );
        inserted++;
      } catch (err) {
        // Si es error de duplicado y skipDuplicates está activo, omitir
        if (skipDuplicates && (err.code === 'SQLITE_CONSTRAINT' || err.message.includes('UNIQUE'))) {
          skipped++;
          continue;
        }
        // Otro tipo de error
        errors++;
        errorDetails.push({
          rowNumber: gasto.rowNumber,
          uuid: gasto.uuid,
          error: err.message
        });
      }
    }

    await insertStmt.finalize();

    console.log(`✅ Actualización completada: ${inserted} insertados, ${skipped} omitidos, ${errors} errores`);

    res.json({
      success: true,
      message: 'Base de datos actualizada',
      total: gastos.length,
      inserted,
      skipped,
      errors,
      errorDetails: errors > 0 ? errorDetails : undefined
    });
  } catch (error) {
    console.error('❌ Error actualizando base de datos:', error);
    res.status(500).json({
      error: {
        code: 'ERROR_UPDATE_DB',
        message: 'Error al actualizar la base de datos',
        details: error.message
      }
    });
  }
});

/**
 * GET /test
 * Endpoint de información sobre los endpoints de test
 */
router.get('/', (req, res) => {
  res.json({
    message: 'Endpoints de test disponibles',
    endpoints: {
      'GET /test/gastos': {
        description: 'Recupera todos los gastos de la pestaña "Gastos" (SOLO LECTURA - formato raw)',
        queryParams: {
          inicio: 'Columna de inicio (default: A)',
          fin: 'Columna de fin (default: G)'
        },
        example: '/test/gastos?inicio=A&fin=G',
        note: 'Este endpoint NO inserta datos en la base de datos'
      },
      'GET /test/gastos/transformados': {
        description: 'Recupera todos los gastos transformados al formato de la base de datos (SOLO LECTURA)',
        queryParams: {
          inicio: 'Columna de inicio (default: A)',
          fin: 'Columna de fin (default: G)'
        },
        example: '/test/gastos/transformados?inicio=A&fin=G',
        note: 'Este endpoint NO inserta datos en la base de datos'
      },
      'POST /test/updateDB': {
        description: 'Recupera datos de Google Sheets, los transforma e inserta en la base de datos',
        queryParams: {
          inicio: 'Columna de inicio (default: A)',
          fin: 'Columna de fin (default: G)',
          clear: 'Si es "true", elimina todos los datos de TRANSACTIONS antes de insertar (default: false)'
        },
        body: {
          skipDuplicates: 'Si es true, omite transacciones con UUID duplicado (default: true)'
        },
        examples: [
          'POST /test/updateDB?inicio=A&fin=G',
          'POST /test/updateDB?inicio=A&fin=G&clear=true'
        ]
      },
      'POST /test/escribir': {
        description: 'Escribe un valor en una celda específica',
        body: {
          columna: 'Columna (ej: E)',
          fila: 'Número de fila (ej: 2)',
          valor: 'Valor a escribir'
        },
        example: {
          columna: 'E',
          fila: 2,
          valor: 'mi-uuid-123'
        }
      }
    }
  });
});

export default router;
