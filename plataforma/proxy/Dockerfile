# Imagen del proxy (docs/10 §8.4 decisión 10): la oficial fijada más los parches de Alpine que todavía no trae. El escaneo
# del 08/10/2026 (docs/11 §4) encontró vulnerabilidades con versión corregida publicada: altas en libexpat, pcre2 y tiff;
# medias en libpng, nghttp2-libs y zlib. El 22/10/2026: alta en libx11 (1.8.13 → 1.8.14), sumada a la lista; y tres altas de nginx mismo
# (CVE-2026-15176, -93479, -97205), que no se parchan con apk (el paquete oficial viene del repositorio de nginx, no del de Alpine):
# el FROM subió a 1.30.6-alpine, publicada ese mismo día, fijada por digest de índice y escaneada antes de darla por buena.
# Cuando la imagen oficial se reconstruya con ellas, el escaneo dará 0 sin este RUN y el archivo vuelve a ser solo el FROM.
FROM nginx:1.30.6-alpine@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951
RUN apk upgrade --no-cache libexpat pcre2 tiff libpng nghttp2-libs zlib libx11
