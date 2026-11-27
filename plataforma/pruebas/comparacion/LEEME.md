# Comparación medida con los referentes: el banco

Banco de la comparación de TT-40. El protocolo, con su porqué, está en `docs/23`; aquí solo qué hace cada archivo y cómo se usa. Todo lo
pesado (imagen de la nube, discos de las máquinas, credenciales de cada instalación y datos crudos) vive fuera del repositorio, en
`BANCO_CACHE` (por omisión `~/.cache/tesis-comparacion`). Ninguna ruta, dirección ni clave de un equipo concreto está escrita aquí.

| Archivo | Qué hace |
|---|---|
| `versiones.env` | Versiones fijadas: imagen de Ubuntu Server para la nube (URL y SHA-256), paquetes de Docker, imágenes de ThingsBoard y de su PostgreSQL por digest, cliente MQTT del generador. |
| `maquina/user-data.plantilla`, `maquina/network-config` | `cloud-init` del primer arranque (usuario `banco` solo con llave, Docker fijado y retenido, temporizadores de apt, actualizaciones desatendidas y snapd apagados, sin intercambio) y la red de dos interfaces. |
| `vm.sh` | Máquinas con QEMU directo, sin privilegios: `base`, `crear`, `arrancar`, `ssh`, `copiar`, `apagar`, `borrar`, `lista`. 2 vCPU fijadas a dos hilos por ranura, disco qcow2 con `cache=none`, sin globo de memoria, puertos solo en 127.0.0.1. |
| `instalar-propia.sh` | Instala la plataforma propia tal como se despliega (Compose de producción + proxy TLS, construida desde un commit) y deja la instantánea `propia-instalada`. |
| `instalar-thingsboard.sh` | Instala ThingsBoard CE (v4.3.1.8 o v4.4.0.2) con su Compose oficial (`thingsboard/`) y deja la instantánea `tb43-instalada` o `tb44-instalada`. |
| `thingsboard/docker-compose.yml`, `thingsboard/fila-b.yml` | El Compose oficial de un nodo con las imágenes fijadas (cambios anotados en su cabecera) y la fila B (el heap que prescribe su guía, solo en 4 GB). |
| `plataformas/*.sh` | Lo único distinto por plataforma en una corrida: cómo arranca, cómo se consulta su base, el inicio de sesión y la consulta de historial de S2. |
| `generador.mjs` | Generador de carga neutro (en el anfitrión): un mensaje por dispositivo y período con dos magnitudes y su marca, QoS 1, envíos alineados al reloj, valores por semilla; adaptador por plataforma; también la sonda de «lista». |
| `dentro/muestreo.sh` | Muestreo cada 1 s dentro de la máquina: memoria del sistema, presión, muertes por memoria y cgroup de cada contenedor. |
| `corrida.sh` | Una corrida completa sobre una instantánea instalada; `--piloto` la marca como piloto; `--plantar` borra un punto y comprueba que la evaluación lo detecta. |
| `evaluar.py` | Conteo por conjuntos y veredicto de una corrida (`resultado.json`). |
| `contador-prueba.sh` | Prueba plantada del contador y del veredicto con datos sintéticos (14 comprobaciones; cada caso que no debe aprobar exige su motivo). |
| `tabla.py` | Tabla (`tabla.md`) y CSV de la figura (`figura.csv`) a partir de los `resultado.json`; pilotos y corridas válidas nunca se mezclan. |
| `noche.sh` | La medición completa en orden aleatorio fijado por semilla, en paralelo por ranuras, sin suspensión del equipo. |

## Uso

Requisitos del anfitrión: KVM accesible para el usuario, `qemu-system-x86_64`, `qemu-img`, `genisoimage`, `node` y `python3`. El cliente
MQTT del generador se instala una vez en la caché, con la versión de `versiones.env`:
`npm install --ignore-scripts --prefix ~/.cache/tesis-comparacion/node mqtt@5.16.1`.

1. `bash vm.sh base` — la máquina base (≈ 1 min).
2. `bash instalar-propia.sh 0` y `bash instalar-thingsboard.sh 43 1` (pueden ir en paralelo, en ranuras distintas).
3. `bash contador-prueba.sh` — debe decir «14 de 14 comprobaciones».
4. Piloto: `bash corrida.sh propia a 4 1 0 --piloto --s1-s 300 --s2-s 180 --plantar` (y lo mismo con `tb43`).
5. Medición: `bash noche.sh` (o `--ensayo` para ver el plan). La tabla queda en `$BANCO_DATOS/tabla-<fecha>/`.

## Qué se versiona después de medir

Sí: `tabla.md`, `figura.csv` y, por corrida, `resultado.json`, `fases.csv`, `meta.json` y las muestras de memoria. Nunca: las
credenciales de las instalaciones (`instalaciones/`), la llave del banco ni los discos.
