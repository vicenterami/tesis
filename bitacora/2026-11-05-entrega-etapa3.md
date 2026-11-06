# Entrega de la Etapa 3 — jueves 5 de noviembre de 2026

- **Entregado:** `Etapa3-Ramirez.pdf` (112 páginas; 30 de cuerpo) y las láminas de la presentación de avances
  (`Etapa3-Presentacion-Ramirez.pdf`, 19 páginas), por correo al profesor guía. Compilados desde el commit `e48f5e1`.
  Plazo ampliado por el profesor guía el 01/11 (fecha original: viernes 30/10).
- **Verificación previa:** compilación completa sin desbordes ni referencias sin resolver (cuerpo en 30 páginas, límite 30); guardián de
  concordancia en verde el 04/11 (46 pasos; 357 pruebas unitarias del backend; esquema, migraciones, figuras, API y repositorio público) y
  repetido al cierre del 05/11 tras los últimos cambios; tres pasadas de revisión independiente: dos el 04/11 (seguridad; concordancia;
  privacidad y licencias: 40 hallazgos verificados, 30 aplicados; y láminas e informe frente a la evidencia; arquitectura frente al
  código; corroboración contra el sistema en ejecución: 49 hallazgos, los de texto aplicados y 7 llevados a pendientes de la Etapa 4)
  y una el 05/11 (pauta de la etapa criterio por criterio, redacción para un lector sin contexto y concordancia de lo nuevo: 62
  hallazgos, 55 aplicados).
- **Lo nuevo en el informe respecto del 04/11:** figuras 3.1, 4.2 y F.5 corregidas y F.6 (cableado del nodo) agregada; hardware y costo del
  nodo propio junto a la corrida de 24 h; «Mejoras derivadas de las pruebas» completas; anexo H con el namespace de Kubernetes y el servidor
  de prueba compartido (procedimiento, problemas, verificación del 04/11 y proyección), sin nombres ni direcciones; términos internos
  retirados del cuerpo y repeticiones entre capítulos eliminadas.
- **Presentación de avances:** hecha el 28/10 en el campus (`bitacora/2026-10-28-presentacion-temuco.md`); las láminas entregadas suman la
  lámina «Servidor de prueba operando», el avance real de la etapa (lámina 14) y las respuestas que ya tienen la pregunta 3 (namespace y
  equipo compartido).
- **Estado del backlog de la etapa** (`docs/18 §1`, al 28/10): núcleo 25 de 34 elementos hechos (75 %) y 4 parciales; todo el backlog
  37 de 66 (56 %).
- **Presentación conjunta del 05/11:** con los tesistas de los profesores Mario Villanueva y Luis Alberto Caro; cada uno expuso su trabajo a
  grandes rasgos, como espacio de retroalimentación mutua y de posibles ayudas entre tesis. Única pregunta (profesor Caro): cómo se dará de
  alta una flota completa de dispositivos y si cada usuario podrá configurar los suyos. Respuesta: ambas previstas en la Etapa 4 (sesión con
  usuarios y roles por sitio en la iteración 0; alta masiva por archivo, diseñada, en la iteración 2; `docs/04 §8`). Registrado en el informe
  (§6.4) y en `docs/18 §1`.
- **Retroalimentación:** la de la Etapa 2 (2/10) sigue sin observaciones escritas; se pidió el 28/10 (`bitacora/2026-10-28-presentacion-temuco.md §4`)
  y el informe lo declara. Se incorporará junto con la de esta etapa cuando llegue.
- **Lo diferido a la Etapa 4:** sesión de usuarios y roles (bloque 1), panel de flota con alta masiva, canal callado y valor congelado para
  cualquier dispositivo, ruta C de punta a punta, despliegue en Kubernetes con escalado probado (`docs/04 §8`, `docs/18 §5`).
- **Servidor de prueba y namespace:** la plataforma opera en el equipo compartido de la red del campus desde el 03/11 y el namespace de
  Kubernetes quedó medido (17 pruebas) como entorno de desarrollo y diseño B; falta la dirección de entrada desde Internet (pedida). En el
  informe: §6.5 y anexo H, sin nombres ni direcciones (`docs/14 §7.4`).
