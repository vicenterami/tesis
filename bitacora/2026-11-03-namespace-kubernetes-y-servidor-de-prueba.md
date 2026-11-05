# 03–04/11/2026 — Un namespace de Kubernetes, un servidor de prueba compartido y la plataforma operando en la red del campus

**Contexto.** El martes 03/11 la universidad no entregó el equipo planeado el 01/11, sino acceso a un namespace de Kubernetes para
estudiantes; después apareció además un equipo en la red del campus, compartido con permiso de su responsable. El día en el
campus se dedicó a medir qué permite cada entorno antes de diseñar nada; después, desde casa, a levantar la plataforma en el PC por la red
privada de administración, verificarla de extremo a extremo y dejarla respaldada. El repositorio se hizo público ese día, tras verificar en un
clon limpio que no contiene datos personales ni del entorno.

## 1. El namespace de Kubernetes: 17 pruebas antes de diseñar
Con `kubectl` y el complemento de inicio de sesión verificados por huella, un reconocimiento de solo lectura y pruebas reales con recursos
etiquetados (todo borrado al terminar) dejaron esto medido:
- **Cabe:** cuota de 2 CPU y 2 G de memoria en total y 500m / 512 Mi por contenedor; la pila mide 193 MiB en reposo y 324 MiB en pico
  (`docs/14 §2`). Permisos completos sobre cargas, servicios, volúmenes, secretos y roles; perfil de seguridad de pods **baseline** (nuestros
  manifiestos van en **restricted** y pasan la admisión); los pods ejecutan en nodos reales, bajan imágenes públicas y salen a Internet; DNS y
  balanceo internos; `port-forward` funciona desde fuera del campus (administración sin exponer nada).
- **No cabe hoy:** ninguna puerta de entrada (un Service LoadBalancer queda pendiente, no hay clase de Ingress, y los NodePort viven en una red
  privada que ni la red del campus enruta: medido desde la red de la pasarela, tiempo agotado), ni volúmenes persistentes (la cuota propia admite
  tres, pero una cuota global compartida por todos los estudiantes estaba llena), ni métricas para el usuario.
- **Sí llega:** desde un pod se alcanza la pasarela LoRaWAN por su interfaz del lado del campus. La dirección viable de las conexiones es clúster →
  campus, no al revés.
Conclusión: el namespace sirve como entorno de desarrollo y como diseño B de `docs/14 §6`; para operar hace falta que el administrador conceda
una dirección de entrada y cupo de volúmenes. La petición se redactó con la evidencia textual. Decisión del autor: el sistema funciona como está
diseñado (la pasarela publica directo al broker del sistema por 8883); no se adoptan rodeos como puentes a brokers ajenos.

## 2. El equipo compartido: aceptado con reglas
El PC ya tenía responsable, un servicio de otro proyecto y SSH solo con llave. La lista de aceptación de `docs/14 §7.1`
se aplicó con una diferencia: los usuarios y servicios ajenos **se explicaron** por su responsable, presente, y el equipo se acepta como
**compartido**. Reglas que siguen: un usuario propio con lo mínimo acordado, la llave del portátil instalada (SSH no admite contraseñas), nada del anfitrión se toca (cortafuegos, demonio de Docker, parches: son del responsable), ningún comando
sobre contenedores ajenos, y cada cambio avisado el mismo día. El clon del repositorio es anónimo (repositorio público): puede actualizar, no
puede empujar. Administración solo por la red privada cifrada (`docs/11 §8` fila 1): llave del servidor sin expiración, nombres de la red
activados, aprobación manual de equipos; probado desde una red ajena al campus.

## 3. La plataforma levantada (`docs/14 §7`, orden 5 y 6)
CA propia del servidor de prueba creada en el portátil (clave fuera de todo repositorio), certificado con las direcciones y el nombre que usarán
los clientes, válido hasta diciembre de 2027; `.env` de producción con siete secretos generados en el servidor y `COMPOSE_FILE` sin el override
de desarrollo (verificado: solo 443 y 80 en la dirección de la red privada y 8883 en todas); construcción en 3 min 24 s; inicialización del broker
con sus roles; la clave del rol de aplicación de la base la fija `base-rol-app.sh` (sin ese paso el backend queda `unhealthy` y el proxy, que
espera a un backend sano, no arranca: es la señal correcta); `/salud` con 18 tablas y `/docs` cerrado; panel con candado por el nombre de la red
privada; sitio, zona, la pasarela del campus con su credencial y los dos nodos del compañero dados de alta por su DevEUI (la vía `lorawan` no
lleva credencial propia: la autentica su pasarela).

## 4. Verificado en ejecución (04/11)
| Afirmación | Prueba | Resultado |
|---|---|---|
| MQTT directo con TLS verificado | `mosquitto_pub --cafile` desde el portátil por la red privada | `PUBACK RC:0`; lectura en el panel |
| HTTPS con token y SenML | `POST /recepcion/<id>` | `202`, `guardadas: 1`; lectura en el panel |
| Sin credencial / credencial incorrecta | `mosquitto_pub` | rechazadas; el broker registra «not authorised» (2) |
| Sin TLS al 8883 | `mosquitto_pub` sin `--cafile` | `Protocol error` |
| Sin token / token falso | `POST` | `401` y `401` |
| Solo los puertos del contrato | `nc` a 22, 80, 443, 1883, 3000, 5432, 8883 | 1883, 3000 y 5432 rechazados; 22, 80 y 443 solo por la red privada; 8883 en todas |
| TLS 1.1 fuera, 1.2 negocia | `openssl s_client` | rechazado / `TLSv1.2` |
| La baja invalida la credencial | `DELETE /dispositivos/<id>` | ambos «Inactivo» |
| La pila vuelve sola | `docker compose restart` | 4/4 `healthy` en ≈ 60 s |
| Respaldo y restauración | `pg_dump -Fc` + `pg_restore` en una base de prueba | 2 = 2 mediciones; temporizador diario activo; copia fuera del servidor |
| Clave de la CA cifrada | `ca-desarrollo.sh` con `CA_FRASE` | reemisión correcta; la clave en claro ya no existe |

## 5. Lo que no cubre y lo pedido
Sin puerta desde Internet (depende de un reenvío de puerto que se pidió a la universidad, con un nombre DNS si es posible) y sin reinicio del
equipo probado (se hace con su responsable). El latido del vigilante externo (`docs/14 §7.2`) queda para el día siguiente.

## 6. Lecciones
- Medir antes de diseñar: una tarde de pruebas baratas y borrables dijo exactamente qué pedir y a quién.
- Una conexión tiene dirección: sin dirección de entrada nadie llega; las puertas y el disco se conceden, no se configuran.
- Un secreto nunca viaja como argumento de `sh -c`: si el comando falla, el shell lo imprime. Va por variable de entorno o por `read -rs`.
- Una variable vive en una sola terminal; antes de cada comando se mira el prompt. Una respuesta vacía de una API es un error escondido por el
  filtro: se pide la respuesta completa.
- Un bloque pensado para una distribución y ejecutado en otra puede dejar archivos vacíos; descargar a un temporal y comprobar antes de instalar.
- El reloj del servidor en UTC: la hora de «último acceso» que muestra el sistema se convierte a la hora local antes de alarmarse.
- Las credenciales de prueba que se muestran por pantalla se invalidan en el acto; los dispositivos de prueba se dan de baja al terminar.

## 7. Qué sigue
Petición a la universidad (dirección de entrada); latido del vigilante; tramas reales de la pasarela cuando su responsable la apunte al servidor;
reinicio del equipo con el responsable; `desplegar.sh` para dejar la instalación en un paso; presentación de la Etapa 3 el 05/11.
