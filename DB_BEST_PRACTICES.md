# Mejores Prácticas para Uso de Base de Datos

## Problema Común: Statements No Finalizados

Cuando se alterna rápidamente entre tabs o hay múltiples peticiones concurrentes, los statements preparados pueden quedarse abiertos si no se finalizan correctamente, causando errores de conexión.

## Solución: Siempre Finalizar Statements

### Patrón Recomendado: Try/Finally

```javascript
let stmt = null;
try {
  stmt = prepare('SELECT * FROM TABLE WHERE id = ?');
  const result = await stmt.get(id);
  await stmt.finalize();
  stmt = null;
  // ... resto del código
} catch (error) {
  if (stmt) {
    await stmt.finalize();
    stmt = null;
  }
  throw error;
}
```

### Patrón Simplificado: Múltiples Statements

```javascript
let stmt1 = null;
let stmt2 = null;
try {
  stmt1 = prepare('SELECT ...');
  const result1 = await stmt1.all();
  await stmt1.finalize();
  stmt1 = null;
  
  stmt2 = prepare('INSERT ...');
  await stmt2.run(...params);
  await stmt2.finalize();
  stmt2 = null;
} catch (error) {
  if (stmt1) await stmt1.finalize();
  if (stmt2) await stmt2.finalize();
  throw error;
}
```

### Patrón para Loops

```javascript
const insertStmt = prepare('INSERT INTO ...');
let inserted = 0;

try {
  for (const item of items) {
    try {
      await insertStmt.run(...item);
      inserted++;
    } catch (err) {
      console.error('Error insertando item:', err);
      // Continuar con el siguiente item
    }
  }
} finally {
  // SIEMPRE finalizar después del loop
  await insertStmt.finalize();
}
```

## Reglas de Oro

1. **Siempre finalizar statements**: Cada `prepare()` debe tener su correspondiente `finalize()`
2. **Usar try/finally**: Garantiza la finalización incluso si hay errores
3. **Finalizar en orden inverso**: Si tienes múltiples statements, finalízalos en orden inverso a como los creaste
4. **No reutilizar statements finalizados**: Una vez finalizado, no uses el statement nuevamente
5. **Finalizar antes de enviar respuesta**: Asegúrate de finalizar todos los statements antes de `res.json()`

## Ejemplo Completo

```javascript
router.post('/endpoint', async (req, res) => {
  let selectStmt = null;
  let insertStmt = null;
  
  try {
    // Statement 1: Seleccionar
    selectStmt = prepare('SELECT * FROM TABLE WHERE id = ?');
    const existing = await selectStmt.get(req.body.id);
    await selectStmt.finalize();
    selectStmt = null;
    
    if (existing) {
      return res.status(409).json({ error: 'Ya existe' });
    }
    
    // Statement 2: Insertar
    insertStmt = prepare('INSERT INTO TABLE ...');
    await insertStmt.run(...params);
    await insertStmt.finalize();
    insertStmt = null;
    
    res.json({ success: true });
  } catch (error) {
    // Limpiar statements en caso de error
    if (selectStmt) {
      try { await selectStmt.finalize(); } catch (e) {}
    }
    if (insertStmt) {
      try { await insertStmt.finalize(); } catch (e) {}
    }
    
    console.error('Error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message
      }
    });
  }
});
```

## Verificación

Si experimentas errores de conexión:
1. Verifica que todos los `prepare()` tengan su `finalize()`
2. Asegúrate de usar try/finally o try/catch con finalización
3. Revisa los logs del servidor para identificar statements no finalizados
4. Reinicia el servidor para limpiar cualquier statement huérfano
