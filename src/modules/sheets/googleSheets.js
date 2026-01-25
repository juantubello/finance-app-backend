import GoogleSheetsService from './GoogleSheetsService.js';
import { transformGastosToDB } from './transformGasto.js';
import { parseAmountToCents, formatCentsToAmountString } from '../../lib/amount.js';

/**
 * Mapeo de campos de Google Sheets a nombres en inglés y minúscula
 * Si coincide con la base de datos, usa el mismo nombre
 */
const FIELD_MAPPING = {
  'Marca temporal': 'datetime',
  'Fecha': 'date', // Campo separado para la fecha (sin hora)
  'Importe': 'amount',
  'Monto': 'amount',
  'Descripción': 'description',
  'Descripcion': 'description',
  'Tipo de gatos': 'category',
  'Tipo de gastos': 'category',
  'Categoría': 'category',
  'Categoria': 'category',
  'Tipo': 'type',
  'UUID': 'uuid',
  'Uuid': 'uuid',
  'uuid': 'uuid'
};

/**
 * Normaliza el nombre de un campo al formato de la base de datos
 * @param {string} fieldName - Nombre del campo original
 * @returns {string} Nombre normalizado en inglés y minúscula
 */
function normalizeFieldName(fieldName) {
  if (!fieldName) return fieldName;
  
  // Si ya está en el mapeo, usar ese
  if (FIELD_MAPPING[fieldName]) {
    return FIELD_MAPPING[fieldName];
  }
  
  // Si no está en el mapeo, convertir a minúscula y normalizar
  // Remover acentos y caracteres especiales, convertir a minúscula
  return fieldName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remover acentos
    .replace(/[^a-z0-9_]/g, '_') // Reemplazar caracteres especiales con _
    .replace(/_+/g, '_') // Reemplazar múltiples _ con uno solo
    .replace(/^_|_$/g, ''); // Remover _ al inicio y final
}

/**
 * Recuperar todos los gastos de la pestaña "Gastos" (formato raw de Google Sheets)
 * @param {string} columnaInicio - Columna de inicio (ej: 'A')
 * @param {string} columnaFin - Columna de fin (ej: 'E')
 * @returns {Promise<Array>} Array de gastos con número de fila (formato raw)
 */
async function recuperarGastos(columnaInicio, columnaFin) {
  const sheetsService = new GoogleSheetsService();
  await sheetsService.initialize();

  // Construir el rango: Gastos!A:E (sin especificar filas para traer todo)
  const rango = `Gastos!${columnaInicio}:${columnaFin}`;
  
  // Leer todos los datos del rango
  const datos = await sheetsService.readSheet(rango);
  
  // Si no hay datos, retornar array vacío
  if (!datos || datos.length === 0) {
    return [];
  }

  // La primera fila suele ser el encabezado, empezar desde la fila 2
  const encabezados = datos[0];
  const gastos = [];

  // Procesar cada fila (empezando desde la fila 2)
  for (let i = 1; i < datos.length; i++) {
    const fila = datos[i];
    
    // Si la fila está vacía, saltarla
    if (!fila || fila.every(cell => !cell || cell.toString().trim() === '')) {
      continue;
    }

    // Crear objeto con los datos de la fila
    const gasto = {
      rowNumber: i + 1, // Número de fila en Excel (empezando desde 1, pero fila 1 es encabezado)
      data: {}
    };

    // Mapear cada columna al encabezado correspondiente con nombres normalizados
    encabezados.forEach((encabezado, index) => {
      const normalizedName = normalizeFieldName(encabezado);
      const valor = fila[index] || '';
      
      // Guardar el valor con el nombre normalizado
      gasto.data[normalizedName] = valor;
    });

    // Transformar el campo "amount" a centavos (puede venir como "Importe" o "Monto" originalmente)
    const amountOriginal = gasto.data['amount'] || '';
    if (amountOriginal && typeof amountOriginal === 'string' && amountOriginal.trim() !== '') {
      // Validar que el valor parece un monto (contiene números y posiblemente símbolos de moneda/formato)
      // Acepta: "$200.00", "-$200.00", "200,00", "-200.00", etc.
      const trimmedAmount = amountOriginal.trim();
      const looksLikeAmount = /^[-]?[\$€£¥]?[\s]*[\d.,\s]+$/.test(trimmedAmount);
      
      if (!looksLikeAmount) {
        // Si no parece un monto, probablemente los datos están desalineados
        console.warn(`⚠️  Valor en campo amount no parece un monto (fila ${gasto.rowNumber}): "${trimmedAmount}" - omitiendo transformación`);
        gasto.data['amount'] = null; // Establecer como null para indicar que no es válido
        gasto.data['amount_original'] = trimmedAmount;
        gasto.data['amount_error'] = 'El valor no parece ser un monto válido (posible desalineación de columnas)';
      } else {
        try {
          const amountCents = parseAmountToCents(amountOriginal);
          // Reemplazar el valor original con el transformado
          gasto.data['amount'] = amountCents;
          // Formatear amount_original con punto para miles y coma para decimales (formato ARS)
          gasto.data['amount_original'] = formatCentsToAmountString(amountCents, 'ARS');
        } catch (error) {
          // Si falla el parseo, mantener el original y agregar error
          console.warn(`⚠️  Error parseando amount en fila ${gasto.rowNumber}: ${amountOriginal}`, error.message);
          gasto.data['amount'] = null; // Establecer como null para indicar error
          gasto.data['amount_original'] = trimmedAmount;
          gasto.data['amount_error'] = error.message;
        }
      }
    }

    // Calcular affects_liquidity basado en el tipo
    const tipoOriginal = (gasto.data['type'] || '').trim().toLowerCase();
    if (tipoOriginal.includes('ahorro')) {
      gasto.data['affects_liquidity'] = 0;
    } else {
      gasto.data['affects_liquidity'] = 1;
    }

    // Asegurar que uuid esté presente (puede ser string vacío)
    if (gasto.data['uuid'] === undefined) {
      gasto.data['uuid'] = '';
    }

    gastos.push(gasto);
  }

  return gastos;
}

/**
 * Escribir en una celda específica de la pestaña "Gastos"
 * @param {string} columna - Columna (ej: 'E')
 * @param {number} fila - Número de fila (ej: 2)
 * @param {any} valor - Valor a escribir
 */
async function escribirEnGastos(columna, fila, valor) {
  const sheetsService = new GoogleSheetsService();
  await sheetsService.initialize();

  // Construir la referencia de celda: Gastos!E2
  const celda = `Gastos!${columna}${fila}`;
  
  // Escribir el valor en la celda
  await sheetsService.updateCell(celda, valor);
}

// ============================================
// EJEMPLOS DE USO
// ============================================

async function ejemplo() {
  try {
    // Ejemplo 1: Recuperar todos los gastos desde columna A hasta E
    console.log('📥 Recuperando gastos...');
    const gastos = await recuperarGastos('A', 'E');
    console.log(`Total de gastos: ${gastos.length}`);
    
    gastos.forEach(gasto => {
      console.log(`Fila ${gasto.rowNumber}:`, gasto.data);
    });

    // Ejemplo 2: Escribir en la columna E, fila 2
    console.log('\n📝 Escribiendo en celda E2...');
    await escribirEnGastos('E', 2, 'nuevo-valor');
    console.log('✅ Escrito correctamente');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Descomentar para ejecutar el ejemplo:
// ejemplo();

/**
 * Recuperar todos los gastos transformados al formato de la base de datos
 * @param {string} columnaInicio - Columna de inicio (ej: 'A')
 * @param {string} columnaFin - Columna de fin (ej: 'E')
 * @returns {Promise<Array>} Array de gastos transformados para la BD
 */
async function recuperarGastosTransformados(columnaInicio, columnaFin) {
  const gastosRaw = await recuperarGastos(columnaInicio, columnaFin);
  return transformGastosToDB(gastosRaw);
}

export {
  recuperarGastos,
  recuperarGastosTransformados,
  escribirEnGastos
};