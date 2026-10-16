# Bloqueo de fila sin frenar las tramas y diseño de la recepción LoRaWAN por formato declarado — 15 de octubre de 2026

- **Sesión de trabajo individual.** Se corrigió un bloqueo de fila que frenaba la recepción durante la baja o la
  rotación de un dispositivo, se verificaron en las fuentes oficiales los formatos que publican ChirpStack v4 y el servidor de red
  embebido de la pasarela Milesight UG63, y con eso se escribió el diseño de la recepción LoRaWAN por las rutas B y C antes del código.
  Lo medido está en `docs/16 §26`; el diseño, en `docs/10 §8.4` punto 47.

## Bloqueo de fila: `FOR NO KEY UPDATE`
- La baja y la rotación tomaban la fila del dispositivo con `FOR UPDATE` mientras la transacción esperaba la respuesta del broker. Toda
  trama o evento de ese dispositivo apunta a esa fila por clave foránea y quedaba esperando; como la recepción procesa un mensaje a la
  vez, esperaban las de todos los dispositivos.
- Medido con dos sesiones contra la base de desarrollo, todo con `ROLLBACK`, con un guion que mide el tiempo dentro de la base
  (`plataforma/pruebas/medir-bloqueo-fila.sh`): con `FOR UPDATE` una trama hija esperó y se canceló a los 1 020 ms; con
  `FOR NO KEY UPDATE` entró en unos 20 ms. La primera medición, a mano, sumaba el arranque del contenedor y dio 1 069 y 68 ms. El
  guion y las pruebas de baja y rotación fallan si el código vuelve al modo anterior.

## Red del campus y fuentes oficiales
- El compañero a cargo de la red LoRaWAN ofreció reenviar los datos desde el servidor de red interno de su pasarela para una prueba y
  preguntó si el sistema sale a Internet. Hoy nada está expuesto: los tres contenedores escuchan solo en la interfaz local y el proxy
  con TLS, probado en el banco, no corre en la pila de desarrollo. La prueba se hará en la misma red local, por el 8883 del proxy con TLS, la semana del 20/10 y el
  despliegue continuo depende de una máquina en la red del campus, que se pedirá en persona al profesor guía.
- Verificado en la guía de la UG63: un solo tipo de destino de reenvío (activar el servidor embebido deja de alimentar su ChirpStack),
  y el servidor embebido publica por MQTT con usuario, clave y TLS con una CA propia. Verificado en ChirpStack v4: el evento `up` se
  publica en JSON con nombres en camelCase, el objeto decodificado existe solo si el perfil tiene decodificador, y la integración se
  suscribe a su tópico de comandos aunque nadie le mande nada. Las fuentes quedaron descargadas fuera del repositorio.

## Diseño antes del código (`docs/10 §8.4` punto 47)
- Un solo tópico de pasarela para las rutas B y C, con el DevEUI del nodo en el tópico y en el cuerpo; solo el evento `up` entra al
  pipeline. El formato lo declara la pasarela al registrarse por API y sus nodos lo heredan; el filtro 2 usa el formato declarado para
  todos los dispositivos y deja de probar adaptadores en orden.
- Las claves del JSON decodificado se traducen a magnitudes con un mapa que hoy vive en el código detrás de una sola función; pasa al
  catálogo de magnitudes cuando el panel lo administre (Etapa 4), sin tocar los adaptadores. `rssi` y `snr` quedan en la trama cruda.
- La hora de una trama LoRaWAN la pone el servidor de red: la de ChirpStack lleva zona y se acepta; la de la pasarela Milesight llega
  sin zona y se descarta hasta verificarla en terreno (`docs/13`, regla 17).
- Regla general aplicada: el candado del padre no debe frenar a quien solo lo referencia; y una fuente verificada se
  guarda el mismo día.
- El guardián que compara las rutas citadas en la prosa con las que sirve la API acepta ahora una ruta marcada «(ruta prevista)» y
  exige quitar la marca en cuanto la ruta existe: la excepción se vacía sola. Probado plantando una marca vencida y una ruta inexistente.

## Dos revisiones del bloque terminado (`docs/16 §33–§34`)
- Sin identidad verificada no hay señal de vida: por el tópico de una pasarela, un cuerpo con otro DevEUI, sin DevEUI o ilegible va a
  cuarentena y no marca vivo al nodo.
- Un mensaje retenido se procesa una vez; la copia que el broker reentrega al reconectar se descarta. Se evaluó prohibir la retención en
  el broker y se descartó: el código de Mosquitto muestra que también dejaría sin retener sus propios contadores, de los que depende la
  alarma de la cola. Lección: antes de cambiar una opción global, buscar en el código fuente todo lo que la lee.
- Lo que se medía a mano (corte de sesión al rotar y al dar de baja, retenidos) pasó al banco, y cada comprobación nueva se probó
  plantando la falla.

## Informe de la Etapa 3: capítulo de pruebas (TT-36)
- Capítulo nuevo «Implementación y pruebas iniciales»: estado por módulo, método en cuatro niveles, resultados por requisito,
  lo que las pruebas cambiaron del diseño, validación preliminar y limitaciones; y un anexo con cada prueba y cómo repetirla.
- Para hacerle espacio sin pasar de 30 páginas: el tiempo, el alojamiento y la trazabilidad pasaron al anexo de evaluación, y
  los cuadros de retroalimentación de las Etapas 1 y 2, al de seguimiento, que suma el cuadro de la Etapa 3. Medido después de
  cada cambio: 27 páginas tras las mudanzas, 32 con el primer borrador del capítulo (dos cuadros fijos dejaban medias páginas
  vacías) y 30 al compactarlo.
- Al día: seguimiento, retroalimentación con la entrevista del 5/10, riesgos, conclusiones y resumen. El guardián compara con
  sus fuentes las cifras que el informe repite: avance, cuadro de la Etapa 3 y conteo del banco.
- Revisado el capítulo con el resto del bloque (`docs/16 §35`): el DevEUI del cuerpo y los segmentos del tópico se limpian antes
  de ir al registro, el banco toma como evidencia de una sesión el registro del broker, y las conclusiones separan lo que se cumple
  de lo parcial. El guardián, al sumar un paso, detectó que el informe citaba un número de pasos ya viejo.

## Pendientes
- [x] Migración 15, despacho por formato, adaptadores `chirpstack` y `milesight`, pasarelas por API y `banco.sh lorawan` (`docs/16 §28–§34`);
  el emulador sigue sin publicar LoRaWAN: el banco usa el JSON de las fuentes oficiales.
- [ ] Laboratorio de la prueba en la misma red local (por el 8883 del proxy, con TLS): escrito; falta ensayarlo antes de la prueba.
- [x] Capítulo de pruebas del informe (falta la versión de entrega: retroalimentación de la Etapa 2 y entrevista en el catálogo).
- [ ] Mapa de claves al catálogo de magnitudes (Etapa 4, obligatorio).

## Respuestas del compañero a cargo de la red LoRaWAN (15/10)
- La pasarela es una UG65 con el servidor de red embebido y un decodificador cargado; dos nodos reportan cada 60 s temperatura,
  humedad y batería; él administra un Mosquitto y un ChirpStack v4 propios. Mario decidirá si ChirpStack sigue.
- Prueba acordada para el martes 20/10 en la misma red local de la facultad. Camino elegido: un puente desde su broker hacia el
  nuestro por 8883 con TLS, autenticado como la pasarela, para que sus datos sigan llegando a su panel y a nosotros una copia. Se
  descartó un broker público de un proveedor (sin autenticación) y, por ahora, un envío HTTP a una dirección pública que no existe.
- La forma del mensaje que describió primero difería de la guía del fabricante y de su propio mensaje anterior; la captura real, pedida ese mismo día, mostró una tercera: la pasarela publica la trama binaria sin decodificar, con marca de tiempo UTC con zona (la regla 17 de `docs/13` decía que venía sin zona: corregida). Antes del martes: decodificación por perfil de dispositivo y sufijo nativo en el tópico de pasarela (`docs/10 §8.4` punto 47, nota del 15/10). Lección: un mensaje escrito en un chat no es una captura; se decide contra la salida literal del broker.
- Su panel mostraba cada trama dos veces y la misma calidad de señal en todas: resultó una doble suscripción de su cliente y un valor por defecto de su script, ya corregidos por él. Aun así se decidió (16/10) deduplicar también por el contador de trama de LoRaWAN, que protege cuando una trama repetida llega con otra hora: migración 17 prevista.
- El verificador que impide citar una migración antes de que exista no aplicaba su excepción para el diseño escrito antes del código: buscaba la marca en el texto ya recortado. Corregido y probado plantando una cita sin la marca.
