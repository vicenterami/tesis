# 22/10/2026 — Lo que dejó la prueba de campo, convertido en diseño, código y pruebas

**Contexto.** Dos días después de la prueba con la red LoRaWAN del campus (`bitacora/2026-10-20-prueba-de-campo-lorawan.md`), un bloque
largo para cerrar lo que esa prueba dejó a la vista y lo que la entrega del 30/10 exige. Todo se verificó con el guardián de concordancia
en verde y el cuerpo del informe (sin anexos) en las 30 páginas que fija la pauta, sin desbordes.

## Qué se hizo
- **Todas las vías en las figuras** (`docs/10 §1–§2`, figuras de contenedores y de red, `cap-diseno`): además de MQTT sobre TLS y LoRaWAN por
  pasarela, ahora se dibujan la entrada HTTP con token (`POST /recepcion/{id_fisico}`, 443) y, punteado, el reporte HTTPS de la pasarela como
  segundo destino (escenario 8, previsto: la UG65 admite un solo destino MQTT por aplicación). El 1700/udp de la ruta A queda declarado «solo
  en una red local» (`docs/11` A7).
- **Reloj de pasarela desviado** (`docs/13` regla 18, `docs/10 §8.4` punto 54, migración 20, `docs/16 §46`): una marca con origen `pasarela` a
  más de 10 minutos de la hora de recepción se reemplaza por esta y abre la condición `reloj_desviado` del nodo, con la pasarela, el desvío y
  la marca; la primera marca plausible la cierra; hacia el futuro rige el tope de 2 minutos de siempre y también avisa. 14 pruebas unitarias
  nuevas (338), 1 del panel (53), banco LoRaWAN 46/46 con el caso de la UG65 cuatro días atrasada y su corrección. Una marca de dispositivo
  antigua se sigue respetando (cola sin cobertura).
- **Límite de tasa por dirección en el proxy** (`proxy/nginx.conf`, `docs/11 §3`, `docs/16 §47`): 100 r/s con ráfaga 200 en el 443 (el doble de
  RNF-01 desde una sola dirección), 5 r/s con ráfaga 10 para los métodos que escriben sobre `/dispositivos` y `/pasarelas`, y 100 sesiones
  por dirección en el 8883; `pruebas/banco/proxy-limites.sh` planta cada violación y comprueba lo legítimo (15/15; 23/23 tras la revisión de cierre).
- **Despliegue en Kubernetes como diseño** (`docs/14 §6`, TT-41): las imágenes ya son OCI; lo que faltaba era el estado por pieza y las
  equivalencias Compose → k3s. Hecho verificado en la documentación oficial: k3s exige 2 GB para el nodo servidor, tanto como el techo de
  RNF-17, así que Compose en un servidor sigue siendo la recomendación y el clúster queda diseñado (N réplicas con suscripciones compartidas).
- **Rotación de claves y certificados** (`docs/11 §7`): calendario y procedimiento por secreto (antes del despliegue, periódica, ante
  incidente), con comando, corte y rastro; lo que aún corta segundos queda dicho.
- **Todo es consultable** (`pruebas/banco/consultable.sh`, `docs/16 §48`): para cada dispositivo, inventario → ficha → histórico de cada canal en
  cuatro rangos → exportación → condiciones → cuarentena, con la forma del contrato verificada; 104 comprobaciones en la pila, 757 en el banco.
- **La misma serie por las tres vías** (`banco.sh vias`, `docs/16 §49`): 180 lecturas por MQTT, por HTTP en packs de 1, 10 y 60, y por la pasarela;
  28/28, 0 pérdidas, 0 duplicados con las repeticiones a propósito, p95 de 4 a 157 ms y el backend entre 59 y 61 MiB; por HTTP, el ritmo de una
  trama por segundo hace que el pack de 1 tarde 194 s y el de 60, 5,6 s.
- **Referentes con datos, no con opinión** (`docs/01 §1.8`, cuadro del anexo C): ThingsBoard CE, OpenRemote, Magistrala y Milesight IoT Cloud
  frente a este sistema en siete criterios, cada celda con cita literal de documentación oficial leída hoy; «no declarado» se escribe como tal.
- **Backlog y estado** (`docs/04`, `docs/18`, anexos B y E): TT-41 agregado; totales recalculados desde las filas (66 elementos, 287 h); el
  resumen del anexo B llevaba un elemento y 6 h de atraso y se corrigió hacia la suma real.

- **Parche de seguridad de Node.js** (publicado el 21/10/2026; 10 CVE, cuatro de gravedad alta): la imagen del backend pasa de
  `node:22.23.3-trixie-slim` a `node:22.23.4-trixie-slim`, fijada por digest en las dos etapas del Dockerfile; se reconstruye con bases
  frescas y se vuelve a escanear antes de darla por buena (`docs/11 §8`). El mismo escaneo mostró tres altas de nginx corregidas en la
  1.30.6 publicada ese día (el `FROM` del proxy sube a ella, fijada por digest) y dos bibliotecas con parche de Alpine (`libx11` en el
  proxy, `libexpat` en la base), sumadas a sus listas; `docs/16 §12`. De paso, la API rechaza un día que no existe (`2026-02-30`),
  que JavaScript corría al 2 de marzo sin avisar: validación de ida y vuelta, con prueba.

- **Primer incremento del panel** (`docs/19 §4`, «Incremento 1 de P2 y P3»; `docs/16 §50`), diseñado después de comparar con citas
  oficiales qué hacen ThingsBoard, OpenRemote, Magistrala y Milesight IoT Cloud en tres problemas que la prueba de campo dejó a la vista:
  la vista vive en la URL y se restaura al volver o compartir el enlace; un rango sin datos lo dice y lleva a la última medición con un
  clic (nunca amplía el rango solo); la ficha muestra el intervalo observado junto al esperado (`intervalo_observado_s`, mediana de las
  últimas 20 tramas: el nodo de campo da 17 s frente a 3 min declarados) y avisa cuando difieren por más del doble; el reloj de pasarela
  desviado se lee en palabras; «en vivo» muestra hace cuánto llegó la última lectura. 342 pruebas del backend y 76 del panel; navegador real
  9/9 con captura.
- **Calibración por la API** (`docs/10 §8.4` punto 51, `docs/16 §51`): `PATCH /canales/{id}` fija `escala_cero` y `escala_cien` con la clave de
  administrador y bloqueo optimista por `actualizado_en` (409 si alguien cambió la fila entretanto; 200 sin escribir si nada cambia), las escalas
  también en el alta, evento `canal_calibrado`; migración 21 y permiso mínimo para la aplicación. El banco del nodo propio calibra por la API
  y ve el % en la ficha, el histórico y el canal en vivo; la ruta entra en la zona estricta del proxy.
- **Resumen de corrida larga** (`pruebas/corrida-larga.sh`): lecturas por canal, intervalo entre lecturas, huecos, alarmas de silencio y valores
  mínimo, máximo y último, para la corrida de 24 h del nodo propio, que se hace en el portátil sin servidor.

## Lo que quedó a la vista
- La plantilla del alta de pasarelas se corrigió a `$deveui` el 20/10, pero el banco seguía esperando `$devEUI`: la comprobación se actualizó.
- Una pasarela desviada con varios nodos abre una condición por nodo (el modelo no tiene estado propio de pasarela); si deja de mandar marca,
  la condición abierta no se cierra sola. Ambos límites quedaron escritos en `docs/10` punto 54 y `docs/16 §46`.
- La revisión de cierre del incremento del panel encontró que el verificador de concordancia forzaba el conteo actual de pruebas del panel
  también en las secciones fechadas de `docs/16`, y que así se había reescrito la historia («270 del backend y 76 del panel» nunca existió):
  se restauraron las cifras de cada fecha y el paso 2w4 ahora exige el conteo actual solo en la cabecera y en la última sección, probado
  plantando un conteo falso. También: la vía de la URL se depura como el sitio y la zona, y el contrato de `intervalo_observado_s` dice
  «tramas retenidas» en vez de «30 días».
- La revisión de cierre del bloque dejó tres correcciones de peso: la prueba de «100 sesiones vivas» contaba subprocesos y no apretones TLS
  (rehecha: 99 sesiones, la 100 entra, la 101 se corta y el proxy lo anota); la zona de administración distinguía mayúsculas y Express no
  (`POST /DISPOSITIVOS` la esquivaba); y faltaba un tope de conexiones HTTP y de flujos `/eventos` por dirección (100 y 20). Queda para la
  Etapa 4 aceptar dos secretos vigentes al rotar `PROXY_SECRETO` y `HTTP_CLAVE_ADMIN`.

## Pendiente
La corrida de 24 h del nodo propio y la revisión de entrega.
