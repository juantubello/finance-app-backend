import { parseAmountToCents } from '../../lib/amount.js';

/**
 * Transforma un gasto de Google Sheets al formato esperado por la base de datos
 * @param {Object} gasto - Gasto desde Google Sheets
 * @param {number} gasto.rowNumber - Número de fila
 * @param {Object} gasto.data - Datos del gasto
 * @returns {Object} Gasto transformado para la base de datos
 */
export function transformGastoToDB(gasto) {
  const { rowNumber, data } = gasto;

  // Usar el campo DATE (fecha real) para calcular año y mes, no DATETIME (marca temporal del form)
  // DATE viene en formato "24/1/2026" (sin hora)
  const fechaDate = data['date'] || data['Fecha'] || '';
  const fechaDatetime = data['datetime'] || data['Marca temporal'] || '';
  
  // Para DATETIME usar la marca temporal completa
  const datetimeISO = fechaDatetime ? parseFechaToISO(fechaDatetime) : '';
  
  // Para YEAR y MONTH usar el campo DATE (fecha real)
  let year, month;
  if (fechaDate) {
    // Parsear fecha en formato DD/MM/YYYY
    const [dia, mes, anio] = fechaDate.trim().split('/');
    if (dia && mes && anio) {
      year = parseInt(anio, 10);
      month = parseInt(mes, 10);
    } else {
      // Si falla, intentar desde datetime
      const fecha = new Date(datetimeISO || new Date());
      year = fecha.getFullYear();
      month = fecha.getMonth() + 1;
    }
  } else {
    // Si no hay date, usar datetime como fallback
    const fecha = new Date(datetimeISO || new Date());
    year = fecha.getFullYear();
    month = fecha.getMonth() + 1;
  }

  // El amount ya viene transformado a centavos desde recuperarGastos
  // Pero si no está, intentar parsearlo desde el original
  let amountCents = data['amount'];
  if (typeof amountCents !== 'number') {
    // Si no es número, intentar parsearlo
    const importeOriginal = data['amount'] || data['amount_original'] || data['Importe'] || data['Monto'] || '0';
    amountCents = parseAmountToCents(importeOriginal);
  }

  // Mapear campos (usar nombres normalizados primero)
  const category = data['category'] || data['Categoria'] || data['Tipo de gatos'] || data['Tipo de gastos'] || data['Categoría'] || 'Sin categoría';
  const description = (data['description'] || data['Descripción'] || data['Descripcion'] || '').trim();
  const uuid = data['uuid'] || data['UUID'] || '';
  
  // Mapear el campo "Tipo" del Excel a los valores de la base de datos
  const tipoOriginal = (data['type'] || data['Tipo'] || '').trim().toLowerCase();
  let type;
  if (tipoOriginal.includes('egreso')) {
    type = 'EXPENSE';
  } else if (tipoOriginal.includes('ingreso')) {
    type = 'INCOME';
  } else if (tipoOriginal.includes('ahorro')) {
    type = 'SAVING';
  } else {
    // Si no se reconoce, intentar inferir desde la categoría o asumir EXPENSE
    const categoriaLower = category.toLowerCase();
    if (categoriaLower.includes('ingreso') || categoriaLower.includes('sueldo')) {
      type = 'INCOME';
    } else if (categoriaLower.includes('ahorro')) {
      type = 'SAVING';
    } else {
      type = 'EXPENSE'; // Por defecto
    }
  }
  
  // Detectar currency: si la categoría o descripción contiene "USD", usar USD, sino ARS
  const categoryLower = category.toLowerCase();
  const descriptionLower = description.toLowerCase();
  const currency = (categoryLower.includes('usd') || descriptionLower.includes('usd')) ? 'USD' : 'ARS';
  
  // Calcular AFFECTS_LIQUIDITY según TYPE: INCOME y EXPENSE afectan, SAVING no
  const affectsLiquidity = (type === 'INCOME' || type === 'EXPENSE') ? 1 : 0;

  return {
    uuid,
    datetime: datetimeISO,
    year,
    month,
    type,
    amount: amountCents,
    amount_cents: amountCents, // También incluir en centavos para referencia
    currency,
    category,
    description,
    affects_liquidity: affectsLiquidity,
    rowNumber // Mantener el número de fila para referencia
  };
}

/**
 * Parsea una fecha en formato DD/MM/YYYY HH:mm:ss o DD/MM/YYYY a ISO datetime
 * @param {string} fechaStr - Fecha en formato "21/1/2026 19:52:07" o "21/1/2026"
 * @returns {string} Fecha en formato ISO "2026-01-21T19:52:07-03:00" o "2026-01-21T00:00:00-03:00"
 */
function parseFechaToISO(fechaStr) {
  if (!fechaStr || typeof fechaStr !== 'string') {
    throw new Error('Fecha inválida o vacía');
  }

  // Formato esperado: "21/1/2026 19:52:07" o "21/01/2026" (solo fecha)
  const partes = fechaStr.trim().split(' ');
  
  if (partes.length < 1) {
    throw new Error(`Formato de fecha inválido: ${fechaStr}`);
  }

  const fechaParte = partes[0]; // "21/1/2026"
  let horaParte = partes[1] || '00:00:00'; // "19:52:07" o "00:00:00" si no hay hora

  const [dia, mes, anio] = fechaParte.split('/');
  
  if (!dia || !mes || !anio) {
    throw new Error(`Formato de fecha inválido: ${fechaStr}`);
  }

  // Normalizar día y mes a 2 dígitos
  const diaNormalizado = dia.padStart(2, '0');
  const mesNormalizado = mes.padStart(2, '0');

  // Normalizar hora: asegurar que tenga formato HH:mm:ss
  // Ejemplo: "1:40:13" -> "01:40:13"
  if (horaParte && horaParte !== '00:00:00') {
    const horaPartes = horaParte.split(':');
    if (horaPartes.length === 3) {
      const [h, m, s] = horaPartes;
      horaParte = `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`;
    }
  }

  // Crear fecha en formato ISO
  // Asumir timezone de Argentina (-03:00)
  const fechaISO = `${anio}-${mesNormalizado}-${diaNormalizado}T${horaParte}-03:00`;
  
  // Validar que la fecha sea válida
  const fechaObj = new Date(fechaISO);
  if (isNaN(fechaObj.getTime())) {
    throw new Error(`Fecha inválida: ${fechaStr}`);
  }

  return fechaISO;
}

/**
 * Transforma un array de gastos
 * @param {Array} gastos - Array de gastos desde Google Sheets
 * @returns {Array} Array de gastos transformados
 */
export function transformGastosToDB(gastos) {
  return gastos.map(gasto => {
    try {
      return transformGastoToDB(gasto);
    } catch (error) {
      console.error(`Error transformando gasto en fila ${gasto.rowNumber}:`, error);
      // Retornar null para filtrar después
      return null;
    }
  }).filter(gasto => gasto !== null); // Filtrar los que fallaron
}
