# Imagen de la base (RNF-15, docs/10 §8.4 punto 11): la oficial fijada, edición Apache (-oss), más lo que el escaneo del
# 08/10/2026 pidió corregir (docs/11 §4):
#   · paquetes de Alpine con versión corregida publicada (python3 y sus .pyc, zlib), solo esos, para no desalinear las
#     piezas que trae PostgreSQL;
#   · fuera timescaledb-parallel-copy (herramienta de carga masiva que el sistema no usa; traía 2 críticas y 29 altas) y
#     timescaledb-tune (16 altas): aquí nunca corre, porque el compose monta db/init sobre los guiones de arranque de la
#     imagen que lo llamaban (comprobado: shared_buffers sigue en 128 MB, el valor por defecto). También se quita el
#     guion de arranque que lo llama (08/10): sin él, la imagen levantada sola, sin el compose, se caía al iniciar.
# Queda, documentado: gosu (el arranque lo usa para bajar privilegios). Cuando la imagen oficial se reconstruya con los
# parches, este archivo vuelve a ser casi solo el FROM.
FROM timescale/timescaledb:2.31.0-pg16-oss@sha256:1bfcf994089b9c97b4ddfa07f2ff9eec430709715e419d9a6957d1a4b4614cd1
RUN apk upgrade --no-cache pyc python3 python3-pyc python3-pycache-pyc0 zlib libexpat \
    && rm -f /usr/local/bin/timescaledb-parallel-copy /usr/local/bin/timescaledb-tune \
             /docker-entrypoint-initdb.d/001_timescaledb_tune.sh
