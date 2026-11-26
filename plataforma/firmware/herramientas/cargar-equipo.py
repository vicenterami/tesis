#!/usr/bin/env python3
"""Carga la red Wi-Fi, el servidor y la credencial en un equipo con el firmware del proyecto, por USB (docs/17 §6.4; docs/19 §4, Z).

Es el equivalente de «Cargar en el equipo» del panel, para Linux y macOS, con Python 3 y sin bibliotecas externas. Habla el mismo
protocolo: una orden JSON por línea; el equipo responde en una línea que empieza con «@plataforma ».

  python3 herramientas/cargar-equipo.py --puerto /dev/ttyUSB0 hola
  python3 herramientas/cargar-equipo.py --puerto /dev/ttyUSB0 estado
  python3 herramientas/cargar-equipo.py --puerto /dev/ttyUSB0 cargar --credenciales credenciales-AAAA-MM-DD.csv --id nodo-0001 \\
      --red "nombre-de-la-red" --servidor direccion-del-servidor
  python3 herramientas/cargar-equipo.py --puerto /dev/ttyUSB0 cargar --id nodo-0001 --sitio uct --red "…" --servidor …
  python3 herramientas/cargar-equipo.py --puerto /dev/ttyUSB0 borrar

En macOS el puerto se llama /dev/cu.usbserial-… (o /dev/cu.SLAB_USBtoUART). `--credenciales` es el archivo que descarga el alta masiva
(columnas id_fisico, id, credencial, destino); el sitio sale del tópico de la columna destino. Sin ese archivo, la credencial se pide
sin mostrarla. La clave de la red se pide siempre sin mostrarla. Ninguna clave va en los argumentos (quedarían en `ps` y en el
historial de la terminal) ni se imprime.
"""
import argparse
import csv
import errno
import getpass
import json
import os
import re
import select
import sys
import termios
import time
import unicodedata

PREFIJO = '@plataforma '
FIRMWARE = 'nodo'
PROTOCOLO = 2  # 2 (25/11/2026): `hola` trae `arranque`, que cambia en cada inicio (docs/19 §4, Z)
# Esperas (segundos). El equipo puede estar en medio de un saludo TLS (hasta 10 s) o reiniciándose al abrir el puerto.
ESPERA_ORDEN = 3.0
ESPERA_SALUDO = 20.0
ESPERA_CONEXION = 90.0
INTERVALO = 2.0

# Las mismas reglas que el firmware (include/protocolo.h) y el panel (lib/serie.ts).
FORMA_SITIO = re.compile(r'^[a-z0-9][a-z0-9-]{1,62}$')
FORMA_ID = re.compile(r'^[a-z0-9][a-z0-9-]{2,62}$')
FORMA_SERVIDOR = re.compile(r'^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$')
FORMA_DESTINO = re.compile(r'^sitio/([^/]+)/dispositivo/([^/]+)/')

RAZON = {
    'wifi': 'No encuentra la red o la clave de la red no es correcta.',
    'dns': 'El servidor no se encontró: revisa la dirección.',
    'tls': 'El equipo no reconoce el certificado del servidor: grábale la imagen de esta instalación.',
    'credencial': 'El broker rechazó la credencial: rótala desde la ficha del equipo y vuelve a cargarla.',
    'broker': 'El servidor no respondió como broker: revisa la dirección y el puerto.',
}
CAMPO = {
    'red': 'el nombre de la red (1 a 32 bytes)', 'clave_red': 'la clave de la red (vacía si es abierta, o de 8 a 63 caracteres)',
    'servidor': 'la dirección del servidor', 'puerto': 'el puerto (1 a 65535)', 'sitio': 'el código del sitio', 'id': 'el identificador',
    'clave': 'la credencial (16 a 128 caracteres sin espacios)',
}


def limpio(x, largo=64):
    """Un valor que mandó el equipo, para imprimirlo: sin controles ni nada invisible (una secuencia de escape no llega a la terminal y
    un U+202E no invierte el texto) y acotado. La misma regla que el backend (recepcion/texto.ts): las categorías Unicode C (control,
    formato, sin asignar, uso privado) y Z (separadores) se marcan con «?», salvo el espacio común."""
    return ''.join('?' if c != ' ' and unicodedata.category(c)[0] in 'CZ' else c for c in str(x)[:largo])


class Falla(Exception):
    """Un error que se le dice a la persona tal cual (nunca lleva una clave) y termina con su código de salida."""

    def __init__(self, texto, codigo=1):
        super().__init__(texto)
        self.codigo = codigo


def campo_invalido(d):
    """El primer campo que no cumple su regla, o None. Mismo orden y reglas que el firmware."""
    red = d['red'].encode('utf-8')
    if not 1 <= len(red) <= 32 or any(b < 0x20 or b == 0x7F for b in red):
        return 'red'
    cr = d['clave_red']
    if (cr != '' and not 8 <= len(cr) <= 63) or any(not 0x20 <= ord(c) <= 0x7E for c in cr):
        return 'clave_red'
    if not FORMA_SERVIDOR.match(d['servidor']) or d['servidor'].startswith('.'):
        return 'servidor'
    if not isinstance(d['puerto'], int) or not 1 <= d['puerto'] <= 65535:
        return 'puerto'
    if not FORMA_SITIO.match(d['sitio']):
        return 'sitio'
    if not FORMA_ID.match(d['id']):
        return 'id'
    c = d['clave']
    if not 16 <= len(c) <= 128 or any(not 0x21 <= ord(x) <= 0x7E for x in c):
        return 'clave'
    return None


def leer_credencial(ruta, id_fisico):
    """(credencial, sitio) de la fila de `id_fisico` en el archivo de credenciales del alta masiva. Los errores no muestran claves."""
    try:
        with open(ruta, newline='', encoding='utf-8-sig') as f:
            filas = list(csv.DictReader(f))
    except OSError as e:
        raise Falla(f'No se pudo leer {ruta}: {e.strerror}.', 2) from None
    except (csv.Error, UnicodeDecodeError):  # el mensaje de estos podría citar un trozo del archivo, que trae claves: no se muestra
        raise Falla(f'{ruta} no se puede leer como CSV en UTF-8: ¿es el archivo de credenciales del alta masiva?', 2) from None
    if filas and not {'id_fisico', 'credencial', 'destino'} <= set(filas[0].keys()):
        raise Falla(f'{ruta} no es un archivo de credenciales del alta masiva (faltan las columnas id_fisico, credencial o destino).', 2)
    for fila in filas:
        if fila.get('id_fisico') != id_fisico:
            continue
        m = FORMA_DESTINO.match(fila.get('destino') or '')
        if not m or not fila.get('credencial'):
            raise Falla(f'{id_fisico} no va por MQTT (su destino no es un tópico): no se carga por USB.', 2)
        return fila['credencial'], m.group(1)
    raise Falla(f'{id_fisico} no está en {ruta}.', 2)


class Enlace:
    """El puerto serie: 115200 8N1, crudo, sin mover DTR ni RTS (en estas placas van a EN y a BOOT: docs/17 y platformio.ini)."""

    def __init__(self, ruta):
        try:
            self.fd = os.open(ruta, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        except OSError as e:
            if e.errno == errno.EBUSY:
                raise Falla(f'{ruta} lo tiene abierto otro programa (un monitor serie u otra carga): ciérralo y vuelve a intentar.', 1) from None
            raise Falla(f'No se pudo abrir {ruta}: {e.strerror}. ¿Está conectado el equipo? ¿Tienes permiso (grupo dialout en Linux)?', 1) from None
        import fcntl
        try:  # en exclusiva: con un monitor serie abierto, los dos se repartirían los bytes
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(self.fd)
            raise Falla(f'{ruta} lo tiene abierto otro programa (un monitor serie u otra carga): ciérralo y vuelve a intentar.', 1) from None
        try:
            a = termios.tcgetattr(self.fd)
        except termios.error:
            os.close(self.fd)
            raise Falla(f'{ruta} no es un puerto serie.', 2) from None
        a[0] = 0                                                      # iflag: sin traducciones
        a[1] = 0                                                      # oflag
        a[2] = (termios.CS8 | termios.CREAD | termios.CLOCAL) & ~(termios.PARENB | termios.CSTOPB | termios.HUPCL)
        a[2] &= ~getattr(termios, 'CRTSCTS', 0)
        a[3] = 0                                                      # lflag: sin eco ni modo canónico
        a[4] = a[5] = termios.B115200
        a[6][termios.VMIN] = 0
        a[6][termios.VTIME] = 0
        termios.tcsetattr(self.fd, termios.TCSANOW, a)
        try:  # nadie más lo abre mientras tanto (TIOCEXCL: solo root lo salta)
            fcntl.ioctl(self.fd, termios.TIOCEXCL)
        except (AttributeError, OSError):
            pass
        try:  # bajar DTR y RTS; un adaptador o una pseudoterminal que no los tiene no es error
            import struct
            fcntl.ioctl(self.fd, termios.TIOCMBIC, struct.pack('I', termios.TIOCM_DTR | termios.TIOCM_RTS))
        except (AttributeError, OSError):
            pass
        self.resto = b''

    def cerrar(self):
        try:  # suelta la exclusividad antes de cerrar
            import fcntl
            fcntl.ioctl(self.fd, termios.TIOCNXCL)
        except (AttributeError, OSError):
            pass
        os.close(self.fd)

    def enviar(self, obj):
        """Con plazo: un equipo que no drena lo que recibe no deja el guion colgado."""
        datos = (json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
        limite = time.monotonic() + ESPERA_ORDEN
        while datos:
            if time.monotonic() >= limite:
                raise Falla('El equipo no recibe lo que se le envía (¿trabado?): desconéctalo, vuelve a conectarlo e intenta de nuevo.')
            try:
                n = os.write(self.fd, datos)
            except BlockingIOError:
                select.select([], [self.fd], [], min(1.0, max(limite - time.monotonic(), 0.01)))
                continue
            datos = datos[n:]

    def respuesta(self, orden, espera):
        """La primera respuesta a `orden` (o un error de forma, que no trae orden) dentro de `espera` segundos; si no, None."""
        limite = time.monotonic() + espera
        while True:
            while b'\n' in self.resto:
                linea, self.resto = self.resto.split(b'\n', 1)
                texto = linea.decode('utf-8', 'replace').rstrip('\r')
                if not texto.startswith(PREFIJO):
                    continue  # el registro normal del equipo
                try:
                    r = json.loads(texto[len(PREFIJO):])
                except ValueError:
                    continue
                if isinstance(r, dict) and r.get('orden') in (orden, ''):
                    return r
            queda = limite - time.monotonic()
            if queda <= 0:
                return None
            listos, _, _ = select.select([self.fd], [], [], min(queda, 0.2))
            if listos:
                try:
                    trozo = os.read(self.fd, 1024)
                except BlockingIOError:
                    trozo = b''
                self.resto = (self.resto + trozo)[-8192:]

    def orden(self, obj, espera=None):
        self.enviar(obj)
        return self.respuesta(obj['orden'], ESPERA_ORDEN if espera is None else espera)


def saludar(enlace, espera=None):
    """`hola` hasta que el equipo conteste (se repite: pudo estar reiniciándose u ocupado). Exige nuestro firmware."""
    limite = time.monotonic() + (ESPERA_SALUDO if espera is None else espera)
    while time.monotonic() < limite:
        r = enlace.orden({'orden': 'hola'}, min(INTERVALO, max(limite - time.monotonic(), 0.05)))
        # Un error de forma sin orden («json» o «larga») es por lo que había antes en la línea del equipo (un trozo de otra orden o
        # ruido del arranque), no por este `hola`: se repite (corrección del 25/11/2026).
        if r is None or (r.get('ok') is False and r.get('orden') == ''):
            continue
        if r.get('ok') is not True or r.get('firmware') != FIRMWARE:
            raise Falla('El equipo contestó, pero no tiene el firmware de la plataforma: grábalo primero.')
        if r.get('protocolo') != PROTOCOLO or not isinstance(r.get('arranque'), int):
            raise Falla(f"El equipo tiene el firmware de la plataforma, pero de otra versión (protocolo {limpio(r.get('protocolo'), 8)}; este guion "
                        f'habla el {PROTOCOLO}): grábale la imagen actual.')
        return r
    raise Falla('El equipo no responde. Revisa el cable y el puerto; si otro programa (el monitor serie) lo tiene abierto, ciérralo.')


def describir(r):
    return 'configurado' if r.get('configurado') else 'sin configurar'


def cmd_hola(enlace, _args):
    r = saludar(enlace)
    ident = f", identificador {limpio(r['id'])}" if r.get('id') else ''
    print(f"Firmware {limpio(r.get('firmware'))} {limpio(r.get('version'))}: {describir(r)} (origen: {limpio(r.get('origen'))}){ident}.")
    return 0


def cmd_estado(enlace, _args):
    saludar(enlace)
    r = enlace.orden({'orden': 'estado'})
    if r is None or r.get('ok') is not True:
        raise Falla('El equipo no respondió el estado.')
    print(f"Red: {limpio(r.get('wifi'))} · broker: {limpio(r.get('broker'))} · último error: {limpio(r.get('ultimo_error'))} · "
          f"publicados: {limpio(r.get('publicados'))}.")
    if isinstance(r.get('ultimo_error'), str) and r['ultimo_error'] in RAZON and r.get('broker') != 'conectado':
        print(RAZON[r['ultimo_error']])
    return 0


def esperar_otro_arranque(enlace, antes):
    """El `hola` de un arranque distinto de `antes` (el que todavía contesta con lo anterior no cuenta), o None si no llegó a tiempo."""
    limite = time.monotonic() + ESPERA_SALUDO
    while time.monotonic() < limite:
        try:
            h = saludar(enlace, max(limite - time.monotonic(), 0.1))
        except Falla:
            return None
        if h.get('arranque') != antes:
            return h
        time.sleep(0.3)  # todavía no se reinicia: contesta con lo anterior
    return None


def cmd_borrar(enlace, _args):
    antes = saludar(enlace).get('arranque')
    r = enlace.orden({'orden': 'borrar'})
    if r is None or r.get('ok') is not True:
        raise Falla('El equipo no confirmó el borrado.')
    # El firmware borra la partición de datos entera (docs/17 §6.4) y arranca con lo que traiga su imagen.
    h = esperar_otro_arranque(enlace, antes)
    if h is None:
        print('Borrado: el equipo se reinició, pero no volvió a contestar; mira «hola» en un momento.')
    elif h.get('origen') == 'compilado':
        print(f"Borrado: el equipo arrancó con los valores compilados en su imagen (identificador {limpio(h.get('id'))}), no de fábrica.")
    else:
        print('Borrado: el equipo arrancó sin configurar.')
    print('Si el equipo se da de baja o se entrega, rota también su credencial y la clave de la red (docs/11 §7).')
    return 0


def pedir_datos(args):
    if args.credenciales:
        clave, sitio = leer_credencial(args.credenciales, args.id)
        if args.sitio and args.sitio != sitio:
            raise Falla(f'El archivo dice que {args.id} es del sitio {sitio}, no de {args.sitio}.', 2)
    else:
        if not args.sitio:
            raise Falla('Sin --credenciales hace falta --sitio (el código del sitio del alta).', 2)
        sitio = args.sitio
        clave = getpass.getpass(f'Credencial de {args.id} (no se muestra): ')
    red = args.red if args.red is not None else input('Nombre de la red Wi-Fi: ')
    clave_red = getpass.getpass(f'Clave de la red «{red}» (no se muestra; vacía si la red es abierta): ')
    datos = {'orden': 'configurar', 'red': red, 'clave_red': clave_red, 'servidor': args.servidor, 'puerto': args.puerto_mqtt,
             'sitio': sitio, 'id': args.id, 'clave': clave}
    malo = campo_invalido(datos)
    if malo is not None:
        raise Falla(f'No se cargó nada: revisa {CAMPO[malo]}.', 2)
    return datos


def cmd_cargar(enlace, args, datos):
    hola = saludar(enlace)
    actual = hola.get('id') if hola.get('configurado') is True and isinstance(hola.get('id'), str) else None
    if actual is not None and actual != datos['id'] and args.reemplazar != actual:
        raise Falla(f'El equipo ya está cargado como {limpio(actual)}: no se cargó nada. Si de verdad quieres reemplazarlo (deja de enviar datos '
                    f'como {limpio(actual)}), repite con --reemplazar {limpio(actual)}.')
    # `configurar` espera lo que un saludo: el equipo pudo entrar justo ahora en un intento de conexión que bloquea (TLS, hasta 10 s).
    r = enlace.orden(datos, max(ESPERA_ORDEN, ESPERA_SALUDO))
    datos['clave'] = datos['clave_red'] = ''  # lo que sigue ya no las necesita
    if r is None:
        raise Falla('El equipo no confirmó la carga: vuelve a intentarlo.')
    if r.get('ok') is not True:
        if r.get('error') == 'campo':
            raise Falla(f"El equipo rechazó {CAMPO.get(str(r.get('campo')), 'un campo')}: no guardó nada.")
        raise Falla('El equipo no guardó la configuración: vuelve a intentarlo.')
    print('1. Credencial cargada: el equipo se reinicia con la configuración nueva.')
    # Un `hola` de OTRO arranque: el del equipo que todavía corre con lo anterior no cuenta, aunque traiga el mismo identificador
    # (corrección del 25/11/2026: recargar el mismo equipo con una red mala terminaba en «el broker la aceptó», con la sesión vieja).
    h = esperar_otro_arranque(enlace, hola.get('arranque'))
    if h is None or h.get('id') != datos['id']:
        raise Falla('El equipo no volvió con el identificador cargado: la carga no quedó guardada. Vuelve a intentarlo.')
    red = broker = False
    ultimo = 'ninguno'
    limite = time.monotonic() + ESPERA_CONEXION
    while time.monotonic() < limite:
        e = enlace.orden({'orden': 'estado'})
        if e is not None and e.get('ok') is True:
            ultimo = e.get('ultimo_error') if isinstance(e.get('ultimo_error'), str) else 'ninguno'
            if not red and e.get('wifi') == 'conectado':
                red = True
                print('2. Conectó a la red.')
            if e.get('broker') == 'conectado':
                if not red:
                    print('2. Conectó a la red.')
                print('3. El broker la aceptó. La primera trama se ve en el panel, en la ficha del equipo.')
                return 0
        time.sleep(INTERVALO)
    raise Falla(RAZON.get(ultimo, 'El equipo no se conectó a tiempo: mira «estado» en un momento o el monitor serie.'))


def analizador():
    # Sin abreviaturas: «--credencial <clave>» no debe tomarse como «--credenciales <archivo>» (y terminar escrita en un error).
    a = argparse.ArgumentParser(description='Carga la red, el servidor y la credencial en un equipo por USB (docs/17 §6.4).', allow_abbrev=False)
    a.add_argument('--puerto', required=True, help='el puerto serie del equipo: /dev/ttyUSB0, /dev/ttyACM0 o /dev/cu.usbserial-…')
    s = a.add_subparsers(dest='orden', required=True)
    s.add_parser('hola', help='qué firmware tiene y si está configurado')
    s.add_parser('estado', help='red, broker y último error')
    s.add_parser('borrar', help='borra la memoria del equipo: arranca con lo que traiga su imagen')
    c = s.add_parser('cargar', help='carga red, servidor y credencial', allow_abbrev=False)
    c.add_argument('--id', required=True, help='el identificador físico del equipo (el del alta)')
    c.add_argument('--credenciales', help='el archivo de credenciales del alta masiva (CSV)')
    c.add_argument('--sitio', help='el código del sitio (sin --credenciales)')
    c.add_argument('--red', help='el nombre de la red Wi-Fi (si no, se pregunta)')
    c.add_argument('--servidor', required=True, help='la dirección del servidor que el equipo alcanza (nombre o IPv4)')
    c.add_argument('--puerto-mqtt', type=int, default=8883, help='el puerto MQTT con TLS (8883)')
    c.add_argument('--reemplazar', metavar='ID_ACTUAL', help='si el equipo ya está cargado con OTRO identificador, cuál (se exige escribirlo)')
    return a


def main(argv=None):
    args = analizador().parse_args(argv)
    try:
        datos = pedir_datos(args) if args.orden == 'cargar' else None  # antes de abrir el puerto: un dato mal no toca el equipo
        enlace = Enlace(args.puerto)
        try:
            if args.orden == 'cargar':
                return cmd_cargar(enlace, args, datos)
            return {'hola': cmd_hola, 'estado': cmd_estado, 'borrar': cmd_borrar}[args.orden](enlace, args)
        finally:
            enlace.cerrar()
    except Falla as f:
        print(str(f), file=sys.stderr)
        return f.codigo
    except KeyboardInterrupt:
        print('Interrumpido.', file=sys.stderr)
        return 130
    except OSError as e:  # el cable se desconectó con el puerto abierto (EIO): un mensaje, no un error de Python
        print(f'Se perdió el puerto ({e.strerror or e.__class__.__name__}): ¿se desconectó el cable? Si fue durante la carga, mira `hola`.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
