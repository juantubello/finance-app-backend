/**
 * Módulo Google Sheets API (STUB)
 * TODO: Implementar OAuth y Google Sheets API
 */

/**
 * Obtiene filas de una hoja de Google Sheets
 * @param {Object} options - Opciones de consulta
 * @param {string} options.spreadsheetId - ID de la hoja de cálculo
 * @param {string} options.range - Rango de celdas (ej: "Sheet1!A1:Z100")
 * @returns {Promise<Array>} Array de filas
 */
export async function fetchRows(options) {
  // STUB: Retornar array vacío por ahora
  console.log('Google Sheets fetchRows (STUB):', options);
  return [];
}

/**
 * Otras funciones que se implementarán más adelante
 */
export async function authenticate() {
  // TODO: Implementar autenticación OAuth
  throw new Error('Google Sheets authentication not implemented');
}

export async function syncTransactions() {
  // TODO: Implementar sincronización de transacciones desde Google Sheets
  throw new Error('Transaction sync not implemented');
}
