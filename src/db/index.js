import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DB_PATH || './data/finance.db';

// Asegurar que el directorio existe
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Crear conexión a la base de datos
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error abriendo base de datos:', err);
    process.exit(1);
  }
  console.log('Conectado a SQLite');
});

// Configurar SQLite para mejor manejo de conexiones
// Habilitar foreign keys
db.run('PRAGMA foreign_keys = ON');
// Optimizar para mejor rendimiento (WAL mode permite mejor concurrencia)
try {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = NORMAL');
} catch (err) {
  // Si WAL no está disponible, continuar con modo por defecto
  console.warn('WAL mode no disponible, usando modo por defecto');
}

// Promisificar métodos
db.runAsync = promisify(db.run.bind(db));
db.getAsync = promisify(db.get.bind(db));
db.allAsync = promisify(db.all.bind(db));
db.execAsync = promisify(db.exec.bind(db));

// Función para agregar columnas si no existen
async function addColumnIfNotExists(tableName, columnName, columnDef) {
  try {
    // Verificar si la tabla existe
    const tableExists = await db.getAsync(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [tableName]
    );
    
    if (!tableExists) {
      return; // La tabla no existe, se creará con el schema
    }
    
    // Verificar si la columna existe
    const tableInfo = await db.allAsync(`PRAGMA table_info(${tableName})`);
    const columnExists = tableInfo.some(col => col.name === columnName);
    
    if (!columnExists) {
      await db.runAsync(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
      console.log(`✅ Columna ${columnName} agregada a ${tableName}`);
    }
  } catch (err) {
    console.warn(`⚠️  Error agregando columna ${columnName} a ${tableName}:`, err.message);
  }
}

// Función para inicializar el schema
export async function initSchema() {
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    
    // Ejecutar el schema
    await db.execAsync(schema);
    
    // Agregar columnas que puedan faltar (migraciones)
    // Nota: Para columnas NOT NULL, necesitamos DEFAULT si la tabla ya tiene datos
    await addColumnIfNotExists('CARD_STATEMENTS', 'FILENAME', 'TEXT DEFAULT ""');
    await addColumnIfNotExists('CARD_STATEMENTS', 'AMOUNT_TOTAL_ARS', 'INTEGER DEFAULT 0');
    await addColumnIfNotExists('CARD_STATEMENTS', 'TOTAL_USD', 'REAL');
    await addColumnIfNotExists('CARD_STATEMENTS', 'BASE_PESOS', 'REAL');
    await addColumnIfNotExists('CARD_STATEMENTS', 'FX_BASE', 'REAL');
    await addColumnIfNotExists('CARD_STATEMENTS', 'FACTOR_IMPUESTOS', 'REAL');
    
    console.log('Schema inicializado correctamente');
  } catch (err) {
    console.error('Error inicializando schema:', err);
    throw err;
  }
}

// Inicializar schema al importar
initSchema().catch(err => {
  console.error('Error fatal inicializando schema:', err);
  process.exit(1);
});

// Helper para prepared statements con auto-finalización mejorada
export function prepare(sql) {
  const stmt = db.prepare(sql);
  let finalized = false;
  
  const safeFinalize = async () => {
    if (!finalized) {
      finalized = true;
      return new Promise((resolve) => {
        stmt.finalize((err) => {
          if (err) {
            console.error('Error finalizando statement:', err);
          }
          resolve();
        });
      });
    }
  };
  
  const statementWrapper = {
    run: async (...params) => {
      try {
        return await new Promise((resolve, reject) => {
          stmt.run(...params, function(err) {
            if (err) reject(err);
            else resolve({ lastInsertRowid: this.lastID, changes: this.changes });
          });
        });
      } catch (error) {
        // No finalizar aquí, dejar que el código lo haga explícitamente
        throw error;
      }
    },
    get: async (...params) => {
      try {
        return await new Promise((resolve, reject) => {
          stmt.get(...params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
      } catch (error) {
        throw error;
      }
    },
    all: async (...params) => {
      try {
        return await new Promise((resolve, reject) => {
          stmt.all(...params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          });
        });
      } catch (error) {
        throw error;
      }
    },
    finalize: safeFinalize,
    // Método para usar con try/finally automático
    withAutoFinalize: async (fn) => {
      try {
        return await fn(statementWrapper);
      } finally {
        await safeFinalize();
      }
    }
  };
  
  return statementWrapper;
}

export default db;
