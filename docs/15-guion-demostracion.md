# Guion de demostración (10 minutos)

> **Para qué:** mostrar el sistema funcionando ante el profesor guía o la comisión, de punta a punta, con
> salidas verificables. Se ejecuta desde la raíz del repositorio con la pila levantada. La clave del
> dispositivo de prueba sale del gestor de contraseñas local; **nunca** se escribe en el guion ni en el chat.
> Cada paso indica lo que se dice, lo que se ejecuta y lo que debe verse.

## 0. Antes de empezar (5 min, fuera de escena)

**Elegir un solo backend para no chocar en el puerto 3000: A (desarrollo, ve el código en vivo) o B
(contenedor, evidencia de que el Dockerfile funciona de verdad — mejor si preguntan por el despliegue).**

```bash
cd plataforma && docker compose up -d && docker compose ps          # timescaledb, mosquitto y (B) backend: healthy

# A) desarrollo — el backend corre fuera de Docker, ve cambios de código al vuelo
cd backend && pnpm start:dev                                        # terminal A: «API escuchando» y «suscrito a sitio/#»

# B) contenedor — usar SOLO si no se levantó con --build arriba; si ya está healthy, no hace falta nada más
docker compose up -d --build backend && docker compose ps           # «backend … healthy»

bash plataforma/pruebas/verificar-todo.sh                           # terminal B: TODO EN CONCORDANCIA
export CLAVE_DEV='…'                                                # terminal B: clave del dispositivo de prueba (gestor local)
```

Abrir en el navegador `http://127.0.0.1:3000/docs` y tener a mano `docker compose exec timescaledb psql -U plataforma -d plataforma`.

## 1. El problema en una frase (1 min)

Sensores de distintos fabricantes, con distintos formatos y relojes poco confiables, y una plataforma que
debe recibirlos, validarlos, guardarlos como series de tiempo y avisar cuando algo anda mal, con menos de
2 GB de memoria. Mostrar `docker stats --no-stream`: las dos piezas de infraestructura en reposo suman
decenas de MB.

## 2. Una trama buena entra (2 min)

**Decir:** el contrato nativo es SenML (RFC 8428); el dispositivo publica en su tópico con su credencial.

```bash
docker compose exec mosquitto mosquitto_pub -u dev-0001 -P "$CLAVE_DEV" -t sitio/uct/dispositivo/dev-0001/temperatura \
  -m '[{"bn":"dev-0001","n":"temperatura","u":"Cel","v":22.4}]'
```

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

- `pnpm verificar`: tipos, lint y 29 pruebas unitarias en menos de dos segundos (la cifra exacta la da la salida de `jest`; no la memorices).
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
| `Connection refused` en mosquitto_pub | pila abajo | `docker compose up -d` |
| Nada en el log al publicar | credencial o tópico mal | revisar `-u`, `-t`; el broker rechaza sin avisar al cliente |
| Histórico vacío | rango por defecto: últimas 24 h | pasar `desde=` anterior a los datos |
