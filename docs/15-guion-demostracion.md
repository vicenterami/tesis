# Guion de demostración (10 minutos)

> **Para qué:** mostrar el sistema funcionando ante el profesor guía o la comisión, de punta a punta, con
> salidas verificables. Se ejecuta desde la raíz del repositorio con la pila levantada. La clave del
> dispositivo de prueba sale del gestor de contraseñas local; **nunca** se escribe en el guion ni en el chat.
> Cada paso indica lo que se dice, lo que se ejecuta y lo que debe verse.

## 0. Antes de empezar (5 min, fuera de escena)

**Camino normal: todo en Docker.** Es la misma forma que se despliega en el servidor y demuestra que
la imagen del backend funciona de verdad. Desde la raíz del repositorio:

```bash
bash plataforma/pruebas/pila.sh encender      # construye, levanta, espera «healthy» y muestra el estado
bash plataforma/pruebas/semilla-demo.sh       # datos del guion (idempotente): SEMILLA LISTA
bash plataforma/pruebas/verificar-todo.sh     # TODO EN CONCORDANCIA
bash plataforma/pruebas/pila.sh logs          # terminal A: registros en vivo, y copia en privado/logs/
read -rs CLAVE_DEV && export CLAVE_DEV        # terminal B: pegar la clave de dev-0001 desde el gestor (no se ve)
```

Si la clave de `dev-0001` no está en el gestor o no calza (`not authorised` al publicar), se crea una
nueva en un paso: `bash plataforma/pruebas/clave-dispositivo.sh dev-0001` (pide la clave oculta,
reinicia el broker y verifica que autentica; `docs/11 §7`). Hacerlo **antes** de la demostración: el
reinicio del broker corta la conexión del backend unos segundos.

**Solo si vas a cambiar código en vivo (opcional):** el backend corre en el portátil con recarga
automática y la base y el broker siguen en Docker. Antes hay que detener el backend del contenedor:
dos backends chocan en el puerto 3000 y, peor, se echan mutuamente del broker porque usan el mismo
identificador MQTT (`docs/10 §6`). En este modo `/docs` necesita la línea `HTTP_DOCS=si` en
`plataforma/.env`; en el camino normal no hace falta, la fija el override de Compose.

```bash
docker compose -f plataforma/docker-compose.yml stop backend && cd plataforma/backend && pnpm start:dev
```

Abrir en el navegador `http://127.0.0.1:3000/docs` y tener a mano `docker compose exec timescaledb psql -U plataforma -d plataforma`.

**Datos de la demostración en un solo paso** (idempotente; el resultado esperado está en la cabecera del
archivo): `bash plataforma/pruebas/semilla-demo.sh` carga sitio, zona, `dev-0001`, su canal de temperatura
y la regla de umbral, y verifica que quedaron. Reemplaza los `INSERT` a mano del README del backend.

## 1. El problema en una frase (1 min)

Sensores de distintos fabricantes, con distintos formatos y relojes poco confiables, y una plataforma que
debe recibirlos, validarlos, guardarlos como series de tiempo y avisar cuando algo anda mal, con menos de
2 GB de memoria. Mostrar `docker stats --no-stream`: las dos piezas de infraestructura en reposo suman
decenas de MB.

## 2. Una trama buena entra (2 min)

**Decir:** el contrato nativo es SenML (RFC 8428); el dispositivo publica en su tópico con su credencial.

```bash
bash plataforma/pruebas/publicar.sh temperatura '[{"bn":"dev-0001","n":"temperatura","u":"Cel","v":22.4}]'
```

(`publicar.sh` publica como `dev-0001` con QoS 1 y la clave de `CLAVE_DEV`; es el mismo `mosquitto_pub`
de siempre, con menos que teclear en vivo.)

**Ver:** terminal A → `dev-0001: 1/1 lecturas guardadas vía senml`. Luego, en psql:

```sql
SELECT tiempo, valor, unidad FROM medicion ORDER BY tiempo DESC LIMIT 1;
```

## 3. Los seis filtros rechazan lo que no corresponde (2 min)

**Decir:** nada llega a las series sin pasar los seis filtros; lo rechazado se guarda crudo con su motivo.

| Publicar | Motivo esperado en `cuarentena` | Filtro |
|---|---|---|
| `abc` | `malformada` | 2 analizar |
| `500` | `invalida` · fuera de rango | 3 validar |
| `{"v":300,"u":"K"}` | **no se rechaza:** se guarda 26,85 Cel | 4 normalizar |
| en `…/dev-0001/presion`: `1013` | `invalida` · canal no declarado | 3 validar |

Cada fila es `bash plataforma/pruebas/publicar.sh temperatura <carga>`; la última,
`bash plataforma/pruebas/publicar.sh presion 1013`.

```sql
SELECT motivo, topico, left(convert_from(payload_crudo,'UTF8'),30) AS carga, recibido_en FROM cuarentena ORDER BY recibido_en DESC LIMIT 4;
```

## 4. Alertas con histéresis y supervisión (2 min)

**Decir:** el umbral alto es 30 Cel con histéresis 2: abre al cruzar 30, cierra solo bajo 28.

| Publicar | Log del backend |
|---|---|
| `35` | `umbral alto cruzado (35 Cel) · condición abierta` |
| `29` | nada: zona de histéresis |
| `27` | `valor de vuelta en rango · condición cerrada` |

(Mismo comando: `bash plataforma/pruebas/publicar.sh temperatura 35`, luego `29`, luego `27`.)

**Decir:** el pipeline solo corre cuando llega algo; el silencio lo detecta un supervisor periódico. Si el
tiempo alcanza: callar y esperar el barrido → `sin comunicación hace N s · condición abierta`; publicar de
nuevo → `comunicación restablecida`. Si no alcanza, mostrar la tabla `condicion` con una abierta y otra cerrada de antes.

## 5. La API y su contrato (2 min)

En `/docs`: ejecutar `GET /dispositivos` (estado, `en_linea`, condiciones abiertas) y
`GET /canales/{id}/historico` con `intervalo=1 hour` (promedios calculados por la base en la zona del sitio,
formato columnar para el gráfico). Mostrar que un UUID inválido devuelve `400` con el motivo, y que todo
instante termina en `Z`.

**Decir:** el contrato OpenAPI se genera desde el código, así que no puede describir rutas que no existen.

## 6. Cómo se sostiene esto (1 min)

- `pnpm verificar`: tipos, lint y 49 pruebas unitarias en menos de dos segundos (la cifra exacta la da la salida de `jest`; no la memorices).
- `verificar-todo.sh`: esquema, migraciones, diagramas del informe y API en concordancia.
- Las figuras del informe se generan desde la documentación y desde la base real: lo que se muestra es lo que está implementado.

## Tres hábitos para la demostración

- Decir «datos de prueba» **antes** de que aparezca un número en pantalla, no después.
- Ensayar en voz alta la frase difícil (qué pasa si cae la base) hasta que salga sin titubear.
- Tener lista la respuesta a «¿qué tan confiable es esto?» con el **límite real** (prototipo con un
  nodo, sin TLS aún, comparación con ThingsBoard pendiente para la Etapa 4), no con una defensa.
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
