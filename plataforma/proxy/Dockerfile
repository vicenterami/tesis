# Imagen del proxy (docs/10 §8.4 decisión 10): la oficial fijada más los parches de Alpine que todavía no trae. El escaneo
# del 08/10/2026 (docs/11 §4) encontró vulnerabilidades con versión corregida publicada: altas en libexpat, pcre2 y tiff;
# medias en libpng, nghttp2-libs y zlib. El 22/10/2026: alta en libx11 (1.8.13 → 1.8.14), sumada a la lista; y tres altas de nginx mismo
# (CVE-2026-15176, -93479, -97205), que no se parchan con apk (el paquete oficial viene del repositorio de nginx, no del de Alpine):
# el FROM subió a 1.30.6-alpine, publicada ese mismo día, fijada por digest de índice y escaneada antes de darla por buena.
# El 09/11/2026: crítica en brotli-libs (1.2.0 → 1.2.1) y alta en curl/libcurl (8.22.0 → 8.23.0), sumadas a la lista; el FROM
# pasa a la reconstrucción de 1.30.6-alpine del 05/11 (publicada el 06/11, ya las trae), fijada por digest de índice.
# El 13/11/2026: libxslt (1.1.43-r3 → r4, 3 altas), sumada a la lista.
# El 18/11/2026: cinco altas de nginx mismo (CVE-2026-113425, -121810, -123007, -123633, -123634), corregidas en 1.30.7: el FROM subió
# a 1.30.7-alpine, publicada ese mismo día, fijada por digest de índice y escaneada antes de darla por buena (docs/16 §88).
# Cuando la imagen oficial se reconstruya con ellas, el escaneo dará 0 sin este RUN y el archivo vuelve a ser solo el FROM.
FROM nginx:1.30.7-alpine@sha256:bef154735288bc38d99fac41ae63730684bcc661503673a04a0f9bc526ba8598
RUN apk upgrade --no-cache libexpat pcre2 tiff libpng nghttp2-libs zlib libx11 brotli-libs curl libcurl libxslt
