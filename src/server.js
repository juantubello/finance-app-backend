import './load-env.js';
import express from 'express';
import db from './db/index.js';

// Importar rutas
import transactionsRouter from './routes/transactions.js';
import dashboardRouter from './routes/dashboard.js';
import annualRouter from './routes/annual.js';
import liquidityRouter from './routes/liquidity.js';
import evolutionRouter from './routes/evolution.js';
import cardsRouter from './routes/cards.js';
import testRouter from './routes/test.js';
import syncRouter from './routes/sync.js';
import expensesRouter from './routes/expenses.js';
import incomeRouter from './routes/income.js';
import savingsRouter from './routes/savings.js';
import resumesRouter from './routes/resumes.js';
import patrimonioRouter from './routes/patrimonio.js';
import cedearsRouter from './routes/cedears.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware CORS mejorado - Asegurar headers siempre, incluso en errores
app.use((req, res, next) => {
  // Guardar función original de json para asegurar headers CORS
  const originalJson = res.json.bind(res);
  res.json = function(body) {
    // Asegurar headers CORS antes de enviar respuesta
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    return originalJson(body);
  };

  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // Manejar preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// Middleware para parsear JSON
app.use(express.json({ limit: '10mb' }));

// Middleware de timeout para peticiones (30 segundos)
app.use((req, res, next) => {
  // Asegurar headers CORS en timeout también
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      res.status(504).json({
        error: {
          code: 'TIMEOUT',
          message: 'La petición excedió el tiempo máximo de espera'
        }
      });
    }
  }, 30000); // 30 segundos

  // Limpiar timeout cuando la respuesta se envía
  const originalEnd = res.end;
  res.end = function(...args) {
    clearTimeout(timeout);
    originalEnd.apply(this, args);
  };

  // Manejar errores de conexión cerrada
  req.on('close', () => {
    clearTimeout(timeout);
  });

  next();
});

// Middleware de logging mejorado con tracking de peticiones activas
let activeRequests = 0;
let maxConcurrentRequests = 0;

app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  activeRequests++;
  maxConcurrentRequests = Math.max(maxConcurrentRequests, activeRequests);
  
  // Log si hay muchas peticiones concurrentes
  if (activeRequests > 50) {
    console.warn(`⚠️  Alto número de peticiones concurrentes: ${activeRequests}`);
  }
  
  console.log(`[${timestamp}] ${req.method} ${req.path} [Activas: ${activeRequests}]`);
  
  // Limpiar contador cuando la respuesta termina (solo una vez)
  let decremented = false;
  const decrementCounter = () => {
    if (!decremented) {
      decremented = true;
      activeRequests = Math.max(0, activeRequests - 1); // Evitar números negativos
    }
  };
  
  res.once('finish', decrementCounter);
  res.once('close', decrementCounter);
  
  next();
});

// Health check mejorado
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    active_requests: activeRequests,
    max_concurrent_requests: maxConcurrentRequests,
    timestamp: new Date().toISOString()
  });
});

// Rutas
app.use('/transactions', transactionsRouter);
app.use('/dashboard', dashboardRouter);
app.use('/annual', annualRouter);
app.use('/liquidity', liquidityRouter);
app.use('/evolution', evolutionRouter);
app.use('/cards', cardsRouter);
app.use('/test', testRouter);
app.use('/sync', syncRouter);
app.use('/expenses', expensesRouter);
app.use('/income', incomeRouter);
app.use('/savings', savingsRouter);
app.use('/resumes', resumesRouter);
app.use('/patrimonio', patrimonioRouter);
app.use('/cedears', cedearsRouter);

// Middleware de manejo de errores mejorado
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  
  // Si la respuesta ya fue enviada, solo loguear el error
  if (res.headersSent) {
    return next(err);
  }
  
  // Asegurar headers CORS incluso en errores
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // Determinar código de estado apropiado
  const statusCode = err.statusCode || err.status || 500;
  
  res.status(statusCode).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'Error interno del servidor',
      details: process.env.NODE_ENV === 'development' ? err.stack : err.message
    }
  });
});

// Middleware para rutas no encontradas
app.use((req, res) => {
  // Asegurar headers CORS
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Ruta no encontrada'
    }
  });
});

// Iniciar servidor con configuración mejorada para conexiones concurrentes
const server = app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
  console.log(`Base de datos: ${process.env.DB_PATH || './data/finance.db'}`);
});

// Configurar límites de conexiones para evitar agotamiento de recursos
server.maxConnections = 100; // Límite de conexiones simultáneas
server.keepAliveTimeout = 65000; // 65 segundos (mayor que timeout de petición)
server.headersTimeout = 66000; // 66 segundos (mayor que keepAliveTimeout)

// Manejar errores del servidor
server.on('error', (err) => {
  console.error('Error del servidor:', err);
});

server.on('clientError', (err, socket) => {
  console.error('Error de cliente:', err.message);
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

// Manejo de cierre graceful
const gracefulShutdown = async () => {
  console.log('Iniciando cierre graceful...');
  
  // Cerrar servidor (deja de aceptar nuevas conexiones)
  return new Promise((resolve) => {
    server.close(() => {
      console.log('Servidor HTTP cerrado');
      
      // Cerrar base de datos
      db.close((err) => {
        if (err) {
          console.error('Error cerrando base de datos:', err);
        } else {
          console.log('Base de datos cerrada');
        }
        resolve();
      });
    });
    
    // Forzar cierre después de 10 segundos
    setTimeout(() => {
      console.log('Forzando cierre...');
      process.exit(1);
    }, 10000);
  });
};

process.on('SIGTERM', async () => {
  console.log('SIGTERM recibido');
  await gracefulShutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT recibido');
  await gracefulShutdown();
  process.exit(0);
});
