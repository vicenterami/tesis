# Respuesta del compañero sobre sensores y tramas — 10 de septiembre de 2026

- **Con:** Eduardo M., compañero de tesis (trabajos separados y coordinados)
- **Medio:** mensajería; registro del acuerdo técnico, no de la conversación.

## 1. Lo informado

| Pregunta | Respuesta |
|---|---|
| Sensores y magnitudes del primer nodo | Por evaluar, pero **temperatura y material particulado** (fijo, generalmente) |
| Nombres exactos de los campos del JSON | Pendiente: los definirá con el firmware |
| ¿Incluye la unidad? | Pendiente |
| Primeras tramas publicadas | **Etapa 3, octubre de 2026** |

También ofreció revisar el informe; el profesor guía aún no ha respondido el correo con el borrador.

## 2. Decisiones derivadas

1. El catálogo de magnitudes incorpora **PM2,5 y PM10** (`ug/m3`, rangos 0–1000 y 0–2000) en la
   migración 05, además de temperatura, que ya existía.
2. El adaptador de su formato **se cierra en la Etapa 3**, con la primera trama real. Hasta entonces la
   Etapa 2 se valida con el emulador de nodo y el adaptador plano de nombres tolerantes (HU-04 parcial).
3. El primer nodo mide una magnitud ambiental sensible al tiempo de exposición (material particulado):
   refuerza la decisión de agregar por intervalos en la zona del sitio (`docs/13`) y de conservar la
   trama cruda en cuarentena para auditoría.
