# 01/11/2026 — Servidor de prueba, figuras del autor como fuente única y la ruta A con Basics Station

**Contexto.** La retroalimentación del profesor guía sobre la presentación del 28/10 no ha llegado y el plazo de la Entrega 3 pasó al
jueves 05/11. La universidad ofrece un equipo antiguo en su red como servidor de prueba, con instalación probable el martes 03/11. El día se
dedicó a dejar ese servidor planeado y seguro, a cerrar el trabajo de las figuras 4.1 y 2.2 que el autor dibuja en draw.io, y a una
revisión de arquitectura que terminó cambiando una decisión de diseño.

## 1. Servidor de prueba en la red de la universidad

Decisiones, con su ficha en el registro privado y su copia pública en `docs/14 §7`, `docs/11 §4` y `§8`, `docs/10 §8.4` punto 55:
- **Acceso de administración por red privada cifrada (WireGuard), de salida.** SSH y los puertos de personas (443 y 80) se publican solo en
  la dirección de esa red; el 8883 en todas las interfaces para la pasarela del campus. Mientras la institución no reenvíe un puerto UDP, la
  red la coordina un servicio de terceros con plan gratuito para uso no comercial; WireGuard propio queda preparado y detenido para el día
  que lo reenvíen. Cumple la regla de `docs/11 §8` («la API no se publica en 443 antes de M7») sin dejar el panel inalcanzable: la interfaz
  de publicación es el control, porque el cortafuegos del anfitrión no filtra lo que Docker publica.
- **Sistema operativo:** una distribución LTS con soporte vigente, sin cifrado de disco (el servidor reinicia solo tras los parches); si el
  equipo llega con un sistema instalado, se acepta solo si pasa cinco comprobaciones (soporte vigente, `sudo`, sin usuarios ni llaves ni
  servicios que nadie explique, disco sano, actualizable).
- **Avisos de caída por «hombre muerto»:** el servidor manda un latido cada 5 minutos a un servicio externo solo si `/salud` responde `ok`;
  10 minutos sin latido avisan por correo y mensajería. Un servidor apagado no puede avisar que se apagó; la URL del latido es un secreto.
- **Certificado:** CA propia del servidor de prueba, distinta de la de desarrollo, creada fuera del servidor, con un solo certificado para
  navegadores, pasarela y nodo. Let's Encrypt sigue siendo la meta con nombre público; la imagen del proxy ya trae el módulo ACME de nginx
  (verificado en la imagen fijada).
- Hecho en el repositorio: `ca-desarrollo.sh` acepta varias direcciones, nombres de host y un nombre de CA; `docs/14 §7` describe el
  procedimiento sin nombres ni direcciones; se verificó en una copia que `COMPOSE_FILE` en el `.env` hace que Compose ignore el `override`.

## 2. Figuras 4.1 y 2.2: la versión del autor es la fuente

El autor dibujó las dos figuras en draw.io y pidió que se respetara su versión: puertos visibles, orden de izquierda a derecha por puerto,
énfasis en lo hecho y lo previsto, procesos del backend legibles, tamaños sin cambiar. Se escribió una lista de cambios mínimos, solo por
concordancia con `docs/10 §1`, y se aplicó tras su aprobación. Hallazgo del cruce con el documento de diseño: el rótulo «red del campus»
estaba sobre la ruta del servidor de red externo (ruta C), cuando desde el 15/10 la red del campus entra por el servidor embebido de la
pasarela (ruta B); el mismo error vivía en una ficha de decisión y se corrigió en las dos partes.

Decisiones: las cajas del backend llevan los **números de filtro de la figura 3.1** (1 y 2 recepción, 3 y 4 normalización, 5 alertas,
6 supervisión), no los códigos M del catálogo, que siguen vigentes en `docs/02 §3`: dos numeraciones distintas para cosas parecidas se leían
como contradicción. Los `.drawio` y sus PDF (exportados sin metadatos de fecha) viven en `informe-oficial/figuras/drawio/` y son la fuente
única; `docs/10 §1` apunta a ellos; el generador de figuras pasó de siete a seis bloques Mermaid; el guardián ganó el paso 3d (términos de
`docs/10 §1` presentes en el dibujo, rótulos viejos ausentes, PDF que dice lo mismo que el `.drawio`), probado plantando dos violaciones.
La figura 2.3 (LoRaWAN) y las del anexo F quedaron alineadas; el informe sigue en 30 páginas.

## 3. La ruta A deja el reenvío UDP y adopta LoRa Basics Station

Al explicar por qué el 1700/udp iba «solo en red local», la respuesta fue cambiar la decisión: el protocolo Semtech UDP de los *packet
forwarders* no autentica ni cifra (lo dice la documentación de ChirpStack y la del fabricante de la pasarela del campus), y la industria
ofrece como reemplazo Basics Station, WebSocket sobre TLS con autenticación de la pasarela por certificado de cliente, que el puente de
pasarelas de ChirpStack admite. Resultado: el proxy publica **dos puertos, siempre** (443 y 8883); la ruta A, opcional y diseñada, entra por
443. Las vías se renumeraron por protocolo y relevancia: 1 MQTT sobre TLS (nodo directo, rutas B y C), 2 HTTPS (equipo directo; el reporte
de la pasarela como variante prevista), 3 WebSocket sobre TLS (Basics Station). Se corrigió en `docs/10`, `docs/11`, `docs/04`, `docs/16`,
`docs/18`, el informe y las láminas (`docs/10 §8.4` punto 56). Sin cambio de código: el proxy nunca tuvo el listener UDP.

## 4. Seguridad: lo comparado y lo decidido

Frente a lo que publican los proveedores grandes de IoT y la norma MQTT: cifrado, puertos, autorización y topes están al nivel de la
industria; la identidad por dispositivo (usuario y clave con hash) está un escalón por debajo del certificado X.509 por dispositivo. Se
decidió **diseñar ahora y construir en el bloque 1 de la Etapa 4** la identidad por certificado de cliente (TLS mutuo): CA de dispositivos,
emisión en el alta, verificación en el borde, nodo y pasarela con certificado; la guía oficial de la pasarela del campus confirma que su
cliente MQTT admite CA, certificado y llave de cliente (`docs/10 §8.4` punto 57). Además se fijó `max_connections 1200` por listener en el
broker de la pila y del banco, plantado en un broker desechable con tope 3 (`docs/16 §57`); la revisión encontró que el contenedor traía
1 024 descriptores de archivo, con lo que el tope no se habría alcanzado, y el compose fija ahora `ulimits nofile 4096`, exigido por el
guardián.

## 5. Verificado en ejecución

Pruebas unitarias del backend (adaptadores, LoRaWAN, recepción, pasarelas): 4 suites, 112 pruebas en verde. Banco de punta a punta:
rutas B y C 46 de 46, recepción por HTTP 20 de 20. Las afirmaciones sobre terceros usadas hoy (planes gratuitos, licencias, módulo ACME,
integración de mensajería, certificado de cliente en la pasarela) quedaron con cita literal en el registro privado de evidencia.

## 6. Lecciones

- Un rótulo en una figura puede sobrevivir a la decisión que lo cambió: la concordancia se verifica cruzando el dibujo con el texto de
  diseño, no leyendo el dibujo solo.
- «Tres vías» significaba una cosa el 22/10 y otra el 01/11: al renumerar, se busca el término en todo el repositorio y se anota dónde
  conserva el sentido antiguo (registros fechados), en vez de corregirlo a ciegas.
- Una revisión sin contexto encontró dos imprecisiones que el autor no veía: «autenticación por token» donde el puente solo admite
  certificado, y un tope de conexiones inalcanzable por un límite del contenedor. Verificar cada hallazgo antes de corregir sigue valiendo:
  varios de los 24 eran de redacción y dos no aplicaban.
- Un «mínimo indispensable» con horas que no caben en las semanas disponibles no es un plan: las iteraciones de la Etapa 4 se
  recalcularon a 15 h por semana (`docs/04 §8`).

## 7. Qué sigue

Lunes: preparar el servidor (cuentas con segundo factor, medio de instalación, clientes de la red privada). Martes, si se confirma: instalación
presencial mínima y el resto desde casa. Miércoles: pasada de revisión de tres lentes antes de la entrega. Jueves 05/11: Entrega 3 y
presentación. La retroalimentación del profesor, cuando llegue, se anota en la bitácora del 28/10 y reordena lo que haga falta.
