# Imagen del proxy (docs/10 §8.4 decisión 10): la oficial fijada más los parches de Alpine que todavía no trae. El escaneo
# del 08/10/2026 (docs/11 §4) encontró vulnerabilidades con versión corregida publicada: altas en libexpat, pcre2 y tiff;
# medias en libpng, nghttp2-libs y zlib.
# Cuando la imagen oficial se reconstruya con ellas, el escaneo dará 0 sin este RUN y el archivo vuelve a ser solo el FROM.
FROM nginx:1.31.0-alpine@sha256:2f07d83bf561b506400dc183b1b2003803e39efbd22451f848adaba14d28c7c7
RUN apk upgrade --no-cache libexpat pcre2 tiff libpng nghttp2-libs zlib
