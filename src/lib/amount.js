/**
 * Helpers para manejo de montos en centavos
 */

/**
 * Parsea un monto a centavos (INTEGER)
 * Soporta múltiples formatos:
 * - "115000" -> 11500000 (asume que es en unidades, multiplica por 100)
 * - "115,000.00" -> 11500000 (formato US: coma para miles, punto para decimales)
 * - "115.000,00" -> 11500000 (formato ES/AR: punto para miles, coma para decimales)
 * - "-1000" -> -100000 (negativo)
 * - "-1.000,50" -> -100050 (negativo con decimales)
 * 
 * Estrategia:
 * 1. Si no hay separador decimal (ni . ni , al final), interpretar como monto entero y multiplicar por 100
 * 2. Si hay separador decimal, detectar formato (US vs ES/AR) y parsear correctamente
 * 3. Si es número, asumir que ya está en unidades y multiplicar por 100
 */
export function parseAmountToCents(input) {
  if (typeof input === 'number') {
    // Si es número, asumir que está en unidades y convertir a centavos
    return Math.round(input * 100);
  }

  if (typeof input !== 'string') {
    throw new Error('Input debe ser string o number');
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Input vacío');
  }

  const isNegative = trimmed.startsWith('-');
  // Remover símbolos de moneda ($, €, etc.) y espacios
  let clean = trimmed.replace(/^-/, '').replace(/\s/g, '').replace(/^[$€£¥]/, '');

  // Si no tiene separadores decimales, asumir que es monto entero y multiplicar por 100
  if (!clean.includes('.') && !clean.includes(',')) {
    const value = parseInt(clean, 10);
    if (isNaN(value)) {
      throw new Error(`No se pudo parsear: ${input}`);
    }
    return (isNegative ? -1 : 1) * value * 100;
  }

  // Detectar formato: si tiene punto y coma, el último separador es el decimal
  const hasBoth = clean.includes('.') && clean.includes(',');
  
  let amountStr;
  if (hasBoth) {
    // Determinar cuál es el separador decimal (el que está más cerca del final)
    const lastDot = clean.lastIndexOf('.');
    const lastComma = clean.lastIndexOf(',');
    
    if (lastDot > lastComma) {
      // Formato US: "115,000.50" -> punto es decimal
      amountStr = clean.replace(/,/g, '');
    } else {
      // Formato ES/AR: "115.000,50" -> coma es decimal
      amountStr = clean.replace(/\./g, '').replace(',', '.');
    }
  } else if (clean.includes(',')) {
    // Solo coma: puede ser formato ES/AR o miles sin decimales
    const parts = clean.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      // Formato ES/AR con decimales: "115000,50"
      amountStr = clean.replace(',', '.');
    } else {
      // Solo miles: "115,000" -> tratar como entero
      amountStr = clean.replace(/,/g, '');
    }
  } else {
    // Solo punto: puede ser formato US o miles sin decimales
    const parts = clean.split('.');
    if (parts.length === 2 && parts[1].length <= 2) {
      // Formato US con decimales: "115000.50"
      amountStr = clean;
    } else {
      // Solo miles: "115.000" -> tratar como entero
      amountStr = clean.replace(/\./g, '');
    }
  }

  const value = parseFloat(amountStr);
  if (isNaN(value)) {
    throw new Error(`No se pudo parsear: ${input}`);
  }

  return (isNegative ? -1 : 1) * Math.round(value * 100);
}

/**
 * Formatea centavos a string con formato de moneda
 */
export function formatCentsToAmountString(cents, currency = 'ARS') {
  const amount = cents / 100;
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  
  // Formato ARS: punto para miles, coma para decimales
  // Formato USD: coma para miles, punto para decimales
  const formatted = absAmount.toLocaleString(
    currency === 'USD' ? 'en-US' : 'es-AR',
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );
  
  return isNegative ? `-${formatted}` : formatted;
}
