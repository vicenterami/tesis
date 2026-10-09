# Imagen del proxy (docs/10 §8.4 decisión 10): la oficial fijada más los parches de Alpine que todavía no trae. El escaneo
# del 08/10/2026 (docs/11 §4) encontró vulnerabilidades con versión corregida publicada: altas en libexpat, pcre2 y tiff;
# medias en libpng, nghttp2-libs y zlib.
# Cuando la imagen oficial se reconstruya con ellas, el escaneo dará 0 sin este RUN y el archivo vuelve a ser solo el FROM.
FROM nginx:1.30.5-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94
RUN apk upgrade --no-cache libexpat pcre2 tiff libpng nghttp2-libs zlib
