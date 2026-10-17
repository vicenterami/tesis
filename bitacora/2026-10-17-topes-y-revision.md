# 17/10/2026 — Topes por emisor, dirección del cliente y revisión del día anterior

**Contexto.** El 16/10 se cerró la recepción por HTTP (HU-01) y su revisión dejó tres límites escritos en `docs/10 §8.4` punto 52 (vii):
el bloqueo por dirección castigaba a los vecinos de un NAT, la cuarentena no tenía cuota por dispositivo y el backend confiaba en toda
dirección de red privada para creer `X-Forwarded-For`. El 17/10 se decidieron y se construyeron las tres respuestas, con el diseño
escrito antes que el código, y se revisó de nuevo todo lo hecho el 16/10.

## Decisiones (docs/10 §8.4 puntos 52 y 53)

1. **Bloqueo por par dirección + dispositivo** (5 fallos en 60 s → 60 s) y un **tope grueso por dirección** (50 fallos en 60 s) que solo
   frena las verificaciones con `scrypt`: el vecino con su token bueno sigue entrando. Se descartó bloquear por dispositivo solo, porque
   cualquiera podría dejar fuera a un sensor ajeno con su identificador.
2. **Tope por emisor en todas las vías**, dentro del tramo del pipeline por el que pasan las tres (`filtros2a6`): presupuesto de lecturas
   por hora (`max(600, 10 × canales × ⌈3600/intervalo⌉)`), la trama que no cabe se rechaza entera (cuarentena `tope`, condición
   `tope_superado`), cuota de 60 tramas en cuarentena por dispositivo y hora (las demás solo se cuentan), contadores persistentes en
   `estado_dispositivo` (migración 19), y una regla que el guardián hace cumplir: las vías que `docs/11 §3` declara con tope son las que
   entran por ese tramo.
3. **Secreto compartido proxy ↔ backend** (`X-Proxy-Secreto`, `PROXY_SECRETO`) en vez de una IP fija del proxy: una IP fija choca con
   el banco (dos pilas sobre el mismo compose, sin subred fijada) y la suplantación dentro de la red de Docker exige `NET_RAW`, que
   desde hoy sueltan los cuatro contenedores (`cap_drop`); con eso el secreto no puede leerse en tránsito desde otro contenedor.
4. **Caché de verificaciones** en la vía HTTP: un token ya verificado contra la misma huella no vuelve a pagar `scrypt` (65 ms); una
   rotación cambia la huella y la entrada deja de servir sola; un token equivocado cuesta lo mismo que antes.

## Revisión del 16/10 (revisión independiente; cada hallazgo verificado antes de corregir)

- **Contador de trama LoRaWAN:** el `fCnt` 0 se comparaba con el último guardado y una re-unión del nodo perdía su primera trama; y
  ChirpStack omite el 0 en su JSON, con lo que el contador de la sesión anterior sobrevivía y hacía descartar la trama 1 de la nueva.
  Regla corregida en `docs/10 §4.1`: el 0 y el ausente no se comparan; una trama guardada sin contador lo borra; y el contador avanza
  también cuando la reentrega del broker encuentra las lecturas ya guardadas.
- **Licencias del firmware:** OneWire trae además el aviso de Dallas Semiconductor con una cláusula de nombre; Unified Sensor es
  copyright de The Android Open Source Project; las cabeceras del SDK del núcleo mezclan seis identificadores. Todo en
  `plataforma/firmware/AVISOS-DE-TERCEROS.md`. La cita de la FSF sobre la LGPL-2.1 quedó verificada y descargada.
- **Cifras y textos:** un conteo escrito a mano en la prueba de humo (12 rutas, 15 operaciones) quedó atrás con la ruta nueva; se
  corrigió y se fijó la regla: un número que se repite se deriva de la fuente o se cita en un solo lugar. Erratas, un README con
  pendientes ya hechos, la frase «sin avisos» del firmware (la biblioteca OneWire emite dos del preprocesador, ajenos y sin efecto) y
  las marcas de tiempo de la captura real, reemplazadas por sintéticas.

## Verificado

Backend: tipos, lint y 324 pruebas unitarias; panel: 52. Banco: `http` (topes nuevos y secreto del proxy), `tope` (601 lecturas
contra 600 → 422, cuarentena y condición; 62 tramas malformadas por MQTT → 60 guardadas y 2 contadas; cierre de la condición en la hora
siguiente), `lorawan`, `puente`, `puente ip` y `alta` en verde con los cuatro contenedores sin `NET_RAW`. Fallas plantadas hoy: catorce, cada una detectada por su prueba; las diez de la vía HTTP del 16/10 siguen en `docs/16 §41`.

**Revisión de cierre del día** (tres miradas independientes; hallazgos verificados y, los de lógica, reproducidos): la cuota de
cuarentena no se aplicaba a las tramas de pasarela sin DevEUI verificable; la condición `tope_superado` podía quedar abierta si la hora
nueva empezaba sin lecturas; las lecturas inválidas no consumían presupuesto; dos tramas HTTP solapadas leían la misma foto; una
dirección bloqueada seguía consultando la base; sin `PROXY_SECRETO` un externo podía bloquear a cualquier dispositivo. Todo corregido
el mismo día, con su prueba y su falla plantada (`docs/16 §42`). Detalle en `docs/16 §42`.
