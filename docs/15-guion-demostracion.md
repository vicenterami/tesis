# Guion de demostración (10 minutos)

> **Para qué:** mostrar el sistema funcionando ante el profesor guía o la comisión, de punta a punta, con
> salidas verificables. Todo se ejecuta **desde la raíz del repositorio**, con la plataforma en Docker.
> La clave del dispositivo de prueba sale del gestor de contraseñas local; **nunca** se escribe en el
> guion ni en el chat. Cada paso indica lo que se dice, lo que se ejecuta y lo que debe verse.

**Las tres piezas que se ven en pantalla** (son contenedores distintos, cada uno con una sola tarea):

| Pieza | Qué es | Qué hace en la demo |
|---|---|---|
| **broker** (Mosquitto) | El «correo» MQTT: recibe lo que publican los dispositivos y lo entrega a quien está suscrito | Autentica a `dev-0001` y le entrega la trama al backend |
| **backend** (NestJS) | El programa de la tesis: el pipeline de seis filtros, el supervisor y la API | Decide qué se guarda, qué va a cuarentena y qué alerta se abre |
| **base** (TimescaleDB) | PostgreSQL con series de tiempo | Guarda mediciones, cuarentena, condiciones y eventos |

## 0. Antes de empezar (5 min, fuera de escena), en este orden

1. **La clave primero, porque es lo único que puede cortar la demo.** Si la clave de `dev-0001` no está
   en el gestor o no calza (al publicar sale `not authorised`), se crea una nueva:
   `bash plataforma/pruebas/clave-dispositivo.sh dev-0001` (pide la clave oculta, reinicia el broker y
   verifica que autentica; `docs/11 §7`). Se hace **antes de todo lo demás**: el reinicio del broker corta
   la conexión del backend unos segundos.
2. **Levantar, cargar datos y verificar:**

```bash
bash plataforma/pruebas/pila.sh encender      # construye, levanta, espera «healthy» y muestra el estado
bash plataforma/pruebas/semilla-demo.sh       # datos del guion (idempotente): SEMILLA LISTA
bash plataforma/pruebas/verificar-todo.sh     # TODO EN CONCORDANCIA
```

3. **Dos terminales y el navegador:**

```bash
bash plataforma/pruebas/pila.sh logs          # terminal A: registros en vivo (copia en privado/logs/, un archivo por vez)
read -rs CLAVE_DEV && export CLAVE_DEV        # terminal B: pegar la clave desde el gestor (no se ve nada: es lo correcto)
echo ${#CLAVE_DEV}                            # terminal B: debe decir 32 (el largo, nunca la clave)
```

Navegador: `http://127.0.0.1:3000/docs`. **Consultas a la base:** la base vive dentro de su contenedor,
así que se consulta con `bash plataforma/pruebas/pila.sh sql "CONSULTA;"` (o `pila.sh sql` a secas para
abrir la consola interactiva, que se cierra con `\q`).

## 1. El problema en una frase (1 min)

Sensores de distintos fabricantes, con distintos formatos y relojes poco confiables, y una plataforma que
debe recibirlos, validarlos, guardarlos como series de tiempo y avisar cuando algo anda mal, con menos de
2 GB de memoria. Mostrar `docker stats --no-stream` y **decir la suma en voz alta**: la plataforma completa
ronda los 120 MB en reposo (base ~60, backend ~50, broker ~8; medido el 27/09), frente al límite de 2 GB
de RNF-17 y a los 4 GB que el referente comercial pide solo para sí.

## 2. Una trama buena entra (2 min)

**Decir:** el contrato nativo es SenML (RFC 8428); el dispositivo publica en **su** tópico con **su**
credencial, y el broker no le deja publicar en el de otro.

```bash
bash plataforma/pruebas/publicar.sh temperatura '[{"bn":"dev-0001","n":"temperatura","u":"Cel","v":22.4}]'
```

(`publicar.sh` publica como `dev-0001` con QoS 1 y la clave de `CLAVE_DEV`; es el mismo `mosquitto_pub`
de siempre, con menos que teclear en vivo.)

**Ver:** terminal A → `dev-0001: 1/1 lecturas guardadas vía senml` («1/1» = una lectura de una en la
trama; «vía senml» = el adaptador que la entendió). Luego:

```bash
bash plataforma/pruebas/pila.sh sql "SELECT round(valor::numeric,2) AS valor, unidad, tiempo FROM medicion ORDER BY tiempo DESC LIMIT 1;"
```

## 3. Los seis filtros rechazan lo que no corresponde (2 min)

**Decir:** nada llega a las series sin pasar los seis filtros —1 autenticar, 2 analizar, 3 validar,
4 normalizar, 5 alertar, 6 supervisar—; lo rechazado se guarda crudo con su motivo.

| Publicar | Motivo esperado en `cuarentena` | Filtro |
|---|---|---|
| `abc` | `malformada` | 2 analizar |
| `500` | `invalida` · fuera de rango (la temperatura físicamente posible va de −40 a 85) | 3 validar |
| `{"v":300,"u":"K"}` | **no se rechaza:** se guarda 26,85 Cel | 4 normalizar |
| en `…/dev-0001/presion`: `1013` | `invalida` · canal no declarado | 3 validar |

Cada fila es `bash plataforma/pruebas/publicar.sh temperatura <carga>`; la última,
`bash plataforma/pruebas/publicar.sh presion 1013`. **La fila del JSON va entre comillas simples**, o la
terminal se come las llaves y las comillas y llega `v:300` (malformada, no la conversión; pasó en el ensayo del 29/09):

```bash
bash plataforma/pruebas/publicar.sh temperatura '{"v":300,"u":"K"}'
```

Luego, las tres rechazadas:

```bash
bash plataforma/pruebas/pila.sh sql "SELECT motivo, topico, left(convert_from(payload_crudo,'UTF8'),30) AS carga, recibido_en FROM cuarentena ORDER BY recibido_en DESC LIMIT 3;"
```

Y la que sí entró, convertida a la unidad canónica: `bash plataforma/pruebas/pila.sh sql "SELECT round(valor::numeric,2), unidad FROM medicion ORDER BY tiempo DESC LIMIT 1;"` → `26.85 | Cel`.

## 4. Alertas con histéresis y supervisión (2 min)

**Decir:** el rango físico (filtro 3) responde «¿es posible este valor?»; el umbral (filtro 5) responde
«¿es preocupante?», y lo configura quien administra el sitio. Aquí el umbral alto es 30 Cel con
histéresis 2: abre al cruzar 30 y cierra solo bajo 28, para que un valor que oscila en 30 no dispare y
apague la alerta una y otra vez.

| Publicar | Log del backend |
|---|---|
| `35` | `umbral alto cruzado (35 Cel) · condición abierta` |
| `29` | nada: zona de histéresis |
| `27` | `valor de vuelta en rango · condición cerrada` |

(Mismo comando: `bash plataforma/pruebas/publicar.sh temperatura 35`, luego `29`, luego `27`.)

**Decir:** el pipeline solo corre cuando llega algo; el silencio lo detecta un supervisor periódico.
Callar unos 15 s → `sin comunicación hace N s · condición abierta`; publicar de nuevo → `comunicación
restablecida · condición cerrada`. (En desarrollo el supervisor revisa cada 5 s, porque el sensor de la
demo reporta cada 5 s; en producción, con intervalos de minutos, cada 60 s: `docs/10 §4.1`.) Si el tiempo
no alcanza: `pila.sh sql "SELECT tipo, abierta_en, cerrada_en FROM condicion ORDER BY abierta_en DESC LIMIT 4;"`.

## 5. La API y su contrato (2 min)

**Decir:** el panel es de la Etapa 3; hoy lo que vería el cliente es esto, la API que el panel va a
consumir. Y el contrato OpenAPI se genera desde el código, así que no puede describir rutas que no existen.

En `/docs`:

1. `GET /dispositivos` → **Try it out** → **Execute**. Mostrar `estado`, `en_linea`, `condiciones_abiertas`
   y que todo instante termina en `Z`. Copiar el `id` que aparece dentro de `canales` (el UUID del canal
   de temperatura: un identificador único que la base asigna a cada canal).
2. `GET /canales/{id}/historico` → **Try it out** → pegar ese UUID en `id` → `intervalo = 1 hour` →
   **Execute**: promedios por hora calculados por la base en la zona horaria del sitio, en formato
   columnar para el gráfico.
3. Mismo endpoint con `id = abc` → `400` con el motivo: la API valida antes de tocar la base.

## 6. Cómo se sostiene esto (1 min)

- `cd plataforma/backend && pnpm verificar`: tipos, lint y 49 pruebas unitarias en menos de dos segundos
  (la cifra exacta la da la salida de `jest`; no la memorices). Los avisos de cuarentena que aparecen
  mientras corre son de las pruebas, a propósito.
- `bash plataforma/pruebas/verificar-todo.sh`: esquema, migraciones, diagramas del informe, API y
  seguridad en concordancia (corre también `pnpm verificar`).
- Las figuras del informe se generan desde la documentación y desde la base real: lo que se muestra es lo
  que está implementado.

## Hábitos para la demostración

- Decir «datos de prueba» **antes** de que aparezca un número en pantalla, no después.
- Decir «un solo dispositivo, publicado a mano»: la demo prueba el comportamiento, no la capacidad. La
  carga con muchos nodos es TT-28 (emulador) y TT-29 (≥ 50 eventos/s), en la Etapa 4.
- Ensayar en voz alta la frase difícil (qué pasa si cae la base) hasta que salga sin titubear.
- Tener lista la respuesta a «¿qué tan confiable es esto?» con el **límite real** (prototipo con un
  nodo, sin TLS aún, comparación con ThingsBoard pendiente para la Etapa 4), no con una defensa.
- Si preguntan «¿por qué solo tercera forma normal?»: más formas normales no es mejor por sí solo; cada una
  elimina un tipo específico de anomalía, y la 4FN y la 5FN resuelven dependencias multivaluadas o de reunión que
  aquí no existen. Normalizar más solo agregaría un JOIN a cada consulta (`docs/08 §6`).
- Si preguntan «¿cómo evitan duplicados si QoS 1 puede repetir?»: QoS 1 asegura que llega al menos una vez; la
  inserción idempotente (índice único canal + instante, `ON CONFLICT DO NOTHING`) ignora la repetición. El efecto
  es exactamente una vez con el costo de QoS 1; QoS 2 no bastaría, porque garantiza por salto y no de punta a
  punta (`docs/10 §4`).
- Si preguntan «¿y si la base se cae mientras funciona?»: contarlo, no evitarlo. Se probó apagando la
  base con la pila en contenedores; se encontró que el barrido de supervisión tumbaba el proceso entero,
  se corrigió (`docs/10 §4.1`), y se volvió a probar: cero reinicios, el sistema avisa y se recupera solo.
  Es evidencia de verificación real, no una promesa.

## Si algo falla en vivo

| Síntoma | Causa probable | Salida |
|---|---|---|
| `EADDRINUSE` al arrancar | backend huérfano | `ss -ltnp \| grep :3000` → `kill <pid>` |
| `Connection refused` a secas al publicar | pila abajo | `bash plataforma/pruebas/pila.sh encender` |
| `Connection Refused: not authorised` | la clave no calza con el broker | `bash plataforma/pruebas/clave-dispositivo.sh dev-0001` (fuera de escena) |
| `publicado`, pero nada en el log | tópico de otro dispositivo: la ACL lo descarta sin avisar al cliente | revisar que el tópico diga `dev-0001`; `publicar.sh` lo arma solo |
| Histórico vacío | rango por defecto: últimas 24 h | pasar `desde=` anterior a los datos |
| `/docs` responde 404 | falta `HTTP_DOCS=si` (solo pasa fuera de Docker) | ver el anexo de abajo |

## Anexo: desarrollar con recarga automática (no es para la demo)

Para **programar** el backend conviene correrlo directo en el portátil (`pnpm start:dev`): se recompila
solo cada vez que se guarda un archivo. La base y el broker siguen en Docker. Antes hay que detener el
backend del contenedor: dos backends chocan en el puerto 3000 y, peor, se echan mutuamente del broker
porque usan el mismo identificador MQTT (`docs/10 §6`). En este modo `/docs` necesita la línea
`HTTP_DOCS=si` en `plataforma/.env` (en Docker la fija el override de Compose).

```bash
docker compose -f plataforma/docker-compose.yml stop backend && cd plataforma/backend && pnpm start:dev
```
