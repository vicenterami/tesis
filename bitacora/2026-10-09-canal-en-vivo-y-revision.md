# Canal de tiempo real, revisión y decisiones del panel — 9 de octubre de 2026

- **Sesión de trabajo individual.** Se construyó el canal en vivo hacia el panel (TT-39), se revisó todo lo cambiado desde
  la revisión anterior en cuatro frentes (seguridad; código frente a arquitectura; documentos frente a informe; privacidad
  y licencias) y se cerraron cinco decisiones del panel. Cada protección se probó plantando su violación: un cambio
  temporal, restaurado y comparado con `cmp`, que hace fallar exactamente la prueba que la cubre (`docs/16 §14`).

## Canal en vivo (`GET /eventos`, `docs/10 §5`)
- Server-Sent Events: emite `medicion`, `visto` y `condicion` solo después de que cada uno queda guardado en la base, y un
  latido cada 25 s; filtros opcionales por dispositivo o canal (solo UUID). Tope de 50 flujos abiertos (503), documentado
  como cota de recursos, no como defensa.
- **Dos ajustes de diseño respecto de lo escrito antes.** (1) El control de origen compara con el propio host y puerto, sin
  «lista blanca de orígenes»: el panel lo sirve el mismo backend y una lista sería una variable más por ambiente sin proteger
  de nada adicional. Se mira además `Sec-Fetch-Site`, que el navegador pone y la página no puede falsificar: una imagen o un
  `fetch` «no-cors» desde otro sitio no mandan `Origin`, pero sí esa cabecera. (2) En desarrollo no se abre CORS: el servidor
  de Vite reenviará la API y el canal al backend (`server.proxy`), así el navegador ve un solo origen en todos los ambientes.
  Ambos escritos en `docs/10 §5` y `docs/11`, antes del código.
- **Lo que destapó la prueba de punta a punta** (`banco.sh proxy`, flujo abierto por el 8443 antes de publicar por MQTT sobre
  TLS): el proxy reenviaba el `Host` sin el puerto (`$host`) y el canal rechazaba al propio panel en el banco; ahora
  `$http_host`. Una pestaña abierta retenía el apagado del backend: se cortan solo las conexiones del canal, porque el
  primer arreglo (cortar todas) también cortaba una petición normal en curso, lo que se vio al probar ese otro sentido.
  Exportar el contrato OpenAPI iniciaba la aplicación entera y, con la pila arriba, el broker desconectaba al backend en
  marcha por compartir identificador (MQTT 3.1.1, [MQTT-3.1.4-2]); ahora se genera sin iniciarla.

## Revisión en cuatro frentes: 28 correcciones
- **Seguridad:** `Sec-Fetch-Site` (arriba); el tope de flujos documentado como cota; contrapresión frente a un cliente lento
  documentada (`send_timeout` del proxy); el control de origen **no detiene el *DNS rebinding***, y el texto público dejó de
  prometerlo; la prueba de las reglas de identidad lleva tiempos de espera y comprueba que no queda nada; el banco espera el
  primer byte del flujo antes de publicar en vez de un `sleep` fijo; el filtro por dispositivo es comodidad, no autorización,
  y se dice.
- **Código frente a arquitectura:** el diagrama de alta mostraba un evento inexistente y la alta insertaba un estado que la
  migración 11 ya calcula; repetir las migraciones 07 o 09 duplicaba una regla de cuarentena (ahora la última la reemplaza y
  las anteriores solo la crean si no existe, probado en dos bases desechables); «✅ convenciones» para índices, disparadores y
  funciones se afirmaba sin medirlo (medido: 1 índice, 1 disparador y 3 funciones sin prefijo; cuatro comprobaciones nuevas
  y un renombre pendiente para la próxima migración); el cierre de una condición no tenía guarda (carrera al cerrar, la
  misma que al abrir); el contrato traía un solo tipo de evento de ejemplo.
- **Documentos frente a informe:** cifras de pruebas y totales del estado de la etapa ahora las verifica el guardián (pasos
  2t y 2w, probados plantando un total falso); `docs/12` contaba 6 rutas y omitía dos migraciones; el modelo ER marcaba como
  normal una columna deprecada (el generador lee ahora el `COMMENT`); comentarios y leyendas desalineados con el proxy; la
  matriz de acceso rotulada en la etapa equivocada.
- **Privacidad y licencias:** sin hallazgos útiles (tres descartados con evidencia).
- De paso: el generador de figuras copiaba las fuentes antes de renderizar y un render fallido dejaba fuente nueva con PDF
  viejo; ahora copia solo tras renderizar bien (probado con un diagrama roto: en Mermaid, un `;` corta un mensaje).

## Decisiones (escritas en `docs/10 §8.4` y en el backlog)
- Mudar un dispositivo de zona o de sitio conserva el historial de ubicaciones (punto 39; con HU-12, Etapa 4).
- El panel vive en `plataforma/backend/panel/`, en el mismo workspace de pnpm, y lo sirve el backend; se arma con Svelte y
  Vite, sin SvelteKit, y los gráficos con uPlot (`docs/07`). Se construye por tramos, con un commit por tramo.
- Pesos de la matriz de proxies aceptados y columna «Experiencia» de la matriz de la pila confirmada; las matrices pasan al
  anexo C.
- **Lista de nombres de host permitidos contra el *DNS rebinding***, en el backend y en el proxy, ahora, y la sesión del
  panel en la Etapa 4: se implementa en la sesión siguiente (12/10, punto 40).

## Pendiente
- Tramo 2 del panel: esqueleto en el workspace, Vite con `server.proxy` hacia el backend (comprobar con el panel real que el
  reenvío no retiene los eventos y conserva el `Host`), servido por el backend en `/panel`, Dockerfile en etapas y CI.
- Próxima migración: renombrar con su prefijo las cinco piezas sin convención y quitar sus excepciones; `ubicacion_dispositivo`.
- Preguntas al profesor guía (servidor alcanzable por la pasarela, servidor de red de la red real) y laboratorio del nodo ESP32.
