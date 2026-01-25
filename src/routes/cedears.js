import express from 'express';
import { prepare } from '../db/index.js';

const router = express.Router();

/**
 * GET /cedears/spy
 * Obtiene la cotización de SPY (SPDR S&P 500) desde Portfolio Personal
 * Consulta la API solo una vez por día, luego devuelve datos de la BD
 */
router.get('/spy', async (req, res) => {
  try {
    // Obtener fecha actual en formato YYYY-MM-DD
    const today = new Date().toISOString().split('T')[0];

    // Verificar si ya tenemos datos del día de hoy en la BD
    const checkStmt = prepare(`
      SELECT DATA, DATETIME
      FROM CEDEAR_QUOTES
      WHERE TICKER = 'SPY' AND DATE = ?
    `);

    const existing = await checkStmt.get(today);
    await checkStmt.finalize();

    // Si ya tenemos datos del día de hoy, devolverlos
    if (existing) {
      console.log(`✅ Cotización de SPY encontrada en BD para ${today}`);
      const spyData = JSON.parse(existing.DATA);
      return res.json(spyData);
    }

    // Si no hay datos del día, consultar la API
    const url = 'https://www.portfoliopersonal.com/Cotizaciones/Cedears';

    console.log(`🔗 Consultando cotización de SPY desde Portfolio Personal (no hay datos del día ${today} en BD)...`);

    // Hacer petición a Portfolio Personal
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/html, */*',
        'User-Agent': 'Finance-App-Backend/1.0'
      },
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: {
          code: 'PPI_API_ERROR',
          message: `Error al consultar Portfolio Personal: ${response.status} ${response.statusText}`
        }
      });
    }

    // Obtener el texto de la respuesta
    const html = await response.text();

    // Buscar el objeto JSON que contiene los datos de los CEDEARs
    // El JSON suele estar en un script tag o como variable JavaScript
    let spyData = null;

    // Método 1: Buscar arrays JSON completos en el HTML
    // Los arrays suelen estar en variables JavaScript o directamente en el HTML
    const arrayPatterns = [
      // Patrón para array completo: [{"item":...,"ticker":...},...]
      /(\[[\s]*\{[^\[\]]*"ticker"[^\[\]]*\}[^\]]*\])/g,
      // Patrón para var data = [...]
      /var\s+\w+\s*=\s*(\[[^\]]+\])/g,
      // Patrón para window.data = [...]
      /window\.\w+\s*=\s*(\[[^\]]+\])/g,
      // Patrón para const/let data = [...]
      /(?:const|let)\s+\w+\s*=\s*(\[[^\]]+\])/g
    ];

    for (const pattern of arrayPatterns) {
      const matches = [...html.matchAll(pattern)];
      for (const match of matches) {
        try {
          // Obtener el array JSON (puede estar en diferentes grupos del match)
          let jsonStr = match[1] || match[0];
          
          // Limpiar si tiene var/const/let/window
          jsonStr = jsonStr.replace(/^(var|const|let)\s+\w+\s*=\s*/, '');
          jsonStr = jsonStr.replace(/^window\.\w+\s*=\s*/, '');
          
          // Parsear el array
          const data = JSON.parse(jsonStr);
          
          if (Array.isArray(data)) {
            // Buscar SPY en el array
            spyData = data.find(item => item && item.ticker === 'SPY');
            if (spyData) {
              console.log(`✅ SPY encontrado en array JSON`);
              break;
            }
          }
        } catch (e) {
          // Continuar con el siguiente match
          continue;
        }
      }
      if (spyData) break;
    }

    // Método 2: Si no se encontró en arrays, buscar el objeto individual de SPY
    if (!spyData) {
      // Buscar el objeto que contiene "ticker":"SPY"
      const spyIndex = html.indexOf('"ticker":"SPY"');
      
      if (spyIndex !== -1) {
        // Buscar hacia atrás para encontrar el inicio del objeto {
        let objStart = spyIndex;
        let foundStart = false;
        while (objStart > 0 && objStart > spyIndex - 2000) { // Buscar hasta 2000 caracteres atrás
          if (html[objStart] === '{') {
            foundStart = true;
            break;
          }
          objStart--;
        }
        
        if (foundStart) {
          // Buscar hacia adelante para encontrar el final del objeto }
          let objEnd = objStart;
          let braceCount = 0;
          let inString = false;
          let escapeNext = false;
          
          while (objEnd < html.length && objEnd < objStart + 5000) { // Buscar hasta 5000 caracteres adelante
            const char = html[objEnd];
            
            if (escapeNext) {
              escapeNext = false;
              objEnd++;
              continue;
            }
            
            if (char === '\\') {
              escapeNext = true;
              objEnd++;
              continue;
            }
            
            if (char === '"' && !escapeNext) {
              inString = !inString;
            }
            
            if (!inString) {
              if (char === '{') {
                braceCount++;
              } else if (char === '}') {
                braceCount--;
                if (braceCount === 0) {
                  objEnd++;
                  break;
                }
              }
            }
            
            objEnd++;
          }
          
          if (braceCount === 0 && objEnd > objStart) {
            try {
              const jsonStr = html.substring(objStart, objEnd);
              spyData = JSON.parse(jsonStr);
              if (spyData.ticker === 'SPY') {
                console.log(`✅ SPY encontrado como objeto individual`);
              } else {
                spyData = null;
              }
            } catch (e) {
              // Fallar silenciosamente
            }
          }
        }
      }
    }

    if (!spyData) {
      return res.status(404).json({
        error: {
          code: 'SPY_NOT_FOUND',
          message: 'No se pudo encontrar la cotización de SPY en la respuesta de Portfolio Personal'
        }
      });
    }

    console.log(`✅ Cotización de SPY obtenida exitosamente`);

    // Guardar en la base de datos
    const datetime = new Date().toISOString();
    const insertStmt = prepare(`
      INSERT OR REPLACE INTO CEDEAR_QUOTES (TICKER, DATE, DATA, DATETIME)
      VALUES (?, ?, ?, ?)
    `);

    await insertStmt.run(
      'SPY',
      today,
      JSON.stringify(spyData),
      datetime
    );
    await insertStmt.finalize();

    console.log(`💾 Cotización de SPY guardada en BD para ${today}`);

    res.json(spyData);

  } catch (error) {
    console.error('❌ Error obteniendo cotización de SPY:', error);

    // Manejar errores de timeout
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return res.status(504).json({
        error: {
          code: 'TIMEOUT',
          message: 'Timeout al consultar Portfolio Personal (más de 30 segundos)'
        }
      });
    }

    // Manejar errores de red
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: {
          code: 'NETWORK_ERROR',
          message: 'Error de conexión con Portfolio Personal',
          details: error.message
        }
      });
    }

    // Error genérico
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Error al obtener la cotización de SPY',
        details: error.message
      }
    });
  }
});

export default router;
