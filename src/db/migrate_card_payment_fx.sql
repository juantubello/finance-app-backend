-- Migración: Actualizar tabla CARD_PAYMENT_FX para remover CARD_TYPE
-- Este script debe ejecutarse solo si la tabla ya existe con la estructura antigua

-- Paso 1: Crear tabla temporal con la nueva estructura
CREATE TABLE IF NOT EXISTS CARD_PAYMENT_FX_NEW (
    ID INTEGER PRIMARY KEY AUTOINCREMENT,
    YEAR INTEGER NOT NULL,
    MONTH INTEGER NOT NULL,
    CONVERSION_AMOUNT INTEGER NOT NULL,
    DATETIME TEXT NOT NULL,
    UNIQUE(YEAR, MONTH)
);

-- Paso 2: Migrar datos (si existen registros, tomar solo uno por YEAR/MONTH)
-- Si hay múltiples registros para el mismo YEAR/MONTH con diferentes CARD_TYPE,
-- se tomará el más reciente (por DATETIME)
INSERT INTO CARD_PAYMENT_FX_NEW (YEAR, MONTH, CONVERSION_AMOUNT, DATETIME)
SELECT YEAR, MONTH, CONVERSION_AMOUNT, MAX(DATETIME) as DATETIME
FROM CARD_PAYMENT_FX
GROUP BY YEAR, MONTH;

-- Paso 3: Eliminar tabla antigua
DROP TABLE IF EXISTS CARD_PAYMENT_FX;

-- Paso 4: Renombrar tabla nueva
ALTER TABLE CARD_PAYMENT_FX_NEW RENAME TO CARD_PAYMENT_FX;

-- Paso 5: Recrear índices
CREATE INDEX IF NOT EXISTS idx_card_payment_fx_year_month ON CARD_PAYMENT_FX(YEAR, MONTH);
