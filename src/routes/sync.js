import express from 'express';
import { recuperarGastos, escribirEnGastos } from '../modules/sheets/googleSheets.js';
import { prepare } from '../db/index.js';
import { randomUUID } from 'crypto';
import { transformGastoToDB } from '../modules/sheets/transformGasto.js';

const router = express.Router();

/**
 * POST /sync/syncDB
 * Sincroniza los datos entre Google Sheets y la base de datos
 * Query params:
 * - inicio: columna de inicio (default: 'A')
 * - fin: columna de fin (default: 'G')
 * 
 * Lógica:
 * 1. Trae datos de la sheet
 * 2. Separa los que tienen UUID completo de los que no
 * 3. Para los que tienen UUID:
 *    - Si existe en Sheet pero no en BD → insertar
 *    - Si existe en BD pero no en Sheet → eliminar
 *    - Si existe en ambos → OK (no hacer nada)
 * 4. Para los que NO tienen UUID:
 *    - Generar UUID
 *    - Escribir UUID en Excel (columna G)
 *    - Insertar en BD
 */
router.post('/syncDB', async (req, res) => {
  try {
    const { inicio = 'A', fin = 'G' } = req.query;

    console.log(`🔄 Iniciando sincronización de base de datos desde ${inicio} hasta ${fin}...`);

    // 1. Traer datos de la sheet
    console.log('📥 Recuperando datos de Google Sheets...');
    const gastosRaw = await recuperarGastos(inicio, fin);
    console.log(`✅ Recuperados ${gastosRaw.length} registros de la sheet`);

    // 2. Separar los que tienen UUID de los que no
    const gastosConUUID = [];
    const gastosSinUUID = [];

    for (const gasto of gastosRaw) {
      const uuid = (gasto.data['uuid'] || '').trim();
      if (uuid && uuid.length > 0) {
        gastosConUUID.push(gasto);
      } else {
        gastosSinUUID.push(gasto);
      }
    }

    console.log(`📊 Separación: ${gastosConUUID.length} con UUID, ${gastosSinUUID.length} sin UUID`);

    // 3. Obtener todos los UUIDs de la base de datos
    const dbUUIDsStmt = prepare('SELECT UUID FROM TRANSACTIONS');
    const dbUUIDsRows = await dbUUIDsStmt.all();
    await dbUUIDsStmt.finalize();
    const dbUUIDs = new Set(dbUUIDsRows.map(row => row.UUID).filter(uuid => uuid && uuid.trim() !== ''));

    console.log(`📊 UUIDs en BD: ${dbUUIDs.size}`);

    // 4. Procesar los que tienen UUID
    const sheetUUIDs = new Set(gastosConUUID.map(g => (g.data['uuid'] || '').trim()).filter(u => u));
    
    // UUIDs que están en Sheet pero no en BD (insertar)
    const uuidsParaInsertar = [...sheetUUIDs].filter(uuid => !dbUUIDs.has(uuid));
    
    // UUIDs que están en BD pero no en Sheet (eliminar)
    const uuidsParaEliminar = [...dbUUIDs].filter(uuid => !sheetUUIDs.has(uuid));

    console.log(`📊 UUIDs para insertar: ${uuidsParaInsertar.length}, UUIDs para eliminar: ${uuidsParaEliminar.length}`);

    // Preparar statements
    const insertStmt = prepare(`
      INSERT INTO TRANSACTIONS (
        UUID, DATETIME, YEAR, MONTH, TYPE, AMOUNT, CURRENCY, 
        CATEGORY, DESCRIPTION, AFFECTS_LIQUIDITY
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const deleteStmt = prepare('DELETE FROM TRANSACTIONS WHERE UUID = ?');

    let inserted = 0;
    let deleted = 0;
    let errors = 0;
    const errorDetails = [];

    // Insertar los que están en Sheet pero no en BD
    for (const uuid of uuidsParaInsertar) {
      const gasto = gastosConUUID.find(g => (g.data['uuid'] || '').trim() === uuid);
      if (!gasto) continue;

      try {
        const gastoTransformado = transformGastoToDB(gasto);
        
        await insertStmt.run(
          gastoTransformado.uuid,
          gastoTransformado.datetime,
          gastoTransformado.year,
          gastoTransformado.month,
          gastoTransformado.type,
          gastoTransformado.amount,
          gastoTransformado.currency,
          gastoTransformado.category,
          gastoTransformado.description || null,
          gastoTransformado.affects_liquidity
        );
        inserted++;
        console.log(`✅ Insertado: ${uuid} (fila ${gasto.rowNumber})`);
      } catch (err) {
        errors++;
        errorDetails.push({
          rowNumber: gasto.rowNumber,
          uuid,
          action: 'insert',
          error: err.message
        });
        console.error(`❌ Error insertando ${uuid}:`, err.message);
      }
    }

    // Eliminar los que están en BD pero no en Sheet
    for (const uuid of uuidsParaEliminar) {
      try {
        await deleteStmt.run(uuid);
        deleted++;
        console.log(`🗑️  Eliminado: ${uuid}`);
      } catch (err) {
        errors++;
        errorDetails.push({
          uuid,
          action: 'delete',
          error: err.message
        });
        console.error(`❌ Error eliminando ${uuid}:`, err.message);
      }
    }

    // 5. Procesar los que NO tienen UUID
    let generated = 0;
    for (const gasto of gastosSinUUID) {
      try {
        // Generar UUID
        const nuevoUUID = randomUUID();
        
        // Escribir UUID en Excel (columna G, que es la columna UUID)
        await escribirEnGastos('G', gasto.rowNumber, nuevoUUID);
        
        // Transformar y insertar en BD
        const gastoTransformado = transformGastoToDB(gasto);
        gastoTransformado.uuid = nuevoUUID; // Asignar el nuevo UUID
        
        await insertStmt.run(
          gastoTransformado.uuid,
          gastoTransformado.datetime,
          gastoTransformado.year,
          gastoTransformado.month,
          gastoTransformado.type,
          gastoTransformado.amount,
          gastoTransformado.currency,
          gastoTransformado.category,
          gastoTransformado.description || null,
          gastoTransformado.affects_liquidity
        );
        
        generated++;
        inserted++;
        console.log(`✨ Generado UUID y insertado: ${nuevoUUID} (fila ${gasto.rowNumber})`);
      } catch (err) {
        errors++;
        errorDetails.push({
          rowNumber: gasto.rowNumber,
          action: 'generate_and_insert',
          error: err.message
        });
        console.error(`❌ Error procesando fila ${gasto.rowNumber}:`, err.message);
      }
    }

    await insertStmt.finalize();
    await deleteStmt.finalize();

    console.log(`✅ Sincronización completada: ${inserted} insertados, ${deleted} eliminados, ${generated} UUIDs generados, ${errors} errores`);

    res.json({
      success: true,
      message: 'Sincronización completada',
      summary: {
        total_sheet: gastosRaw.length,
        with_uuid: gastosConUUID.length,
        without_uuid: gastosSinUUID.length,
        inserted,
        deleted,
        generated,
        errors
      },
      details: {
        uuids_para_insertar: uuidsParaInsertar.length,
        uuids_para_eliminar: uuidsParaEliminar.length,
        uuids_ok: gastosConUUID.length - uuidsParaInsertar.length
      },
      errorDetails: errors > 0 ? errorDetails : undefined
    });
  } catch (error) {
    console.error('❌ Error sincronizando base de datos:', error);
    res.status(500).json({
      error: {
        code: 'ERROR_SYNC_DB',
        message: 'Error al sincronizar la base de datos',
        details: error.message
      }
    });
  }
});

export default router;
