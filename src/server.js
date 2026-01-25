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

// Middleware CORS - Permitir todas las solicitudes desde el frontend
app.use((req, res, next) => {
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
app.use(express.json());

// Middleware de logging simple
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
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

// Middleware de manejo de errores
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Error interno del servidor',
      details: err.message
    }
  });
});

// Middleware para rutas no encontradas
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Ruta no encontrada'
    }
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
  console.log(`Base de datos: ${process.env.DB_PATH || './data/finance.db'}`);
});

// Manejo de cierre graceful
const closeDb = () => {
  return new Promise((resolve) => {
    db.close((err) => {
      if (err) {
        console.error('Error cerrando base de datos:', err);
      } else {
        console.log('Base de datos cerrada');
      }
      resolve();
    });
  });
};

process.on('SIGTERM', async () => {
  console.log('SIGTERM recibido, cerrando servidor...');
  await closeDb();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT recibido, cerrando servidor...');
  await closeDb();
  process.exit(0);
});
