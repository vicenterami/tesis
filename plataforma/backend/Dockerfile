# Imagen del backend (docs/10 §6, 23/09/2026): multi-stage. Desde el 12/10/2026 compila también el panel (docs/19) en la
# etapa de build y copia solo su resultado estático a la imagen final, que lo sirve en /panel.

# Base: Debian 13 «trixie» desde el 08/10/2026 (docs/11 §4): con la misma versión de Node, el escaneo de imágenes dio 0
# vulnerabilidades críticas frente a 4 de la variante Debian 12.
# 09/11/2026: digest de la reconstrucción de 22.23.4-trixie-slim del 05/11 (trae apt 3.0.4, CVE-2026-109518) en las dos
# etapas; zlib1g (CVE-2026-76844 y CVE-2026-85091, corregido en 1:1.3.dfsg+really1.3.1-1+deb13u1) todavía no viene en la
# imagen oficial y se actualiza en la etapa final (docs/16 §12). Cuando la oficial lo traiga, esa línea sobra.

# ── Etapa 1: compilar ─────────────────────────────────────────────────────────────────────────
# Aquí se usan pnpm y las herramientas de desarrollo; de esta etapa solo viaja dist/ a la imagen final.
FROM node:22.23.4-trixie-slim@sha256:be1e2a3dc2c4fd68cdfadad2a696a280e0d2749098bee509230174d72fb768c6 AS build
WORKDIR /app
RUN corepack enable
# Copiar antes que el resto: si solo cambia el código, esta capa se reutiliza de caché.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY panel/package.json ./panel/
RUN pnpm install --frozen-lockfile
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN pnpm build
# El panel: fuente (index.html, src/, configuración) copiada después del backend para no invalidar su caché; Vite lo deja en
# panel/dist. Sus node_modules y un build viejo del equipo quedan fuera por .dockerignore.
COPY panel ./panel
RUN pnpm --filter panel build

# ── Etapa 2: imagen que corre ─────────────────────────────────────────────────────────────────
FROM node:22.23.4-trixie-slim@sha256:be1e2a3dc2c4fd68cdfadad2a696a280e0d2749098bee509230174d72fb768c6 AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Parches de Debian que la imagen oficial todavía no trae (09/11/2026; solo los listados, sin upgrade general).
RUN apt-get update && apt-get install -y --no-install-recommends --only-upgrade zlib1g && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY panel/package.json ./panel/
# Solo dependencias de producción DEL BACKEND (--filter): el panel ya está compilado y es estático, svelte no viaja.
# Sin @nestjs/cli, sin vitest, sin eslint, sin el código fuente.
# --prod: sin devDependencies. El almacén de pnpm (paquetes descargados) no se necesita después de
# instalar en un contenedor que nunca vuelve a correr pnpm: se borra en la misma capa (verificado el
# 23/09/2026 con docker history: "pnpm store prune" NO lo hacía, porque todo seguía referenciado).
# npm, npx, corepack y Yarn vienen en la imagen base y el contenedor nunca los usa: se quitan (08/10/2026). El escaneo
# encontró en las dependencias internas de npm (tar, sigstore, pacote…) vulnerabilidades que no son del sistema; sin npm,
# no están.
RUN pnpm install --prod --frozen-lockfile --filter plataforma-backend \
    && rm -rf "$(pnpm store path --silent)" /root/.cache/pnpm \
    && corepack disable \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /root/.cache/node \
              /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx \
              /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v*
COPY --from=build /app/dist ./dist
COPY --from=build /app/panel/dist ./panel/dist
# La imagen oficial ya trae un usuario sin privilegios; se usa en vez de root.
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.HTTP_PUERTO||3000)+'/salud',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/main.js"]
