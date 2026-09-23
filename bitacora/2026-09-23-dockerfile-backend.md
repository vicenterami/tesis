# Dockerfile del backend, probado con fallas reales — 23 de septiembre de 2026

- **Sesión de trabajo individual;** registro de decisiones, no de la jornada. Sonnet 5.

## 1. Qué se hizo

Se documentó primero en `docs/10 §6` la forma de la imagen (multi-stage, healthcheck, sin panel
todavía), después se escribió el `Dockerfile`, se agregó el servicio `backend` al compose y se
construyó y corrió la imagen real contra la base y el broker ya en contenedores — no solo `docker
build`, sino la pila completa arriba, con `/salud` y `/docs` respondiendo desde fuera.

## 2. Decisiones y hallazgos

| # | Decisión / hallazgo | Por qué | Dónde queda |
|---|---|---|---|
| 1 | Imagen multi-stage: `build` compila con Node completo, `runtime` solo lleva `dist/` y dependencias de producción | La imagen que corre no necesita compilador ni código fuente | `Dockerfile`, `docs/10 §6` |
| 2 | `pnpm store prune` **no** basta para achicar la imagen: no borra lo que sigue referenciado. Hay que borrar el almacén completo tras instalar | Medido con `docker history`: la capa de instalación pesaba 387 MB; con el borrado explícito, 112 MB. Imagen final 804 → 468 MB | `Dockerfile`, `backend/README.md` |
| 3 | Los archivos `*.spec.ts` no se compilan a la imagen de producción (`tsconfig.build.json`) | La imagen no necesita código de prueba; las pruebas siguen corriendo sobre el `.ts` fuente | `tsconfig.build.json` |
| 4 | El backend corre como usuario sin privilegios (`USER node`), sin `ports` publicados, con techo de 512 MB | Coherente con `docs/11` (capa 7) y con que solo el proxy lo alcance | `Dockerfile`, `docker-compose.yml` |
| 5 | **Hallazgo real, no de diseño:** el barrido periódico de supervisión (M4) tumbaba **todo el proceso** si la base fallaba justo en ese instante, porque su temporizador no tenía quien atrapara el rechazo (el pipeline normal sí estaba protegido, en `BrokerService`). Corregido con `barridoSeguro()` | Probado plantando la caída de la base con la pila en contenedores: sin el arreglo, `docker inspect` mostraba reinicios en bucle; con el arreglo, cero reinicios y el barrido se retoma solo | `supervision.service.ts`, prueba unitaria nueva (29 pruebas en total), `docs/10 §4.1` |
| 6 | `/salud` no refleja el estado del broker, solo el de la base | No es un error hoy; queda como límite conocido y no se amplía sin decidirlo primero (regla de concordancia) | `docs/10 §4.1` |

## 3. Verificación

- 29 pruebas unitarias en verde (tres nuevas del barrido).
- Guardián completo (`verificar-todo.sh`), 28 pasos en verde, incluida la API contra el backend contenedorizado real.
- Contenedor `healthy` con la pila completa; probado apagando la base y el broker por separado y viendo la recuperación sin reinicios (salvo antes del arreglo del punto 5, donde sí reinició, confirmando el hallazgo).
- Informe recompilado con la figura de despliegue actualizada: 30 páginas, cero referencias rotas.

## 4. Pendiente

- [ ] Proxy TLS (Caddy vs Nginx), Etapa 3.
- [ ] Panel Svelte: cuando exista, agregar como etapa adicional del mismo Dockerfile.
- [ ] Decidir si `/salud` debe reflejar también el broker (cambio de diseño, no corrección).
