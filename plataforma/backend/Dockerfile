# syntax=docker/dockerfile:1
# Imagen del backend (docs/10 §6, 23/09/2026): multi-stage, sin panel todavía (no existe en el
# código; Etapa 3 lo agrega como etapa adicional sin tocar esta estructura).

# ── Etapa 1: compilar ─────────────────────────────────────────────────────────────────────────
# Node completo (con compilador y npm/corepack) SOLO aquí; no viaja a la imagen final.
FROM node:22.23.2-slim AS build
WORKDIR /app
RUN corepack enable
# Copiar antes que el resto: si solo cambia el código, esta capa se reutiliza de caché.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN pnpm build

# ── Etapa 2: imagen que corre ─────────────────────────────────────────────────────────────────
FROM node:22.23.2-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# Solo dependencias de producción: sin @nestjs/cli, sin jest, sin eslint, sin el código fuente.
# --prod: sin devDependencies. El almacén de pnpm (paquetes descargados) no se necesita después de
# instalar en un contenedor que nunca vuelve a correr pnpm: se borra en la misma capa (verificado el
# 23/09/2026 con docker history: "pnpm store prune" NO lo hacía, porque todo seguía referenciado).
RUN pnpm install --prod --frozen-lockfile \
    && rm -rf "$(pnpm store path --silent)" /root/.cache/pnpm
COPY --from=build /app/dist ./dist
# La imagen oficial ya trae un usuario sin privilegios; se usa en vez de root.
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.HTTP_PUERTO||3000)+'/salud',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/main.js"]
