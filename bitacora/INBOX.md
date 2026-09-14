# Bandeja de entrada

> Notas capturadas desde cualquier dispositivo. Se agregan líneas sueltas y se vacían
> procesándolas hacia su documento definitivo. Editable desde la app de GitHub en el teléfono.

- 
# Lectura crítica del borrador de la Etapa 2 (mis notas, no se versiona)

Leer `privado/previsualizaciones/informe-borrador.pdf` de corrido, sin corregir nada todavía.
Por cada capítulo anotar tres columnas. Vale poner «nada» si no hay.

| Cap. | No entiendo / no me lo creo yo mismo | No me convence (argumento flojo, dato sin fuente) | Falta (algo que hicimos y no está) |
|---|---|---|---|
| Resumen | | | |
| 1 Introducción y problema | | | |
| 2 Antecedentes | | | |
| 3 Requerimientos | |cual se supone que es la gracia, que el problema de la segmentacion de tramas de sensores, yo lo paso a SenML la tesis se enfocaria mas que nada en esos filtros? no es muy basico, como manejaremos las pruebas vs thingsboard?, como es qu es la seguridad, como se usan los bucket esos de timescale, es lo mejor para sensores guardar esos indices de secciones de tiempo? porq utilizabamos nestJS no recuerdo que es eso no es node verdad? | |
| 4 Diseño: contenedores | | aca en capitulo 4 esta de mas que digas como generamos las figuras, en diseño de plaraforma de que guion me hablas? super bien que todo este en orden tipo todo en concordancia pero tambien para el informe siñete a la rubrica ok. en la figura 4.1 donde quedaron los demas m y que eran esos m1,m2,m3,m4,m5,m6...
como se maneja y que era eso de se recibe 1 vez, se recibe al menos 1 vez de chirpstack, en el backend hay algo asi o parecido o si un sensir hay por ejemplo 2 sensores cerca y detectan ambos 1 anomalia ambos detectan? como manejamos la calidad del servicio?, si se mencionaban las opciones de como se manejan las ( la base de datos y el servidor
de red LoRaWAN no se exponen. Segundo, el navegador nunca se
conecta al broker: consume la API del backend, que ya autenticó, validó
y normalizó cada trama. La alternativa —suscribir el navegador al
broker por WebSocket— habría expuesto el broker a Internet y puesto
credenciales MQTT en el código del cliente. Tercero, ChirpStack es un
productor más hacia el broker: una trama LoRaWAN decodificada y una
trama Wi-Fi directa son indistinguibles para la plataforma después delCAPÍTULO 4. DISEÑO DE LA PLATAFORMA 16
filtro de análisis, que es lo que resuelve la causa C2 (hardware atado a la
plataforma). ) explicame mas a fondo y actualiza o enfatizalo mas en alguna parte para comprederlo mejor, quetan viable es usar redis con igual dockerizado para cargas de trabajo en caso de volumenes mas masivos, como se encolaria el trabajo, cambiaria el modelo a una parte en la base de datos de notificacion y deberia algun websocket tener siempre una comunicacion con este canal de notificacion de timescale/pg_notification? BD seria el mensajero, que tanto cambiaria la estructura esto? clmo se manejaria estas colas de trabajo , si los trabajos son asincronicos que tiempo manda el del sensor o como era el lapsoso de hasta aca manda sensor y para aca manda de donde la platafirma recibio la trama?, es vuable encolar con eedis? que cambiaria que mas hay q pensar? que es el aprovisionamiento q no lo veo, | |
| 4 Diseño: modelo de datos | que significa por q la medicion cuelga del canal?, como es que funcionaban y como simbolizaste laz relaciones en la tabla? hasta que forma normal esta normalizado esto? quieto lo mas normalizado, eficiente, atomizado, mejor para esto y explical el porque, veo algunas tablas intermedias pero quiero que profundices aun mas en ello ok.  | | |
| 4 Diseño: red y seguridad |que tan factible es algun balanceador de carga en caso de contar con mas de 1 servidor pero siempre evaluando costos, que tipo de api de sesion/ autenticacion es viable , todo deberia mandarse con tls eso esta contemplado?, sobre todo igual queria evaluar las api gateway y como manejaremos que los usuarios pidan data supongo y como funcionaran sus sesiones por ahora supongo con jwt y sobre todo que sean idempotentes y eficientes las consultas y co.o manejar el rate limiter para q un bot no me tire en servidores con denegacion de sercios | | |
| 4 Diseño: comportamiento (3 secuencias) | de aqui para abjo no alcance a leer eao por ahora, co.o siempre si es posible sin perder el foco de lo i.portante y crear por prioridad y en pos de englobar los requerimientos planteados| | |
| 4 Diseño: tiempo | | | |
| 4 Diseño: despliegue y costos | | | |
| 5 Metodología y seguimiento | | | |
| Conclusión | | | |
| Anexos | | | |

## Preguntas que me haría un profesor (responder en una frase cada una; si no puedo, es un hueco)
- ¿Por qué MQTT y no HTTP como entrada principal?  Porque Mosquitto mqtt el broker usa el modelo de publicar y suscribir el cual es lo mejor por alguna razon esta especializado para sensores, los clientes solo se suscriben a algun sensor o sector y les llegan las tramas por el cliente/api
- ¿Por qué SenML y no un JSON propio?  Un SenML porque es el estandar abierto que se usa globalmente supongo y es uno de los motivos es estanfarizar y no fragmentar aun mas como se procesan las tramas, no reinventar la rueda
- ¿Por qué TimescaleDB y no PostgreSQL a secas o InfluxDB? Aca se supone que es porque tiene una funcion llamada bucket() que es buena pero desconozco mas a fondo porque aparte que es un a libreria que vive sobre postgre entonces es buena por alguna razon se me olvido porque era mejor que las otras opciones
- ¿Por qué seis filtros y en ese orden? Nose
- ¿Qué pasa si el broker se cae? ¿Y si se cae la base? Si el broker se cae se vuelve a levantar automaticamente, lo mismo la base pues vivira en docker como servicio
- ¿Cómo sé que el diseño «cumple estándares»? (C4, UML, ER, 42010, OpenAPI, ISO 8601: ¿dónde se ve cada uno?)  C4 creo era contenedores, uml son los diagramas de datos, entidad relacion es por la base de datos relacional, 42010 nose, openapi la api que se abre, iso nose supongo tiene q ver con utc.
- ¿Qué parte es mía y qué parte es del compañero? Mia desde el broker y chirpstack desde filtros hasta ofrecer el servicio abierto.
- ¿Cuánto cuesta operarlo al mes y por qué esa opción? De 5 a 100 usd supongo
- ¿Qué haría distinto si empezara de nuevo?
Nose
## Erratas y forma (página · texto · corrección)
-
