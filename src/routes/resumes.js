import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import pdf from 'pdf-parse';
import { parseAmountToCents, formatCentsToAmountString } from '../lib/amount.js';
import { prepare } from '../db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Ruta al directorio de resúmenes (relativa al root del proyecto)
const RESUMES_DIR = path.join(__dirname, '../../resumes');

// Diccionario de meses en español
const meses = {
  'Ene': '01', 'Feb': '02', 'Mar': '03', 'Abr': '04', 'May': '05', 'Jun': '06',
  'Jul': '07', 'Ago': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dic': '12'
};

/**
 * Convierte una fecha del formato DD-MMM-YY a ISO
 * @param {string} fechaStr - Fecha en formato "15-Ene-26"
 * @returns {Object} { fecha_raw, fecha_timestamp }
 */
function convertirFecha(fechaStr) {
  try {
    const [dia, mesAbreviado, anioCorto] = fechaStr.split('-');
    const mes = meses[mesAbreviado.charAt(0).toUpperCase() + mesAbreviado.slice(1).toLowerCase()] || '01';
    const anio = parseInt(anioCorto, 10);
    const anioCompleto = anio < 100 ? 2000 + anio : anio;
    const fechaISO = `${anioCompleto.toString().padStart(4, '0')}-${mes}-${dia.padStart(2, '0')}`;
    const fechaObj = new Date(fechaISO);
    return { fecha_raw: fechaStr, fecha_timestamp: fechaObj.toISOString() };
  } catch (error) {
    return { fecha_raw: fechaStr, fecha_timestamp: null };
  }
}

/**
 * Limpia la descripción para incluir el patrón de cuotas C.XX/XX pero excluir números posteriores
 * @param {string} descripcion - Descripción cruda
 * @returns {string} - Descripción limpia
 */
function limpiarDescripcion(descripcion) {
  if (!descripcion) return '';
  
  // Buscar el patrón de cuotas C.XX/XX
  const cuotasMatch = descripcion.match(/(C\.\d{2}\/\d{2})/);
  
  if (cuotasMatch) {
    // Encontrar la posición del patrón de cuotas
    const cuotasIndex = descripcion.indexOf(cuotasMatch[0]);
    const cuotasEndIndex = cuotasIndex + cuotasMatch[0].length;
    
    // Tomar todo hasta el final del patrón de cuotas
    let descripcionLimpia = descripcion.substring(0, cuotasEndIndex).trim();
    
    // Buscar si hay números después del patrón de cuotas (antes del importe)
    // El patrón sería: C.XX/XX seguido de espacios y luego números
    const despuesCuotas = descripcion.substring(cuotasEndIndex).trim();
    const numerosDespuesMatch = despuesCuotas.match(/^\s*\d+/);
    
    // Si hay números después, ya los excluimos al tomar solo hasta cuotasEndIndex
    // Pero necesitamos asegurarnos de que no haya espacios extra al final
    descripcionLimpia = descripcionLimpia.replace(/\s+$/, '');
    
    return descripcionLimpia;
  }
  
  // Si no hay patrón de cuotas, devolver la descripción tal cual (limpiando espacios)
  return descripcion.trim().replace(/\s+/g, ' ');
}

/**
 * Extrae consumos con total de una sección específica
 * @param {string} texto - Texto completo del PDF
 * @param {string} nombreSeccion - Nombre de la sección a buscar
 * @param {string} totalMatchString - String que indica el final de la sección
 * @param {string} otroTotalMatchString - String que indica el total de la otra sección (para evitar duplicados)
 * @returns {Object} { detalles, total }
 */
function extraerConsumosConTotal(texto, nombreSeccion, totalMatchString, otroTotalMatchString = null) {
  const detalles = [];
  // Patrón más flexible: fecha al inicio, descripción en medio, importe al final
  // Puede tener múltiples espacios o estar en formato de columnas
  const patronLinea = /^(\d{2}-[A-Za-z]{3}-\d{2})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
  let dentroDeSeccion = false;
  let totalPesos = '';
  let totalDolares = '';
  let indiceTotal = -1; // Guardar el índice donde encontramos el total
  let indiceOtroTotal = -1; // Guardar el índice del total de la otra sección (si existe)

  const lineas = texto.split('\n');
  
  // Buscar el índice del total de la otra sección (si se proporciona)
  if (otroTotalMatchString) {
    for (let i = 0; i < lineas.length; i++) {
      if (lineas[i].includes(otroTotalMatchString)) {
        indiceOtroTotal = i;
        break;
      }
    }
  }
  
  // Primera pasada: buscar el total y la sección de inicio
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();
    
    if (linea.includes(nombreSeccion)) {
      dentroDeSeccion = true;
      // Saltar la línea de encabezado siguiente si existe
      continue;
    }
    
    if (linea.includes(totalMatchString)) {
      indiceTotal = i;
      dentroDeSeccion = false;
      // Buscar los totales - pueden estar en la misma línea o en las siguientes
      // Formato: "2.414.894,7242,61" (pesos y dólares concatenados)
      // Ejemplo del PDF: "TOTAL CONSUMOS DE J FERNANDEZ TUBELLO" seguido de "2.414.894,7242,61"
      
      // Buscar en las siguientes 3 líneas
      for (let j = i; j < Math.min(i + 3, lineas.length); j++) {
        const lineaBuscar = lineas[j].trim();
        
        // Buscar formato concatenado: "2.414.894,7242,61"
        const totalMatch = lineaBuscar.match(/(\d{1,3}(?:\.\d{3})*,\d{2})(\d{1,3}(?:\.\d{3})*,\d{2})/);
        if (totalMatch) {
          totalPesos = totalMatch[1];
          totalDolares = totalMatch[2];
          break;
        }
        
        // Buscar separados por espacios
        const numeros = lineaBuscar.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/g);
        if (numeros && numeros.length >= 2) {
          totalPesos = numeros[numeros.length - 2];
          totalDolares = numeros[numeros.length - 1];
          break;
        } else if (numeros && numeros.length === 1 && !totalPesos) {
          // Si solo hay un número y aún no tenemos pesos, puede ser el total de pesos
          totalPesos = numeros[0];
        }
      }
      continue;
    }
    
    if (dentroDeSeccion) {
      // Saltar líneas de encabezado
      if (linea.includes('FECHA') || linea.includes('DESCRIPCIÓN') || linea.includes('NRO. CUPÓN') || 
          linea.includes('PESOS') || linea.includes('DÓLARES') || linea === '' ||
          linea.includes('Banco BBVA') || linea.includes('Sobre (') ||
          linea.includes('Resumen') || linea.includes('Premium World') || linea.includes('Visa') ||
          linea.includes('SALDO ACTUAL') || linea.includes('SU PAGO EN') || 
          linea.includes('PAGO EN PESOS') || linea.includes('PAGO EN USD') ||
          linea.match(/^SALDO\s+ACTUAL/i) || linea.match(/^SU\s+PAGO/i)) {
        continue;
      }
      
      // Detectar si la línea empieza con una fecha
      const fechaMatch = linea.match(/^(\d{2}-[A-Za-z]{3}-\d{2})/);
      if (fechaMatch) {
        const fechaRaw = fechaMatch[1];
        let descripcion = '';
        let importe = '';
        
        // Caso 1: Todo está en la misma línea (fecha descripción importe)
        const importesEnLinea = linea.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/g);
        if (importesEnLinea && importesEnLinea.length > 0) {
          importe = importesEnLinea[importesEnLinea.length - 1];
          const importeIndex = linea.indexOf(importesEnLinea[0]);
          descripcion = linea.substring(fechaRaw.length, importeIndex).trim();
          descripcion = limpiarDescripcion(descripcion);
        } else {
          // Caso 2: Los datos están en líneas separadas
          // La línea actual solo tiene la fecha (o fecha + algo más)
          const restoDeLinea = linea.substring(fechaRaw.length).trim();
          
          // Buscar descripción e importe en las siguientes 5 líneas
          // El formato puede ser: fecha en línea 1, descripción en línea 2, importe en línea 3
          for (let j = i + 1; j < Math.min(i + 6, lineas.length); j++) {
            const siguienteLinea = lineas[j] ? lineas[j].trim() : '';
            
            // Si encontramos otra fecha, ya terminamos este registro
            if (siguienteLinea.match(/^(\d{2}-[A-Za-z]{3}-\d{2})/)) {
              break;
            }
            
            // Si la línea está vacía o es un encabezado, continuar
            if (!siguienteLinea || siguienteLinea.includes('Banco BBVA') || 
                siguienteLinea.includes('Sobre (') || siguienteLinea.includes('TOTAL') ||
                siguienteLinea.includes('SALDO ACTUAL') || siguienteLinea.includes('Consumos') ||
                siguienteLinea.includes('FECHA') || siguienteLinea.includes('DESCRIPCIÓN') ||
                siguienteLinea.includes('NRO. CUPÓN') || siguienteLinea.includes('PESOS') ||
                siguienteLinea.includes('DÓLARES') || siguienteLinea === '') {
              continue;
            }
            
            // Buscar importe en esta línea
            const importesMatch = siguienteLinea.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/g);
            
            if (importesMatch && importesMatch.length > 0) {
              // Esta línea tiene un importe
              importe = importesMatch[importesMatch.length - 1];
              
              // Si aún no tenemos descripción, buscar antes del importe en esta línea
              if (!descripcion || descripcion.length < 3) {
                const importeIndex = siguienteLinea.indexOf(importesMatch[0]);
                const descripcionEnLinea = siguienteLinea.substring(0, importeIndex).trim();
                if (descripcionEnLinea && descripcionEnLinea.length > 3) {
                  descripcion = limpiarDescripcion(descripcionEnLinea);
                } else if (restoDeLinea && restoDeLinea.length > 3) {
                  // Usar lo que hay después de la fecha en la línea original
                  descripcion = limpiarDescripcion(restoDeLinea);
                } else {
                  // Buscar descripción en la línea anterior (j-1)
                  if (j > i + 1) {
                    const lineaAnterior = lineas[j - 1] ? lineas[j - 1].trim() : '';
                    if (lineaAnterior && lineaAnterior.length > 3 && 
                        !lineaAnterior.match(/^(\d{2}-[A-Za-z]{3}-\d{2})/) &&
                        !lineaAnterior.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/)) {
                      descripcion = limpiarDescripcion(lineaAnterior);
                    }
                  }
                }
              } else {
                // Limpiar la descripción que ya tenemos
                descripcion = limpiarDescripcion(descripcion);
              }
              break;
            } else {
              // Esta línea no tiene importe, probablemente es la descripción
              if (!descripcion || descripcion.length < 3) {
                // Verificar que no sea un encabezado o texto irrelevante
                if (siguienteLinea.length > 3 && siguienteLinea.length < 200 &&
                    !siguienteLinea.match(/^(Sobre|Banco|Resumen|Premium|Visa|Tarjetas|CONSOLIDADO|CIERRE|VENCIMIENTO|SALDO|PAGO|Límites|Pesos|Dólares|FECHA|DESCRIPCIÓN|NRO|CUPÓN)/i) &&
                    !siguienteLinea.match(/^\d+$/) && // No es solo números
                    !siguienteLinea.match(/^[A-Z\s]{20,}$/) && // No es solo mayúsculas largas (encabezado)
                    !siguienteLinea.match(/^[^\w\s]*$/)) { // No es solo símbolos
                  descripcion = limpiarDescripcion(siguienteLinea);
                } else if (restoDeLinea && restoDeLinea.length > 3) {
                  // Si la siguiente línea no es válida, usar lo que hay en la línea original
                  descripcion = limpiarDescripcion(restoDeLinea);
                }
              } else {
                // Limpiar la descripción que ya tenemos
                descripcion = limpiarDescripcion(descripcion);
              }
            }
          }
        }
        
        // Solo agregar si tenemos fecha, descripción e importe válidos
        if (fechaRaw && descripcion && descripcion.length >= 3 && importe) {
          const { fecha_raw, fecha_timestamp } = convertirFecha(fechaRaw);
          
          // Detectar si es un consumo en USD
          // Buscar "USD" en la descripción, en la línea original, o en las líneas siguientes
          let isUSD = descripcion.toUpperCase().includes('USD') || 
                      linea.toUpperCase().includes('USD');
          
          // Si no encontramos USD en la línea actual, buscar en las siguientes líneas
          if (!isUSD) {
            for (let k = i + 1; k < Math.min(i + 3, lineas.length); k++) {
              const siguienteLinea = lineas[k] ? lineas[k].trim() : '';
              if (siguienteLinea.toUpperCase().includes('USD')) {
                isUSD = true;
                break;
              }
              // Si encontramos otra fecha, ya no es parte de este registro
              if (siguienteLinea.match(/^(\d{2}-[A-Za-z]{3}-\d{2})/)) {
                break;
              }
            }
          }
          
          detalles.push({
            fecha: fecha_raw,
            fechaTimestamp: fecha_timestamp,
            descripcion: descripcion,
            importe: importe,
            isUSD: isUSD
          });
        }
      }
    }
  }

  // Si encontramos el total pero no encontramos la sección de inicio ni items,
  // buscar hacia atrás desde el total para encontrar items
  if (indiceTotal >= 0 && detalles.length === 0 && totalPesos) {
    // Buscar hacia atrás desde el total hasta encontrar items o llegar al inicio
    // Limitar la búsqueda a las últimas 200 líneas antes del total
    // Pero también detener si encontramos el total de la otra sección
    const inicioBusqueda = Math.max(0, indiceTotal - 200);
    // Si hay otro total, no buscar más allá de ese punto
    const limiteBusqueda = indiceOtroTotal >= 0 ? Math.max(inicioBusqueda, indiceOtroTotal + 1) : inicioBusqueda;
    
    for (let i = indiceTotal - 1; i >= limiteBusqueda; i--) {
      const linea = lineas[i] ? lineas[i].trim() : '';
      
      // Si encontramos el total de la otra sección, detener inmediatamente
      if (otroTotalMatchString && linea.includes(otroTotalMatchString)) {
        break;
      }
      
      // Si encontramos otra sección de totales o encabezados importantes, detener
      if (linea.includes('TOTAL CONSUMOS') || 
          linea.includes('SALDO ACTUAL') ||
          linea.includes('CONSOLIDADO') ||
          linea.includes('CIERRE ACTUAL') ||
          (linea.includes('Consumos') && !linea.includes(totalMatchString))) {
        // Si encontramos otra sección de consumos que no es el total, detener
        if (linea.includes('Consumos') && !linea.includes('TOTAL')) {
          break;
        }
        continue;
      }
      
      // Saltar líneas de encabezado
      if (linea.includes('FECHA') || linea.includes('DESCRIPCIÓN') || linea.includes('NRO. CUPÓN') || 
          linea.includes('PESOS') || linea.includes('DÓLARES') || linea === '' ||
          linea.includes('Banco BBVA') || linea.includes('Sobre (') ||
          linea.includes('Resumen') || linea.includes('Premium World') ||
          linea.includes('SALDO ACTUAL') || linea.includes('SU PAGO EN') || 
          linea.includes('PAGO EN PESOS') || linea.includes('PAGO EN USD') ||
          linea.match(/^SALDO\s+ACTUAL/i) || linea.match(/^SU\s+PAGO/i)) {
        continue;
      }
      
      // Detectar si la línea empieza con una fecha
      const fechaMatch = linea.match(/^(\d{2}-[A-Za-z]{3}-\d{2})/);
      if (fechaMatch) {
        const fechaRaw = fechaMatch[1];
        let descripcion = '';
        let importe = '';
        
        // Caso 1: Todo está en la misma línea (fecha descripción importe)
        const importesEnLinea = linea.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/g);
        if (importesEnLinea && importesEnLinea.length > 0) {
          importe = importesEnLinea[importesEnLinea.length - 1];
          const importeIndex = linea.indexOf(importesEnLinea[0]);
          descripcion = linea.substring(fechaRaw.length, importeIndex).trim();
          descripcion = limpiarDescripcion(descripcion);
          
          // Filtrar descripciones que no son consumos reales
          if (descripcion.includes('SALDO ACTUAL') || descripcion.includes('SU PAGO EN') ||
              descripcion.match(/^SALDO\s+ACTUAL/i) || descripcion.match(/^SU\s+PAGO/i)) {
            continue;
          }
        } else {
          // Caso 2: Los datos están en líneas separadas
          const restoDeLinea = linea.substring(fechaRaw.length).trim();
          
          // Buscar descripción e importe en las siguientes líneas (hacia adelante)
          for (let j = i + 1; j < Math.min(i + 6, indiceTotal); j++) {
            const siguienteLinea = lineas[j] ? lineas[j].trim() : '';
            
            // Si encontramos otra fecha o el total, detener
            if (siguienteLinea.match(/^(\d{2}-[A-Za-z]{3}-\d{2})/) || 
                siguienteLinea.includes(totalMatchString)) {
              break;
            }
            
            // Si la línea está vacía o es un encabezado, continuar
            if (!siguienteLinea || siguienteLinea.includes('TOTAL') ||
                siguienteLinea.includes('SALDO ACTUAL') || siguienteLinea.includes('Consumos') ||
                siguienteLinea.includes('FECHA') || siguienteLinea.includes('DESCRIPCIÓN') ||
                siguienteLinea.includes('NRO. CUPÓN') || siguienteLinea.includes('PESOS') ||
                siguienteLinea.includes('DÓLARES') || siguienteLinea === '') {
              continue;
            }
            
            // Buscar importe en esta línea
            const importesMatch = siguienteLinea.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/g);
            
            if (importesMatch && importesMatch.length > 0) {
              importe = importesMatch[importesMatch.length - 1];
              
              if (!descripcion || descripcion.length < 3) {
                const importeIndex = siguienteLinea.indexOf(importesMatch[0]);
                const descripcionEnLinea = siguienteLinea.substring(0, importeIndex).trim();
                if (descripcionEnLinea && descripcionEnLinea.length > 3) {
                  descripcion = limpiarDescripcion(descripcionEnLinea);
                } else if (restoDeLinea && restoDeLinea.length > 3) {
                  descripcion = limpiarDescripcion(restoDeLinea);
                } else if (j > i + 1) {
                  const lineaAnterior = lineas[j - 1] ? lineas[j - 1].trim() : '';
                  if (lineaAnterior && lineaAnterior.length > 3 && 
                      !lineaAnterior.match(/^(\d{2}-[A-Za-z]{3}-\d{2})/) &&
                      !lineaAnterior.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/)) {
                    descripcion = limpiarDescripcion(lineaAnterior);
                  }
                }
              } else {
                descripcion = limpiarDescripcion(descripcion);
              }
              break;
            } else {
              if (!descripcion || descripcion.length < 3) {
                if (siguienteLinea.length > 3 && siguienteLinea.length < 200 &&
                    !siguienteLinea.match(/^(Sobre|Banco|Resumen|Premium|Visa|Tarjetas|CONSOLIDADO|CIERRE|VENCIMIENTO|SALDO|PAGO|Límites|Pesos|Dólares|FECHA|DESCRIPCIÓN|NRO|CUPÓN)/i) &&
                    !siguienteLinea.match(/^\d+$/) &&
                    !siguienteLinea.match(/^[A-Z\s]{20,}$/) &&
                    !siguienteLinea.match(/^[^\w\s]*$/)) {
                  descripcion = limpiarDescripcion(siguienteLinea);
                } else if (restoDeLinea && restoDeLinea.length > 3) {
                  descripcion = limpiarDescripcion(restoDeLinea);
                }
              } else {
                descripcion = limpiarDescripcion(descripcion);
              }
            }
          }
        }
        
        // Solo agregar si tenemos fecha, descripción e importe válidos
        // Filtrar descripciones que no son consumos reales
        if (fechaRaw && descripcion && descripcion.length >= 3 && importe &&
            !descripcion.includes('SALDO ACTUAL') && !descripcion.includes('SU PAGO EN') &&
            !descripcion.match(/^SALDO\s+ACTUAL/i) && !descripcion.match(/^SU\s+PAGO/i) &&
            !descripcion.includes('PAGO EN PESOS') && !descripcion.includes('PAGO EN USD')) {
          const { fecha_raw, fecha_timestamp } = convertirFecha(fechaRaw);
          
          let isUSD = descripcion.toUpperCase().includes('USD') || 
                      linea.toUpperCase().includes('USD');
          
          if (!isUSD) {
            for (let k = i + 1; k < Math.min(i + 3, indiceTotal); k++) {
              const siguienteLinea = lineas[k] ? lineas[k].trim() : '';
              if (siguienteLinea.toUpperCase().includes('USD')) {
                isUSD = true;
                break;
              }
              if (siguienteLinea.match(/^(\d{2}-[A-Za-z]{3}-\d{2})/)) {
                break;
              }
            }
          }
          
          // Insertar al inicio para mantener el orden cronológico
          detalles.unshift({
            fecha: fecha_raw,
            fechaTimestamp: fecha_timestamp,
            descripcion: descripcion,
            importe: importe,
            isUSD: isUSD
          });
        }
      }
    }
  }

  return {
    detalles,
    total: { pesos: totalPesos, dolares: totalDolares }
  };
}

/**
 * Extrae impuestos, cargos e intereses
 * @param {string} texto - Texto completo del PDF
 * @returns {Object} { detalles, total }
 */
function extraerImpuestos(texto) {
  const detalles = [];
  // Patrón más flexible para impuestos
  const patronLinea = /^(\d{2}-[A-Za-z]{3}-\d{2})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})(?:\s+(\d{1,3}(?:\.\d{3})*,\d{2}))?\s*$/;
  let dentroDeSeccion = false;
  let totalPesos = '';
  let totalDolares = '';

  const lineas = texto.split('\n');
  
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();
    
    if (linea.includes('Impuestos, cargos e intereses')) {
      dentroDeSeccion = true;
      continue;
    }
    
    if (linea.includes('SALDO ACTUAL')) {
      dentroDeSeccion = false;
      // Buscar totales - pueden estar en líneas separadas
      // "SALDO ACTUAL $", "3.639.318,49", "SALDO ACTUAL U$S", "62,57"
      // O en formato "SALDO ACTUAL", "3.639.318,4962,57" (concatenados)
      
      // Buscar en las siguientes líneas
      for (let j = i + 1; j < Math.min(i + 5, lineas.length); j++) {
        const siguienteLinea = lineas[j].trim();
        
        // Buscar formato concatenado
        const totalMatch = siguienteLinea.match(/(\d{1,3}(?:\.\d{3})*,\d{2})(\d{1,3}(?:\.\d{3})*,\d{2})/);
        if (totalMatch) {
          totalPesos = totalMatch[1];
          totalDolares = totalMatch[2];
          break;
        }
        
        // Buscar líneas con "SALDO ACTUAL $" y "SALDO ACTUAL U$S"
        if (siguienteLinea.includes('SALDO ACTUAL $')) {
          const pesosMatch = siguienteLinea.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/);
          if (pesosMatch) totalPesos = pesosMatch[1];
        }
        if (siguienteLinea.includes('SALDO ACTUAL U$S')) {
          const dolaresMatch = siguienteLinea.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/);
          if (dolaresMatch) totalDolares = dolaresMatch[1];
        }
        
        // Si encontramos números sueltos después de SALDO ACTUAL
        const numeros = siguienteLinea.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/g);
        if (numeros && numeros.length >= 2) {
          totalPesos = numeros[0];
          totalDolares = numeros[1];
          break;
        }
      }
      continue;
    }
    
    if (dentroDeSeccion) {
      // Saltar líneas de encabezado
      if (linea.includes('FECHA') || linea.includes('DESCRIPCIÓN') || linea.includes('PESOS') || 
          linea.includes('DÓLARES') || linea === '' ||
          linea.includes('Banco BBVA') || linea.includes('Sobre (')) {
        continue;
      }
      
      // Detectar si la línea empieza con una fecha
      const fechaMatch = linea.match(/^(\d{2}-[A-Za-z]{3}-\d{2})/);
      if (fechaMatch) {
        const fechaRaw = fechaMatch[1];
        
        // Buscar importes en la línea
        const importes = linea.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/g);
        
        if (importes && importes.length > 0) {
          // Para impuestos, puede haber pesos y dólares, o solo uno
          // Tomar el último importe (generalmente es el relevante)
          const importe = importes[importes.length - 1];
          
          // La descripción es todo lo que está entre la fecha y el primer importe
          const importeIndex = linea.indexOf(importes[0]);
          let descripcion = linea.substring(fechaRaw.length, importeIndex).trim();
          
          // Limpiar la descripción de espacios múltiples y símbolos de moneda
          descripcion = descripcion.replace(/\s+/g, ' ').replace(/\$\s*/g, '').trim();
          
          const { fecha_raw, fecha_timestamp } = convertirFecha(fechaRaw);
          detalles.push({
            fecha: fecha_raw,
            fechaTimestamp: fecha_timestamp,
            descripcion: descripcion,
            importe: importe
          });
        }
      }
    }
  }

  return {
    detalles,
    total: { pesos: totalPesos, dolares: totalDolares }
  };
}

/**
 * Parsea un número en formato argentino (punto para miles, coma para decimales)
 * @param {string} str - String con formato "73.593,90" o "62,57"
 * @returns {number} Número parseado
 */
function parseArNumber(str) {
  if (!str) return null;
  const cleaned = str.trim().replace(/\./g, '').replace(',', '.');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Extrae el valor entre paréntesis de una línea
 * @param {string} line - Línea de texto
 * @returns {string|null} Valor entre paréntesis o null
 */
function extractBetweenParentheses(line) {
  const match = line.match(/\(\s*([0-9\.\,]+)\s*\)/);
  return match ? match[1] : null;
}

/**
 * Calcula el conversion_amount (dólar tarjeta efectivo) basado en el PDF
 * @param {string} texto - Texto completo del PDF
 * @returns {Object} { conversion_amount, debug_info } o null si no se puede calcular
 */
function calcularConversionAmount(texto) {
  try {
    const lineas = texto.split('\n');
    
    // 1. Extraer total USD del resumen
    let totalUsd = null;
    for (let i = 0; i < lineas.length; i++) {
      const linea = lineas[i].trim();
      // Buscar "SALDO ACTUAL U$S" seguido del número
      if (linea.includes('SALDO ACTUAL U$S')) {
        // Puede estar en la misma línea o en la siguiente
        const match = linea.match(/SALDO\s+ACTUAL\s+U\$S\s*([0-9\.\,]+)/i);
        if (match) {
          totalUsd = parseArNumber(match[1]);
        } else {
          // Buscar en la siguiente línea
          if (i + 1 < lineas.length) {
            const siguienteLinea = lineas[i + 1].trim();
            const numeroMatch = siguienteLinea.match(/([0-9\.\,]+)/);
            if (numeroMatch) {
              totalUsd = parseArNumber(numeroMatch[1]);
            }
          }
        }
        break;
      }
    }
    
    if (!totalUsd) {
      console.warn('⚠️  No se pudo extraer total USD del resumen');
      return null;
    }
    
    // 2. Extraer base imponible en pesos
    let basePesos = null;
    const bases = [];
    
    for (let i = 0; i < lineas.length; i++) {
      const linea = lineas[i].trim();
      
      // Buscar IIBB PERCEP-BSAS
      if (linea.includes('IIBB PERCEP-BSAS')) {
        const baseStr = extractBetweenParentheses(linea);
        if (baseStr) {
          const base = parseArNumber(baseStr);
          if (base) {
            bases.push({ tipo: 'IIBB', base });
          }
        }
      }
      
      // Buscar IVA RG 4240
      if (linea.includes('IVA RG 4240')) {
        const baseStr = extractBetweenParentheses(linea);
        if (baseStr) {
          const base = parseArNumber(baseStr);
          if (base) {
            bases.push({ tipo: 'IVA', base });
          }
        }
      }
      
      // Buscar DB.RG 5617
      if (linea.includes('RG 5617') || linea.includes('DB.RG 5617')) {
        const baseStr = extractBetweenParentheses(linea);
        if (baseStr) {
          const base = parseArNumber(baseStr);
          if (base) {
            bases.push({ tipo: 'RG5617', base });
          }
        }
      }
    }
    
    // Elegir la base más alta, o priorizar IVA/IIBB sobre RG5617
    if (bases.length > 0) {
      const iibbBase = bases.find(b => b.tipo === 'IIBB');
      const ivaBase = bases.find(b => b.tipo === 'IVA');
      const rg5617Base = bases.find(b => b.tipo === 'RG5617');
      
      // Priorizar IIBB o IVA sobre RG5617
      if (iibbBase) {
        basePesos = iibbBase.base;
      } else if (ivaBase) {
        basePesos = ivaBase.base;
      } else if (rg5617Base) {
        basePesos = rg5617Base.base;
      } else {
        // Si no hay coincidencias exactas, tomar la más alta
        basePesos = Math.max(...bases.map(b => b.base));
      }
    }
    
    if (!basePesos) {
      console.warn('⚠️  No se pudo extraer base imponible en pesos');
      return null;
    }
    
    // 3. Calcular tipo de cambio base
    const fxBase = basePesos / totalUsd;
    
    // 4. Calcular factor de impuestos (30% + 21% + 2% = 53% = 1.53)
    const factorImpuestos = 1 + 0.30 + 0.21 + 0.02; // 1.53
    
    // 5. Calcular dólar tarjeta efectivo
    const conversionAmount = fxBase * factorImpuestos;
    
    const debugInfo = {
      total_usd: totalUsd,
      base_pesos: basePesos,
      fx_base: fxBase,
      factor_impuestos: factorImpuestos,
      conversion_amount: conversionAmount
    };
    
    console.log('💰 Conversion Amount Debug:', debugInfo);
    
    return {
      conversion_amount: Math.round(conversionAmount * 100) / 100, // Redondear a 2 decimales
      conversion_amount_cents: Math.round(conversionAmount * 100),
      debug_info: debugInfo
    };
  } catch (error) {
    console.error('❌ Error calculando conversion_amount:', error);
    return null;
  }
}

/**
 * Genera un UUID basado en el hash del contenido del PDF
 * @param {Buffer} pdfBuffer - Contenido del PDF
 * @returns {string} UUID basado en hash
 */
function generarUUIDDesdeHash(pdfBuffer) {
  const hash = createHash('sha256').update(pdfBuffer).digest('hex');
  // Convertir a formato UUID v4 (tomar los primeros 32 caracteres y formatear)
  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
}

/**
 * Extrae año, mes y tipo de tarjeta del nombre del archivo
 * Formato esperado: VISA_01_2026.pdf o MASTERCARD_01_2026.pdf
 * @param {string} filename - Nombre del archivo
 * @returns {Object} { cardType, month, year } o null si no coincide
 */
function extraerInfoDelArchivo(filename) {
  const match = filename.match(/^(VISA|MASTERCARD)_(\d{2})_(\d{4})\.pdf$/i);
  if (!match) {
    return null;
  }
  
  return {
    cardType: match[1].toUpperCase(),
    month: parseInt(match[2], 10),
    year: parseInt(match[3], 10)
  };
}

/**
 * POST /resumes/syncResumes
 * Procesa los PDFs de resúmenes bancarios del directorio resumes/
 * Busca archivos con nomenclatura: VISA_01_2026.pdf, MASTERCARD_01_2026.pdf, etc.
 */
router.post('/syncResumes', async (req, res) => {
  try {
    // Verificar que el directorio existe
    if (!fs.existsSync(RESUMES_DIR)) {
      fs.mkdirSync(RESUMES_DIR, { recursive: true });
    }

    // Buscar archivos PDF en el directorio
    const archivos = fs.readdirSync(RESUMES_DIR);
    const pdfs = archivos.filter(archivo => 
      archivo.toLowerCase().endsWith('.pdf') && 
      (archivo.startsWith('VISA_') || archivo.startsWith('MASTERCARD_'))
    );

    if (pdfs.length === 0) {
      return res.json({
        success: true,
        message: 'No se encontraron PDFs en el directorio resumes/',
        total: 0,
        resumes: []
      });
    }

    const resultados = [];
    
    // Separar PDFs por tipo y ordenar: VISA primero, luego MASTERCARD
    const visaPdfs = pdfs.filter(p => p.startsWith('VISA_'));
    const mastercardPdfs = pdfs.filter(p => p.startsWith('MASTERCARD_'));
    const sortedPdfs = [...visaPdfs, ...mastercardPdfs];
    
    // Variable para guardar el conversion_amount de VISA
    let visaConversionAmount = null;
    let visaConversionAmountData = null;

    // Procesar cada PDF
    for (const pdfFile of sortedPdfs) {
      try {
        const pdfPath = path.join(RESUMES_DIR, pdfFile);
        const pdfBuffer = fs.readFileSync(pdfPath);
        
        // Generar UUID basado en el hash del contenido
        const uuid = generarUUIDDesdeHash(pdfBuffer);

        // Extraer información del nombre del archivo
        const archivoInfo = extraerInfoDelArchivo(pdfFile);
        if (!archivoInfo) {
          throw new Error(`Formato de archivo no válido: ${pdfFile}. Se espera VISA_MM_YYYY.pdf o MASTERCARD_MM_YYYY.pdf`);
        }

        // Extraer texto del PDF
        const data = await pdf(pdfBuffer);
        const textoTotal = data.text;

        // Debug: buscar si existen las secciones esperadas (solo en endpoint de prueba)
        let tieneSeccionJuan, tieneSeccionCami, tieneImpuestos, seccionesEncontradas;
        // Estas variables se definirán solo en el endpoint /test
        tieneSeccionJuan = textoTotal.includes('Consumos J Fernandez Tubello') || 
                            textoTotal.includes('Consumos J Fernandez') ||
                            textoTotal.includes('J Fernandez');
        tieneSeccionCami = textoTotal.includes('Consumos Camila V Montiel') || 
                           textoTotal.includes('Consumos Camila') ||
                           textoTotal.includes('Camila V Montiel');
        tieneImpuestos = textoTotal.includes('Impuestos, cargos e intereses');
        
        // Buscar variaciones de los nombres de sección
        const lineasTexto = textoTotal.split('\n');
        seccionesEncontradas = lineasTexto.filter(linea => 
          linea.includes('Consumos') || linea.includes('CONSUMOS')
        ).slice(0, 10); // Primeras 10 líneas con "Consumos"

        // Procesar secciones
        const juanResult = extraerConsumosConTotal(
          textoTotal,
          'Consumos J Fernandez Tubello',
          'TOTAL CONSUMOS DE J FERNANDEZ TUBELLO',
          'TOTAL CONSUMOS DE CAMILA V MONTIEL' // Total de la otra sección
        );
        
        const camiResult = extraerConsumosConTotal(
          textoTotal,
          'Consumos Camila V Montiel',
          'TOTAL CONSUMOS DE CAMILA V MONTIEL',
          'TOTAL CONSUMOS DE J FERNANDEZ TUBELLO' // Total de la otra sección
        );
        
        const impuestosResult = extraerImpuestos(textoTotal);

        // Parsear totales a centavos
        const juanTotalPesosCents = juanResult.total.pesos ? parseAmountToCents(juanResult.total.pesos) : 0;
        const juanTotalDolaresCents = juanResult.total.dolares ? parseAmountToCents(juanResult.total.dolares) : 0;
        const camiTotalPesosCents = camiResult.total.pesos ? parseAmountToCents(camiResult.total.pesos) : 0;
        const camiTotalDolaresCents = camiResult.total.dolares ? parseAmountToCents(camiResult.total.dolares) : 0;
        const totalPesosCents = impuestosResult.total.pesos ? parseAmountToCents(impuestosResult.total.pesos) : 0;
        const totalDolaresCents = impuestosResult.total.dolares ? parseAmountToCents(impuestosResult.total.dolares) : 0;

        // Calcular totales consolidados
        const totalAmountArsCents = juanTotalPesosCents + camiTotalPesosCents;
        const totalAmountUsdCents = juanTotalDolaresCents + camiTotalDolaresCents;
        
        // Calcular conversion_amount (dólar tarjeta efectivo)
        let conversionAmountData = null;
        let conversionAmountCents = 0;
        
        if (archivoInfo.cardType === 'VISA') {
          // Para VISA, calcular el conversion_amount
          conversionAmountData = calcularConversionAmount(textoTotal);
          conversionAmountCents = conversionAmountData 
            ? conversionAmountData.conversion_amount_cents 
            : 0;
          
          // Guardar para usar en MASTERCARD
          visaConversionAmount = conversionAmountData ? conversionAmountData.conversion_amount : null;
          visaConversionAmountData = conversionAmountData;
        } else if (archivoInfo.cardType === 'MASTERCARD') {
          // Para MASTERCARD, usar el conversion_amount de VISA si existe
          if (visaConversionAmount !== null) {
            conversionAmountCents = Math.round(visaConversionAmount * 100);
            conversionAmountData = {
              conversion_amount: visaConversionAmount,
              conversion_amount_cents: conversionAmountCents,
              debug_info: visaConversionAmountData ? visaConversionAmountData.debug_info : null
            };
          } else {
            // Si no hay VISA, intentar leer el archivo .txt
            const txtFileName = `MASTERCARD_${String(archivoInfo.month).padStart(2, '0')}_${archivoInfo.year}_USD.txt`;
            const txtFilePath = path.join(RESUMES_DIR, txtFileName);
            
            if (fs.existsSync(txtFilePath)) {
              try {
                const txtContent = fs.readFileSync(txtFilePath, 'utf-8').trim();
                const conversionAmountFromFile = parseFloat(txtContent);
                
                if (!isNaN(conversionAmountFromFile)) {
                  conversionAmountCents = Math.round(conversionAmountFromFile * 100);
                  conversionAmountData = {
                    conversion_amount: conversionAmountFromFile,
                    conversion_amount_cents: conversionAmountCents,
                    debug_info: {
                      total_usd: null,
                      base_pesos: null,
                      fx_base: null,
                      factor_impuestos: null,
                      conversion_amount: conversionAmountFromFile,
                      source: 'txt_file'
                    }
                  };
                  console.log(`📄 Usando conversion_amount desde archivo: ${txtFileName} = ${conversionAmountFromFile}`);
                } else {
                  console.warn(`⚠️  Valor inválido en ${txtFileName}: ${txtContent}`);
                }
              } catch (err) {
                console.error(`❌ Error leyendo ${txtFileName}:`, err.message);
              }
            } else {
              console.warn(`⚠️  No se encontró VISA ni archivo ${txtFileName} para MASTERCARD`);
            }
          }
        }

        // Construir items
        const items = [];
        let position = 1;

        // Items de Juan
        for (const detalle of juanResult.detalles) {
          const isUSD = detalle.isUSD || false;
          const amountCents = parseAmountToCents(detalle.importe);
          const isCuota = detalle.descripcion.includes('C.') ? 1 : 0;
          
          // Si es USD, calcular amount_ars multiplicando por conversion_amount
          let amountArsCents = 0;
          let amountArs = 0;
          if (isUSD && conversionAmountData) {
            const amountUsd = amountCents / 100;
            const amountArsCalculated = amountUsd * conversionAmountData.conversion_amount;
            amountArsCents = Math.round(amountArsCalculated * 100);
            amountArs = amountArsCents / 100;
          } else if (!isUSD) {
            amountArsCents = amountCents;
            amountArs = amountCents / 100;
          }
          
          items.push({
            position: position++,
            amount_ars: amountArs,
            amount_ars_cents: amountArsCents,
            amount_usd: isUSD ? amountCents / 100 : 0,
            amount_usd_cents: isUSD ? amountCents : 0,
            holder: 'Juan',
            description: detalle.descripcion,
            is_cuota: isCuota,
            date_string: detalle.fecha,
            datetime: detalle.fechaTimestamp
          });
        }

        // Items de Cami
        for (const detalle of camiResult.detalles) {
          const isUSD = detalle.isUSD || false;
          const amountCents = parseAmountToCents(detalle.importe);
          const isCuota = detalle.descripcion.includes('C.') ? 1 : 0;
          
          // Si es USD, calcular amount_ars multiplicando por conversion_amount
          let amountArsCents = 0;
          let amountArs = 0;
          if (isUSD && conversionAmountData) {
            const amountUsd = amountCents / 100;
            const amountArsCalculated = amountUsd * conversionAmountData.conversion_amount;
            amountArsCents = Math.round(amountArsCalculated * 100);
            amountArs = amountArsCents / 100;
          } else if (!isUSD) {
            amountArsCents = amountCents;
            amountArs = amountCents / 100;
          }
          
          items.push({
            position: position++,
            amount_ars: amountArs,
            amount_ars_cents: amountArsCents,
            amount_usd: isUSD ? amountCents / 100 : 0,
            amount_usd_cents: isUSD ? amountCents : 0,
            holder: 'Cami',
            description: detalle.descripcion,
            is_cuota: isCuota,
            date_string: detalle.fecha,
            datetime: detalle.fechaTimestamp
          });
        }

        // Items de impuestos
        for (const detalle of impuestosResult.detalles) {
          const amountArsCents = parseAmountToCents(detalle.importe);
          
          items.push({
            position: position++,
            amount_ars: amountArsCents / 100,
            amount_ars_cents: amountArsCents,
            amount_usd: 0,
            amount_usd_cents: 0,
            holder: 'System',
            description: detalle.descripcion,
            is_cuota: 0,
            date_string: detalle.fecha,
            datetime: detalle.fechaTimestamp
          });
        }

        // Calcular amount_total_ars: total en pesos (con impuestos) + dólares convertidos a pesos
        // total_amount_ars ya incluye los impuestos sobre consumos en pesos (3.639.318,49)
        // Necesitamos sumar: total_amount_ars + (amount_usd * conversion_amount)
        const conversionAmount = conversionAmountData ? conversionAmountData.conversion_amount : 0;
        const amountTotalArs = (totalPesosCents / 100) + ((totalAmountUsdCents / 100) * conversionAmount);
        const amountTotalArsCents = Math.round(amountTotalArs * 100);

        // Construir statement (cabecera) - limpiado y con campos que matchean la BD
        const now = new Date().toISOString();
        const debugInfo = conversionAmountData && conversionAmountData.debug_info ? conversionAmountData.debug_info : null;
        
        const statement = {
          uuid,
          year: archivoInfo.year,
          month: archivoInfo.month,
          card_type: archivoInfo.cardType,
          filename: pdfFile,
          amount_ars: totalAmountArsCents / 100,
          amount_ars_cents: totalAmountArsCents,
          amount_usd: totalAmountUsdCents / 100,
          amount_usd_cents: totalAmountUsdCents,
          conversion_amount: conversionAmount,
          conversion_amount_cents: conversionAmountCents,
          total_amount_ars: totalPesosCents / 100,
          total_amount_ars_cents: totalPesosCents,
          amount_total_ars: amountTotalArs,
          amount_total_ars_cents: amountTotalArsCents,
          datetime: now,
          // Campos de debug del cálculo del dólar tarjeta (directamente en el statement, no en objeto anidado)
          total_usd: debugInfo ? debugInfo.total_usd : null,
          base_pesos: debugInfo ? debugInfo.base_pesos : null,
          fx_base: debugInfo ? debugInfo.fx_base : null,
          factor_impuestos: debugInfo ? debugInfo.factor_impuestos : null
        };


        // Verificar si el UUID ya existe en la base de datos
        const checkStmt = prepare('SELECT UUID FROM CARD_STATEMENTS WHERE UUID = ?');
        const existing = await checkStmt.get(uuid);
        await checkStmt.finalize();

        if (existing) {
          // Si ya existe, solo agregar a resultados sin insertar
          console.log(`⚠️  UUID ${uuid} ya existe en la base de datos, omitiendo inserción`);
          resultados.push({
            statement,
            items,
            skipped: true,
            reason: 'UUID ya existe en la base de datos'
          });
        } else {
          // Insertar en CARD_STATEMENTS
          const insertStatementStmt = prepare(`
            INSERT INTO CARD_STATEMENTS (
              UUID, YEAR, MONTH, CARD_TYPE, FILENAME,
              AMOUNT_ARS, AMOUNT_USD, CONVERSION_AMOUNT, TOTAL_AMOUNT_ARS, AMOUNT_TOTAL_ARS,
              DATETIME, TOTAL_USD, BASE_PESOS, FX_BASE, FACTOR_IMPUESTOS
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          try {
            await insertStatementStmt.run(
              statement.uuid,
              statement.year,
              statement.month,
              statement.card_type,
              statement.filename,
              statement.amount_ars_cents,
              statement.amount_usd_cents,
              conversionAmountCents,
              statement.total_amount_ars_cents,
              statement.amount_total_ars_cents,
              statement.datetime,
              statement.total_usd,
              statement.base_pesos,
              statement.fx_base,
              statement.factor_impuestos
            );
            await insertStatementStmt.finalize();
            console.log(`✅ Insertado statement: ${uuid}`);

            // Insertar items en CARD_STATEMENT_ITEMS
            const insertItemStmt = prepare(`
              INSERT INTO CARD_STATEMENT_ITEMS (
                UUID, POSITION, AMOUNT_ARS, AMOUNT_USD, HOLDER,
                DESCRIPTION, IS_CUOTA, DATE_STRING, DATETIME
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            let itemsInserted = 0;
            for (const item of items) {
              try {
                await insertItemStmt.run(
                  uuid,
                  item.position,
                  item.amount_ars_cents,
                  item.amount_usd_cents,
                  item.holder,
                  item.description,
                  item.is_cuota,
                  item.date_string,
                  item.datetime
                );
                itemsInserted++;
              } catch (err) {
                console.error(`❌ Error insertando item ${item.position} para ${uuid}:`, err.message);
              }
            }
            await insertItemStmt.finalize();
            console.log(`✅ Insertados ${itemsInserted} items para ${uuid}`);

            resultados.push({
              statement,
              items,
              inserted: true,
              items_count: itemsInserted
            });
          } catch (err) {
            await insertStatementStmt.finalize();
            console.error(`❌ Error insertando statement ${uuid}:`, err.message);
            resultados.push({
              statement,
              items,
              error: err.message,
              inserted: false
            });
          }
        }
      } catch (error) {
        console.error(`Error procesando ${pdfFile}:`, error);
        resultados.push({
          filename: pdfFile,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: 'Resúmenes procesados',
      total: resultados.length,
      resumes: resultados
    });
  } catch (error) {
    console.error('Error en POST /resumes/syncResumes:', error);
    res.status(500).json({
      error: {
        code: 'ERROR_SYNC_RESUMES',
        message: 'Error al procesar los resúmenes',
        details: error.message
      }
    });
  }
});

/**
 * GET /resumes/test
 * Endpoint de prueba que procesa todos los PDFs del directorio resumes/
 * Tiene el mismo comportamiento que /syncResumes pero NO inserta en la base de datos
 * Solo devuelve lo que debería insertar
 */
router.get('/test', async (req, res) => {
  // Este es el endpoint de prueba - agregar debug aquí
  try {
    // Verificar que el directorio existe
    if (!fs.existsSync(RESUMES_DIR)) {
      fs.mkdirSync(RESUMES_DIR, { recursive: true });
    }

    // Buscar archivos PDF en el directorio
    const archivos = fs.readdirSync(RESUMES_DIR);
    const pdfs = archivos.filter(archivo => 
      archivo.toLowerCase().endsWith('.pdf') && 
      (archivo.startsWith('VISA_') || archivo.startsWith('MASTERCARD_'))
    );

    console.log(`📁 Archivos encontrados en ${RESUMES_DIR}:`, archivos);
    console.log(`📄 PDFs encontrados: ${pdfs.length}`, pdfs);

    if (pdfs.length === 0) {
      return res.json({
        success: true,
        message: 'No se encontraron PDFs en el directorio resumes/',
        total: 0,
        resumes: [],
        debug: {
          allFiles: archivos,
          pdfsFound: []
        }
      });
    }

    const resultados = [];
    
    // Separar PDFs por tipo y ordenar: VISA primero, luego MASTERCARD
    const visaPdfs = pdfs.filter(p => p.startsWith('VISA_'));
    const mastercardPdfs = pdfs.filter(p => p.startsWith('MASTERCARD_'));
    const sortedPdfs = [...visaPdfs, ...mastercardPdfs];
    
    console.log(`🔄 Procesando ${sortedPdfs.length} PDFs:`, sortedPdfs);
    
    // Variable para guardar el conversion_amount de VISA
    let visaConversionAmount = null;
    let visaConversionAmountData = null;

    // Procesar cada PDF
    for (const pdfFile of sortedPdfs) {
      try {
        const pdfPath = path.join(RESUMES_DIR, pdfFile);
        const pdfBuffer = fs.readFileSync(pdfPath);
        
        // Generar UUID basado en el hash del contenido
        const uuid = generarUUIDDesdeHash(pdfBuffer);

        // Extraer información del nombre del archivo
        const archivoInfo = extraerInfoDelArchivo(pdfFile);
        if (!archivoInfo) {
          throw new Error(`Formato de archivo no válido: ${pdfFile}. Se espera VISA_MM_YYYY.pdf o MASTERCARD_MM_YYYY.pdf`);
        }

        // Extraer texto del PDF
        const data = await pdf(pdfBuffer);
        const textoTotal = data.text;

        // Debug: buscar si existen las secciones esperadas (solo en endpoint de prueba)
        let tieneSeccionJuan, tieneSeccionCami, tieneImpuestos, seccionesEncontradas;
        // Estas variables se definirán solo en el endpoint /test
        tieneSeccionJuan = textoTotal.includes('Consumos J Fernandez Tubello') || 
                            textoTotal.includes('Consumos J Fernandez') ||
                            textoTotal.includes('J Fernandez');
        tieneSeccionCami = textoTotal.includes('Consumos Camila V Montiel') || 
                           textoTotal.includes('Consumos Camila') ||
                           textoTotal.includes('Camila V Montiel');
        tieneImpuestos = textoTotal.includes('Impuestos, cargos e intereses');
        
        // Buscar variaciones de los nombres de sección
        const lineasTexto = textoTotal.split('\n');
        seccionesEncontradas = lineasTexto.filter(linea => 
          linea.includes('Consumos') || linea.includes('CONSUMOS')
        ).slice(0, 10); // Primeras 10 líneas con "Consumos"

        // Procesar secciones
        const juanResult = extraerConsumosConTotal(
          textoTotal,
          'Consumos J Fernandez Tubello',
          'TOTAL CONSUMOS DE J FERNANDEZ TUBELLO',
          'TOTAL CONSUMOS DE CAMILA V MONTIEL' // Total de la otra sección
        );
        
        const camiResult = extraerConsumosConTotal(
          textoTotal,
          'Consumos Camila V Montiel',
          'TOTAL CONSUMOS DE CAMILA V MONTIEL',
          'TOTAL CONSUMOS DE J FERNANDEZ TUBELLO' // Total de la otra sección
        );
        
        const impuestosResult = extraerImpuestos(textoTotal);

        // Parsear totales a centavos
        const juanTotalPesosCents = juanResult.total.pesos ? parseAmountToCents(juanResult.total.pesos) : 0;
        const juanTotalDolaresCents = juanResult.total.dolares ? parseAmountToCents(juanResult.total.dolares) : 0;
        const camiTotalPesosCents = camiResult.total.pesos ? parseAmountToCents(camiResult.total.pesos) : 0;
        const camiTotalDolaresCents = camiResult.total.dolares ? parseAmountToCents(camiResult.total.dolares) : 0;
        const totalPesosCents = impuestosResult.total.pesos ? parseAmountToCents(impuestosResult.total.pesos) : 0;
        const totalDolaresCents = impuestosResult.total.dolares ? parseAmountToCents(impuestosResult.total.dolares) : 0;

        // Calcular totales consolidados
        const totalAmountArsCents = juanTotalPesosCents + camiTotalPesosCents;
        const totalAmountUsdCents = juanTotalDolaresCents + camiTotalDolaresCents;
        
        // Calcular conversion_amount (dólar tarjeta efectivo)
        let conversionAmountData = null;
        let conversionAmountCents = 0;
        
        if (archivoInfo.cardType === 'VISA') {
          // Para VISA, calcular el conversion_amount
          conversionAmountData = calcularConversionAmount(textoTotal);
          conversionAmountCents = conversionAmountData 
            ? conversionAmountData.conversion_amount_cents 
            : 0;
          
          // Guardar para usar en MASTERCARD
          visaConversionAmount = conversionAmountData ? conversionAmountData.conversion_amount : null;
          visaConversionAmountData = conversionAmountData;
        } else if (archivoInfo.cardType === 'MASTERCARD') {
          // Para MASTERCARD, usar el conversion_amount de VISA si existe
          if (visaConversionAmount !== null) {
            conversionAmountCents = Math.round(visaConversionAmount * 100);
            conversionAmountData = {
              conversion_amount: visaConversionAmount,
              conversion_amount_cents: conversionAmountCents,
              debug_info: visaConversionAmountData ? visaConversionAmountData.debug_info : null
            };
          } else {
            // Si no hay VISA, intentar leer el archivo .txt
            const txtFileName = `MASTERCARD_${String(archivoInfo.month).padStart(2, '0')}_${archivoInfo.year}_USD.txt`;
            const txtFilePath = path.join(RESUMES_DIR, txtFileName);
            
            if (fs.existsSync(txtFilePath)) {
              try {
                const txtContent = fs.readFileSync(txtFilePath, 'utf-8').trim();
                const conversionAmountFromFile = parseFloat(txtContent);
                
                if (!isNaN(conversionAmountFromFile)) {
                  conversionAmountCents = Math.round(conversionAmountFromFile * 100);
                  conversionAmountData = {
                    conversion_amount: conversionAmountFromFile,
                    conversion_amount_cents: conversionAmountCents,
                    debug_info: {
                      total_usd: null,
                      base_pesos: null,
                      fx_base: null,
                      factor_impuestos: null,
                      conversion_amount: conversionAmountFromFile,
                      source: 'txt_file'
                    }
                  };
                  console.log(`📄 Usando conversion_amount desde archivo: ${txtFileName} = ${conversionAmountFromFile}`);
                } else {
                  console.warn(`⚠️  Valor inválido en ${txtFileName}: ${txtContent}`);
                }
              } catch (err) {
                console.error(`❌ Error leyendo ${txtFileName}:`, err.message);
              }
            } else {
              console.warn(`⚠️  No se encontró VISA ni archivo ${txtFileName} para MASTERCARD`);
            }
          }
        }

        // Construir items
        const items = [];
        let position = 1;

        // Items de Juan
        for (const detalle of juanResult.detalles) {
          const isUSD = detalle.isUSD || false;
          const amountCents = parseAmountToCents(detalle.importe);
          const isCuota = detalle.descripcion.includes('C.') ? 1 : 0;
          
          // Si es USD, calcular amount_ars multiplicando por conversion_amount
          let amountArsCents = 0;
          let amountArs = 0;
          if (isUSD && conversionAmountData) {
            const amountUsd = amountCents / 100;
            const amountArsCalculated = amountUsd * conversionAmountData.conversion_amount;
            amountArsCents = Math.round(amountArsCalculated * 100);
            amountArs = amountArsCents / 100;
          } else if (!isUSD) {
            amountArsCents = amountCents;
            amountArs = amountCents / 100;
          }
          
          items.push({
            position: position++,
            amount_ars: amountArs,
            amount_ars_cents: amountArsCents,
            amount_usd: isUSD ? amountCents / 100 : 0,
            amount_usd_cents: isUSD ? amountCents : 0,
            holder: 'Juan',
            description: detalle.descripcion,
            is_cuota: isCuota,
            date_string: detalle.fecha,
            datetime: detalle.fechaTimestamp
          });
        }

        // Items de Cami
        for (const detalle of camiResult.detalles) {
          const isUSD = detalle.isUSD || false;
          const amountCents = parseAmountToCents(detalle.importe);
          const isCuota = detalle.descripcion.includes('C.') ? 1 : 0;
          
          // Si es USD, calcular amount_ars multiplicando por conversion_amount
          let amountArsCents = 0;
          let amountArs = 0;
          if (isUSD && conversionAmountData) {
            const amountUsd = amountCents / 100;
            const amountArsCalculated = amountUsd * conversionAmountData.conversion_amount;
            amountArsCents = Math.round(amountArsCalculated * 100);
            amountArs = amountArsCents / 100;
          } else if (!isUSD) {
            amountArsCents = amountCents;
            amountArs = amountCents / 100;
          }
          
          items.push({
            position: position++,
            amount_ars: amountArs,
            amount_ars_cents: amountArsCents,
            amount_usd: isUSD ? amountCents / 100 : 0,
            amount_usd_cents: isUSD ? amountCents : 0,
            holder: 'Cami',
            description: detalle.descripcion,
            is_cuota: isCuota,
            date_string: detalle.fecha,
            datetime: detalle.fechaTimestamp
          });
        }

        // Items de impuestos
        for (const detalle of impuestosResult.detalles) {
          const amountArsCents = parseAmountToCents(detalle.importe);
          
          items.push({
            position: position++,
            amount_ars: amountArsCents / 100,
            amount_ars_cents: amountArsCents,
            amount_usd: 0,
            amount_usd_cents: 0,
            holder: 'System',
            description: detalle.descripcion,
            is_cuota: 0,
            date_string: detalle.fecha,
            datetime: detalle.fechaTimestamp
          });
        }

        // Calcular amount_total_ars: total en pesos (con impuestos) + dólares convertidos a pesos
        const conversionAmount = conversionAmountData ? conversionAmountData.conversion_amount : 0;
        const amountTotalArs = (totalPesosCents / 100) + ((totalAmountUsdCents / 100) * conversionAmount);
        const amountTotalArsCents = Math.round(amountTotalArs * 100);

        // Construir statement (cabecera) - limpiado y con campos que matchean la BD
        const now = new Date().toISOString();
        const debugInfo = conversionAmountData && conversionAmountData.debug_info ? conversionAmountData.debug_info : null;
        
        const statement = {
          uuid,
          year: archivoInfo.year,
          month: archivoInfo.month,
          card_type: archivoInfo.cardType,
          filename: pdfFile,
          amount_ars: totalAmountArsCents / 100,
          amount_ars_cents: totalAmountArsCents,
          amount_usd: totalAmountUsdCents / 100,
          amount_usd_cents: totalAmountUsdCents,
          conversion_amount: conversionAmount,
          conversion_amount_cents: conversionAmountCents,
          total_amount_ars: totalPesosCents / 100,
          total_amount_ars_cents: totalPesosCents,
          amount_total_ars: amountTotalArs,
          amount_total_ars_cents: amountTotalArsCents,
          datetime: now,
          // Campos de debug del cálculo del dólar tarjeta
          total_usd: debugInfo ? debugInfo.total_usd : null,
          base_pesos: debugInfo ? debugInfo.base_pesos : null,
          fx_base: debugInfo ? debugInfo.fx_base : null,
          factor_impuestos: debugInfo ? debugInfo.factor_impuestos : null
        };

        // NO INSERTAR EN BD - Solo agregar a resultados
        const resultadoItem = {
          statement,
          items,
          items_count: items.length,
          pdf_text_preview: textoTotal.substring(0, 500) + (textoTotal.length > 500 ? '...' : ''),
          pdf_text_length: textoTotal.length
        };
        
        // Agregar debug solo si las variables están definidas (endpoint de prueba)
        if (typeof tieneSeccionJuan !== 'undefined') {
          resultadoItem.debug = {
            tieneSeccionJuan,
            tieneSeccionCami,
            tieneImpuestos,
            seccionesEncontradas,
            juanDetallesCount: juanResult.detalles.length,
            camiDetallesCount: camiResult.detalles.length,
            impuestosDetallesCount: impuestosResult.detalles.length,
            juanTotal: juanResult.total,
            camiTotal: camiResult.total,
            impuestosTotal: impuestosResult.total
          };
        }
        
        resultados.push(resultadoItem);
      } catch (error) {
        console.error(`Error procesando ${pdfFile}:`, error);
        resultados.push({
          filename: pdfFile,
          error: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
      }
    }

    res.json({
      success: true,
      message: 'Resúmenes procesados (sin insertar en BD)',
      total: resultados.length,
      resumes: resultados,
      debug: {
        pdfsFound: pdfs.length,
        pdfsProcessed: resultados.filter(r => !r.error).length,
        pdfsWithErrors: resultados.filter(r => r.error).length,
        pdfsList: pdfs,
        sortedPdfs: sortedPdfs
      }
    });
  } catch (error) {
    console.error('Error en GET /resumes/test:', error);
    res.status(500).json({
      error: {
        code: 'ERROR_TEST_RESUMES',
        message: 'Error al procesar los resúmenes de prueba',
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }
    });
  }
});

export default router;
