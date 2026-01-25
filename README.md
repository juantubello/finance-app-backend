# Finance App Backend

Backend Node.js para aplicación de finanzas con SQLite como base de datos local persistente.

## Stack

- **Node.js** (LTS)
- **Express** - Framework HTTP
- **better-sqlite3** - Base de datos SQLite
- **Docker** - Containerización
- **Docker Compose** - Orquestación

## Estructura del Proyecto

```
finance-app-backend/
├── src/
│   ├── server.js              # Servidor principal
│   ├── db/
│   │   ├── index.js           # Conexión y inicialización de DB
│   │   └── schema.sql         # Schema de la base de datos
│   ├── lib/
│   │   └── amount.js          # Helpers para parseo de montos
│   ├── modules/
│   │   └── sheets/
│   │       └── index.js       # Módulo Google Sheets (STUB)
│   └── routes/
│       ├── transactions.js    # Rutas de transacciones
│       ├── dashboard.js       # Rutas de dashboard
│       ├── annual.js          # Rutas de reportes anuales
│       ├── liquidity.js       # Rutas de liquidez
│       ├── evolution.js       # Rutas de evolución
│       └── cards.js           # Rutas de tarjetas (STUB)
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```

## Variables de Entorno

Crear archivo `.env` basado en `.env.example`:

```env
NODE_ENV=production
PORT=3000
DB_PATH=./data/finance.db
```

## Levantar con Docker Compose

```bash
# Construir y levantar
docker-compose up -d

# Ver logs
docker-compose logs -f

# Detener
docker-compose down
```

## Levantar sin Docker

```bash
# Instalar dependencias
npm install

# Crear directorio para datos
mkdir -p data

# Iniciar servidor
npm start

# Modo desarrollo (con watch)
npm run dev
```

El servidor estará disponible en `http://localhost:3000`

## Base de Datos

La base de datos SQLite se crea automáticamente al iniciar el servidor. El schema se inicializa desde `src/db/schema.sql`.

**Tablas principales:**
- `TRANSACTIONS` - Transacciones (INGRESOS, GASTOS, AHORROS)
- `LIQUIDITY_OPENING_BALANCE` - Balances iniciales de liquidez
- `CARD_STATEMENTS` - Resúmenes de tarjetas (cabecera)
- `CARD_STATEMENT_ITEMS` - Items de resúmenes de tarjetas

## Endpoints

### Health Check

```bash
GET /health
```

Respuesta:
```json
{
  "status": "ok"
}
```

### Transacciones

#### Crear transacción
```bash
POST /transactions
Content-Type: application/json

{
  "uuid": "unique-id-123",
  "datetime": "2026-01-24T13:17:34-03:00",
  "year": 2026,
  "month": 1,
  "type": "EXPENSE",
  "amount": "15000.50",
  "currency": "ARS",
  "category": "Comida",
  "description": "Almuerzo",
  "affects_liquidity": 1
}
```

#### Obtener transacciones
```bash
GET /transactions?year=2026&month=1&type=EXPENSE&currency=ARS
```

#### Obtener transacción por UUID
```bash
GET /transactions/:uuid
```

### Dashboard

#### Resumen mensual
```bash
GET /dashboard/summary?year=2026&month=1&currency=ARS
```

Respuesta:
```json
{
  "year": 2026,
  "month": 1,
  "currency": "ARS",
  "income_total": 100000.00,
  "income_total_cents": 10000000,
  "expense_total": 50000.00,
  "expense_total_cents": 5000000,
  "saving_total": 20000.00,
  "saving_total_cents": 2000000,
  "liquidity_current": 150000.00,
  "liquidity_current_cents": 15000000,
  "category_breakdown": [
    {
      "category": "Comida",
      "total": 30000.00,
      "total_cents": 3000000
    }
  ]
}
```

### Reportes Anuales

#### Gastos anuales
```bash
GET /annual/expenses?year=2026&currency=ARS
```

Respuesta incluye:
- `data`: Formato pivot (CATEGORY, MONTH, TOTAL)
- `grid`: Grilla estructurada por categoría y mes

### Liquidez

#### Crear balance inicial
```bash
POST /liquidity/opening-balance
Content-Type: application/json

{
  "datetime": "2026-01-01T00:00:00-03:00",
  "currency": "ARS",
  "amount": "100000",
  "description": "Balance inicial"
}
```

#### Obtener liquidez actual
```bash
GET /liquidity/current?currency=ARS
```

### Evolución

#### Ingresos vs Gastos
```bash
GET /evolution/income-vs-expense?year=2026&month=1&monthsBack=12&currency=ARS
```

#### Ahorros
```bash
GET /evolution/savings?year=2026&month=1&monthsBack=12&currency=ARS
```

### Tarjetas (STUB)

```bash
POST /cards/statements
GET /cards/statements
```

**Nota:** Estos endpoints están como stub y retornan 501 (Not Implemented).

## Manejo de Montos

Todos los montos se guardan como **INTEGER en centavos** en la base de datos.

### Parseo de Montos

El helper `parseAmountToCents()` soporta múltiples formatos:

- `"115000"` → `11500000` (asume unidades, multiplica por 100)
- `"115,000.00"` → `11500000` (formato US)
- `"115.000,00"` → `11500000` (formato ES/AR)
- `"-1000"` → `-100000` (negativo)
- `"-1.000,50"` → `-100050` (negativo con decimales)

### Reglas de Negocio

- `TYPE=INCOME` → `AFFECTS_LIQUIDITY=1` (automático)
- `TYPE=EXPENSE` → `AFFECTS_LIQUIDITY=1` (automático)
- `TYPE=SAVING` → `AFFECTS_LIQUIDITY=0` (automático)

## Ejemplos cURL

### Crear transacción
```bash
curl -X POST http://localhost:3000/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "uuid": "test-123",
    "datetime": "2026-01-24T13:17:34-03:00",
    "type": "EXPENSE",
    "amount": "15000.50",
    "currency": "ARS",
    "category": "Comida",
    "description": "Almuerzo"
  }'
```

### Obtener resumen del dashboard
```bash
curl http://localhost:3000/dashboard/summary?year=2026&month=1&currency=ARS
```

### Obtener liquidez actual
```bash
curl http://localhost:3000/liquidity/current?currency=ARS
```

### Crear balance inicial
```bash
curl -X POST http://localhost:3000/liquidity/opening-balance \
  -H "Content-Type: application/json" \
  -d '{
    "datetime": "2026-01-01T00:00:00-03:00",
    "currency": "ARS",
    "amount": "100000",
    "description": "Balance inicial"
  }'
```

## Notas Importantes

- **Sin CORS**: El backend no tiene CORS configurado por ahora
- **SQL directo**: No se usa ORM, se usa SQL explícito con prepared statements
- **Persistencia**: Los datos se guardan en volumen Docker (`./data`)
- **UUID único**: Las transacciones deben tener UUID único para evitar duplicados
- **Montos grandes**: Se usa INTEGER para soportar montos muy grandes (millones ARS)

## Desarrollo

### Modo desarrollo con watch
```bash
npm run dev
```

### Ver logs de Docker
```bash
docker-compose logs -f backend
```

### Acceder a la base de datos
```bash
# Con Docker
docker-compose exec backend sh
sqlite3 /app/data/finance.db

# Sin Docker
sqlite3 data/finance.db
```

## Próximos Pasos

- [ ] Implementar módulo Google Sheets API
- [ ] Implementar endpoints de tarjetas
- [ ] Agregar autenticación si es necesario
- [ ] Agregar validaciones adicionales
- [ ] Implementar tests
