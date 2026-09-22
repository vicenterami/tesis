# Instrumentos de levantamiento

> **Para qué sirve:** guion operativo para las entrevistas con la organización destinataria (la UCT).
> Cierra la fuente `[ENT]` de `docs/02` y responde la observación 1 del profesor guía (21/09/2026).
> **Versión:** 21 de septiembre de 2026. La versión del 18 de agosto (preguntas al profesor guía ya
> resueltas, entrevistas externas a centrales de alarma del enfoque Contact ID) está en el historial git.

---

## 1. A quién entrevistar

Meta: **dos entrevistas** documentadas antes del 30 de octubre (OE1), la primera dentro de la Etapa 2.

| # | Perfil | Qué valida | Cómo llegar |
|---|---|---|---|
| 1 | Responsable de laboratorios o del equipamiento de sensores de la Facultad de Ingeniería | Causas C1, C2, C4; qué sensores existen y qué pasa con sus datos | Contacto solicitado al profesor guía |
| 2 | Dirección de informática de la universidad (red) | RNF-08 credenciales, RNF-09 segmentación, RNF-10 conexión saliente; cómo se despliega en la red del campus | Contacto solicitado al profesor guía |
| 3 (reserva) | Académico con proyecto que use sensores (agronomía, ambiental) | C3, C5; datos que hoy no se procesan | Página de proyectos de la UCT; vía profesor guía |

Datos personales: **ninguno al repositorio**. En la bitácora solo el rol.

---

## 2. Guion (25 a 40 minutos, semiestructurado)

Las preguntas guían; si la persona toma un camino interesante, seguirlo. **Ellos hablan el 70 %.**
Anotar frases textuales entre comillas; lo interpretado, entre corchetes. No corregir al entrevistado:
su percepción es el dato.

### Apertura (2 min)
> «Estoy haciendo mi trabajo de título sobre una plataforma para administrar datos de sensores. No vengo
> a ofrecer nada: vengo a entender si el problema que creo que existe, existe de verdad. ¿Le molesta si
> anoto lo que me diga y cito alguna frase en el informe? Puedo mantenerlo anónimo.»

Sin ese permiso no se puede citar.

### Bloque 1 — Qué hay (5 min)
1. ¿Qué sensores o dispositivos de medición tienen hoy? ¿Cuántos y dónde?
2. ¿Cómo se comunican (Wi-Fi, cable, radio, SIM)? ¿Quién los eligió e instaló?
3. ¿Están todos funcionando hoy? → si «no sé» o «creo que algunos no»: evidencia directa de **C5**.

### Bloque 2 — Qué pasa con los datos (10 min, el central)
4. ¿Dónde llegan los datos? ¿Quién los mira y con qué frecuencia? → C1, C4
5. ¿Puede ver el historial de hace tres meses? ¿Cómo? → RF-33
6. **¿Podría descargar todos sus datos y llevárselos a otra parte?** → C3, RF-34. La pregunta más importante: «no sé» o «habría que pedirlo al proveedor» valida C3 en terreno.
7. Si mañana agregara un sensor de otra marca, ¿qué pasaría? → C2
8. ¿Pagan algo mensual por plataforma o servicio? → C3

### Bloque 3 — El dolor concreto (8 min)
9. ¿Le ha pasado que un sensor deje de reportar y se enteren tarde? ¿Cómo se enteraron, cuánto tardaron, qué consecuencia tuvo? → C5. Un incidente con consecuencia es la evidencia más valiosa: **pedir detalles y anotar literal**.
10. ¿Hay alguna decisión que hoy tomen «a ojo» y preferirían tomar con dato?

### Bloque 4 — Validar el catálogo (8 min; describir la capacidad, no el requerimiento)
11. Una pantalla con todos sus sensores y cuáles responden: ¿la usaría? ¿cada cuánto? → RF-47, RF-48
12. ¿Prefiere aviso por correo o mensaje, o que solo quede registrado? → RF-36, RF-37
13. ¿Le sirve agrupar sensores por edificio, sector o proyecto? → RF-21
14. ¿Qué importa más: ver el valor exacto o que le avisen cuando algo se sale de rango? → alertas por umbral frente a histórico; cualquier respuesta sirve, documentada.
15. ¿Quién debería ver estos datos y quién no? → RF-41, RF-44
16. (solo perfil 2) ¿Los dispositivos pueden vivir en un segmento de red aparte? ¿Se permite que solo abran conexiones salientes? → RNF-09, RNF-10

### Cierre (3 min)
17. Si esto existiera, ¿lo probaría? ¿Con qué sensores empezaría?
18. ¿Hay alguien más con quien debería hablar? → multiplica las entrevistas.
19. ¿Puedo volver a consultarle durante el desarrollo? → abre la validación con usuario real de la Etapa 4.

**Si solo alcanza una pregunta:** «¿Qué es lo más frustrante de tener estos sensores instalados?»

---

## 3. Registro (el mismo día)

Un archivo por entrevista: `bitacora/AAAA-MM-DD-entrevista-<rol>.md`

```
# Entrevista — <rol> — <fecha>
- Modalidad, duración · Autorización de cita: sí / anonimizada / no
## Inventario declarado
## Citas textuales            (literal, entre comillas)
## Incidentes relatados
## Requerimientos que valida o refuta
| Cita o hecho | Causa | Requerimiento |
## Requerimientos nuevos       (se agregan al catálogo marcados [ENT])
## Contactos derivados         (solo roles)
```

## 4. Cómo entra al informe y a los docs

| Destino | Qué se agrega |
|---|---|
| `docs/02` §1.1 | Habilitar `[ENT]`; reasignar los requerimientos con respaldo directo; agregar los nuevos |
| `docs/01` | Citas como validación de relevancia; estado del levantamiento → realizado |
| Informe cap. 1 §1.1 | El párrafo de evidencia deja de decir «aún no realizado» y cita lo recogido |
| Informe cap. 3 §3.1 y cap. 5 §5.5 | Fuente `[ENT]` habilitada; fila 1 del cuadro de retroalimentación → realizada |
| `bitacora/` | El registro completo |

## 5. Si no se consiguen antes del 2 de octubre

1. Documentar el intento: a quién se escribió, cuándo, qué respondieron.
2. Informar al profesor guía por escrito antes de la entrega.
3. Mantener OE1 al 30 de octubre (Etapa 3) y buscar el perfil 3 de reserva.
