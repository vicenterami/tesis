# Imagen de la base (RNF-15, docs/10 §8.4 punto 11): la oficial fijada, edición Apache (-oss), más lo que los escaneos pidieron
# corregir (docs/11 §4). Historia de los parches:
#   · 08/10/2026: paquetes de Alpine con versión corregida publicada (python3 y sus .pyc, zlib, libexpat), solo esos, para no
#     desalinear las piezas que trae PostgreSQL; fuera timescaledb-parallel-copy (herramienta de carga masiva que el sistema no
#     usa; traía 2 críticas y 29 altas) y timescaledb-tune (16 altas): aquí nunca corre, porque el compose monta db/init sobre los
#     guiones de arranque de la imagen que lo llamaban (comprobado: shared_buffers sigue en 128 MB, el valor por defecto). También
#     se quita el guion de arranque que lo llama: sin él, la imagen levantada sola, sin el compose, se caía al iniciar.
#   · 09/11/2026: musl y musl-utils (1.2.5-r23 → r24, CVE-2026-107891), sumadas a la lista.
#   · 13/11/2026: la imagen oficial pide `postgresql16-plpython3`, que arrastra una SEGUNDA copia de PostgreSQL como paquetes de
#     Alpine (postgresql16, postgresql16-client, postgresql-common, libpq) y todo Python 3 (python3, pyc, python3-pyc,
#     python3-pycache-pyc0, sqlite-libs, libbz2, libexpat, libpanelw, mpdecimal): 14 paquetes que nadie usa. El servidor que corre
#     es /usr/local/bin/postgres (PKGLIBDIR = /usr/local/lib/postgresql); psql, pg_dump, pg_restore y pg_isready salen de
#     /usr/local/bin y enlazan con /usr/local/lib/libpq.so.5; la base no instala ningún lenguaje PL/Python. Esa copia traía 38 altas
#     cada uno de los tres paquetes de PostgreSQL y 38 libpq. Se quita con `apk del`, y con ella el apk upgrade de Python; se quitan
#     también las cuatro bibliotecas de PL/Python de /usr/local/lib/postgresql y sus ocho archivos de extensión (*plpython3u*), para
#     que pedir esa extensión diga «no disponible» en vez de fallar al cargar. Se suman krb5-libs (1.22.1-r0 → 1.22.3-r0, 16 altas)
#     y libxslt (1.1.43-r3 → r4, 3 altas), que sí son dependencias del servidor que corre (.postgresql-rundeps). 12 MB menos.
# Queda, documentado: gosu (el arranque lo usa para bajar privilegios) y el servidor compilado en /usr/local, que el escáner de
# paquetes no ve: escanear-imagenes.sh compara su versión con la publicada (docs/11 §4). Cuando la imagen oficial se reconstruya con
# los parches, este archivo vuelve a ser casi solo el FROM.
FROM timescale/timescaledb:2.31.0-pg16-oss@sha256:1bfcf994089b9c97b4ddfa07f2ff9eec430709715e419d9a6957d1a4b4614cd1
RUN apk del --no-cache postgresql16-plpython3 \
    && apk upgrade --no-cache zlib musl musl-utils krb5-libs libxslt \
    && rm -f /usr/local/bin/timescaledb-parallel-copy /usr/local/bin/timescaledb-tune \
             /docker-entrypoint-initdb.d/001_timescaledb_tune.sh \
             /usr/local/lib/postgresql/plpython3.so /usr/local/lib/postgresql/hstore_plpython3.so \
             /usr/local/lib/postgresql/jsonb_plpython3.so /usr/local/lib/postgresql/ltree_plpython3.so \
             /usr/local/share/postgresql/extension/*plpython3u*
