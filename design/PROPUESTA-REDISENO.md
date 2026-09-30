# Propuesta de rediseño de GitDesk

## Idea central

Conservar el flujo de Visual Studio (ramas a la izquierda, historial o diff en el centro, cambios a la derecha), pero hacer que cada zona tenga una tarea clara. La barra superior concentra las operaciones remotas; el panel de cambios se dedica a preparar el commit; Output se abre desde la barra de estado cuando se necesita.

La [maqueta interactiva](propuesta-redisenio.html) muestra el concepto en tema oscuro y claro. La aplicación ya incorpora esta distribución y los flujos principales; la maqueta sigue siendo una referencia visual independiente.

## Cambios principales

1. **Una sola barra de operaciones Git.** Fetch, Pull y Push aparecen una vez, con contadores `↓0` y `↑2`. Sync pasa al menú de acciones para evitar cuatro verbos de peso visual similar. Crear rama y Stash quedan en el menú de la rama.
2. **Contexto siempre visible.** El nombre del repositorio, rama actual y estado respecto a `origin` quedan agrupados arriba. Así se puede comprobar el destino antes de Push, Pull o Commit.
3. **Centro orientado a la tarea.** El historial ocupa el espacio principal. Al seleccionar un archivo, el centro cambia a Diff sin abrir una ventana flotante; una pestaña permite volver al historial.
4. **Panel de cambios con orden de trabajo.** `Staged` y `Unstaged` se separan con contadores y acciones cercanas a cada grupo. El mensaje y el botón Commit permanecen visibles al pie del panel.
5. **Menos ruido permanente.** Output empieza colapsado y se abre desde la barra de estado. Los detalles Incoming/Outgoing se resumen en una línea contextual, con acceso al historial completo.
6. **Estados legibles.** Azul para acciones y foco; verde, ámbar, rojo y violeta solo para estados de archivos. Cada estado incluye letra o texto para que el color no sea la única señal.

## Medidas y comportamiento

| Zona | Ancho inicial | Comportamiento |
|---|---:|---|
| Explorador de Git | 248 px | Redimensionable; se oculta como panel lateral en ventanas estrechas |
| Historial / Diff | Flexible; mínimo recomendado 520 px | Área principal, con búsqueda y pestañas |
| Cambios | 352 px | Redimensionable; pasa a panel lateral en ventanas estrechas |
| Output | Cerrado | Se abre bajo el centro cuando se necesita |

Altura de filas: 30–32 px para archivos y commits; 36–40 px para controles principales. Mantener atajos existentes y permitir navegar con teclado por árbol, historial y archivos. El estado vacío debe mostrar la siguiente acción útil (por ejemplo, Fetch cuando aún no hay datos de `origin`).

## Estado de implementación

1. Reorganizados `index.html` y `src/styles/app.css` sin cambiar comandos Git.
2. Eliminados los controles duplicados de sincronización; Output queda colapsado por defecto en instalaciones nuevas.
3. Diff se muestra en el área central al seleccionar un archivo; se conservan los diálogos para acciones destructivas y comparaciones complejas.
4. Adaptados los paneles laterales a ventanas estrechas y añadida navegación de teclado en las pestañas centrales.

La propuesta no depende de funcionalidades futuras del roadmap, como stage por fragmentos o el editor de conflictos de tres vías. Estos pueden incorporarse después en el mismo espacio central.
