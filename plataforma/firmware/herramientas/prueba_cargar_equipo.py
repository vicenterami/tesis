#!/usr/bin/env python3
"""Pruebas de herramientas/cargar-equipo.py contra un equipo SIMULADO en una pseudoterminal (sin placa; docs/17 §6.4).

  python3 -I herramientas/prueba_cargar_equipo.py

El equipo simulado habla como el firmware (include/protocolo.h y src/nodo.cpp): responde con el prefijo, mezcla líneas de registro, parte
sus respuestas en trozos y se reinicia tras `configurar`. Las claves de aquí son evidentemente falsas.
"""
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import tempfile
import threading
import time
import unittest
from unittest import mock

RUTA = pathlib.Path(__file__).with_name('cargar-equipo.py')
spec = importlib.util.spec_from_file_location('cargar_equipo', RUTA)
ce = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ce)

CLAVE_EQUIPO = 'clave-falsa-de-prueba-0000000001'
CLAVE_RED = 'clave-de-red-falsa'
CSV = ('id_fisico,id,credencial,destino\r\n'
       f'nodo-0001,00000000-0000-4000-8000-000000000001,{CLAVE_EQUIPO},sitio/uct/dispositivo/nodo-0001/<magnitud>\r\n'
       'nodo-0002,00000000-0000-4000-8000-000000000002,otra-clave-falsa-000000000002,sitio/uct/dispositivo/nodo-0002/<magnitud>\r\n'
       'nodo-http,00000000-0000-4000-8000-000000000003,token-falso-de-prueba-sin-valor,POST /recepcion/nodo-http\r\n')


# La versión que imita: la de src/nodo.cpp (el verificador, paso 2y5, comprueba que coincidan).
VERSION_FIRMWARE = '2.1.0'


class EquipoSimulado(threading.Thread):
    """Del lado maestro de la pseudoterminal: lee órdenes y responde como el firmware."""

    def __init__(self, maestro, firmware='nodo', rechaza=None, sin_red=False, error_broker=None, basura_inicial=False, corta_en_configurar=False,
                 ruido=False, config=None, conectado=False, protocolo=None, sin_arranque=False, ventana_vieja=0.2):
        super().__init__(daemon=True)
        self.fd = maestro
        self.firmware = firmware
        self.rechaza = rechaza          # un campo que el equipo rechaza en `configurar`
        self.sin_red = sin_red
        self.error_broker = error_broker
        self.basura_inicial = basura_inicial    # la primera línea llega mal formada (un trozo viejo en su búfer): error de forma, sin orden
        self.corta_en_configurar = corta_en_configurar  # el cable se desconecta al llegar `configurar`: no responde nada
        self.ruido = ruido                      # antes de cada respuesta: 20 kB sin salto de línea y bytes que no son UTF-8
        self.config = config            # lo que ya tiene cargado (con su `id`)
        self.conectado = config is not None and conectado  # la sesión vieja, conectada a la red y al broker
        self.protocolo = ce.PROTOCOLO if protocolo is None else protocolo
        self.sin_arranque = sin_arranque  # un firmware viejo, sin `arranque` en `hola`
        self.ventana_vieja = ventana_vieja  # tras `configurar`, sigue contestando con lo anterior (como el firmware mientras vacía la salida)
        self.arranque = 1
        self.reinicio_en = None
        self.config_nueva = None
        self.recibidas = []
        self.estados = 0
        self.dormido_hasta = 0.0
        self.parar = False

    def escribir(self, texto):
        datos = texto.encode('utf-8')
        mitad = len(datos) // 2  # en dos trozos, como llega por un cable
        os.write(self.fd, datos[:mitad])
        time.sleep(0.005)
        os.write(self.fd, datos[mitad:])

    def responder(self, obj):
        if self.ruido:
            os.write(self.fd, b'\xff\xfe' + b'r' * 20000 + b'\xc3\r\n')
        self.escribir('registro: algo que el equipo dice entre medio\r\n' + ce.PREFIJO + json.dumps(obj) + '\r\n')

    def run(self):
        resto = b''
        while not self.parar:
            try:
                trozo = os.read(self.fd, 1024)
            except OSError:
                return
            if not trozo:
                return
            resto += trozo
            while b'\n' in resto:
                linea, resto = resto.split(b'\n', 1)
                ahora = time.monotonic()
                if self.reinicio_en is not None and ahora >= self.reinicio_en:  # pasó la ventana vieja: arranca con lo nuevo
                    self.reinicio_en = None
                    self.arranque += 1
                    self.config, self.config_nueva = self.config_nueva, None
                    self.conectado = False
                    self.estados = 0
                    self.dormido_hasta = ahora + 0.1
                if ahora < self.dormido_hasta:
                    continue  # reiniciándose: lo que llega se pierde
                if self.basura_inicial:
                    self.basura_inicial = False
                    self.escribir(ce.PREFIJO + '{"ok":false,"orden":"","error":"json"}\r\n')
                    continue
                self.atender(json.loads(linea))

    def atender(self, o):
        self.recibidas.append(o)
        orden = o.get('orden')
        if orden == 'hola':
            r = {'ok': True, 'orden': 'hola', 'firmware': self.firmware, 'version': VERSION_FIRMWARE, 'protocolo': self.protocolo,
                 'configurado': self.config is not None, 'origen': 'memoria' if self.config else 'ninguno'}
            if not self.sin_arranque:
                r['arranque'] = self.arranque
            if self.config:
                r['id'] = self.config['id']
            self.responder(r)
        elif orden == 'configurar':
            if self.corta_en_configurar:
                return
            if self.rechaza:
                self.responder({'ok': False, 'orden': 'configurar', 'error': 'campo', 'campo': self.rechaza})
                return
            self.config_nueva = {k: v for k, v in o.items() if k != 'orden'}
            self.responder({'ok': True, 'orden': 'configurar', 'reinicia': True})
            self.reinicio_en = time.monotonic() + self.ventana_vieja
        elif orden == 'estado':
            self.estados += 1
            nuevo = self.reinicio_en is None  # en la ventana vieja, la sesión de lo anterior
            conectado = self.conectado or (nuevo and not self.sin_red and self.estados >= 2)
            broker = self.conectado or (conectado and self.error_broker is None and self.estados >= 3)
            self.responder({'ok': True, 'orden': 'estado', 'configurado': True, 'wifi': 'conectado' if conectado else 'conectando',
                            'broker': 'conectado' if broker else 'desconectado',
                            'ultimo_error': 'wifi' if self.sin_red else (self.error_broker or 'ninguno'), 'publicados': 0, 'fallidos': 0})
        elif orden == 'borrar':
            self.config_nueva = None
            self.responder({'ok': True, 'orden': 'borrar', 'reinicia': True})
            self.reinicio_en = time.monotonic() + self.ventana_vieja
        else:
            self.responder({'ok': False, 'orden': orden or '', 'error': 'orden'})


class PruebaLimpio(unittest.TestCase):
    # Corrección del 25/11/2026: lo que manda el equipo se imprime sin nada invisible ni de control, con la misma regla que el backend
    # (recepcion/texto.ts: categorías C y Z salvo el espacio común): un U+202E invertía el identificador en el aviso de reemplazo.
    def test_sin_invisibles_ni_controles(self):
        self.assertEqual(ce.limpio('nodo\u202e1000-'), 'nodo?1000-')
        self.assertEqual(ce.limpio('a\u200bb\u2028c\u2029d\u00a0e'), 'a?b?c?d?e')
        self.assertEqual(ce.limpio('\x1b[31mrojo\x9b'), '?[31mrojo?')
        self.assertEqual(ce.limpio('señal ñandú 1 2'), 'señal ñandú 1 2')
        self.assertEqual(len(ce.limpio('x' * 100)), 64)


class PruebaCargarEquipo(unittest.TestCase):
    def setUp(self):
        self.maestro, esclavo = os.openpty()
        self.ruta = os.ttyname(esclavo)
        self.esclavo = esclavo  # abierto mientras dure la prueba: sin él, el maestro recibe EIO al cerrar el guion
        self.tmp = tempfile.TemporaryDirectory()
        self.csv = os.path.join(self.tmp.name, 'credenciales.csv')
        with open(self.csv, 'w', encoding='utf-8', newline='') as f:
            f.write(CSV)
        for nombre, valor in {'ESPERA_ORDEN': 0.5, 'ESPERA_SALUDO': 3.0, 'ESPERA_CONEXION': 3.0, 'INTERVALO': 0.05}.items():
            p = mock.patch.object(ce, nombre, valor)
            p.start()
            self.addCleanup(p.stop)

    def tearDown(self):
        os.close(self.maestro)
        os.close(self.esclavo)
        self.tmp.cleanup()

    def correr(self, argv, equipo=None, claves=(CLAVE_RED,)):
        if equipo is not None:
            equipo.start()
        pedidas = []

        def getpass_falso(aviso=''):
            pedidas.append(aviso)
            return claves[len(pedidas) - 1]
        salida, errores = io.StringIO(), io.StringIO()
        with mock.patch.object(ce.getpass, 'getpass', getpass_falso), mock.patch('builtins.input', side_effect=AssertionError('no pregunta')), \
                contextlib.redirect_stdout(salida), contextlib.redirect_stderr(errores):
            codigo = ce.main(['--puerto', self.ruta, *argv])
        if equipo is not None:
            equipo.parar = True
        return codigo, salida.getvalue(), errores.getvalue(), pedidas

    def sin_secretos(self, *textos):
        for t in textos:
            for s in (CLAVE_EQUIPO, CLAVE_RED):
                self.assertNotIn(s, t)

    def test_cargar_desde_el_archivo_del_alta_masiva(self):
        eq = EquipoSimulado(self.maestro)
        argv = ['cargar', '--credenciales', self.csv, '--id', 'nodo-0001', '--red', 'red-de-prueba', '--servidor', 'servidor.ejemplo']
        codigo, out, err, pedidas = self.correr(argv, eq)
        self.assertEqual(codigo, 0, err)
        conf = [o for o in eq.recibidas if o['orden'] == 'configurar']
        self.assertEqual(conf, [{'orden': 'configurar', 'red': 'red-de-prueba', 'clave_red': CLAVE_RED, 'servidor': 'servidor.ejemplo',
                                 'puerto': 8883, 'sitio': 'uct', 'id': 'nodo-0001', 'clave': CLAVE_EQUIPO}])
        self.assertIn('1. Credencial cargada', out)
        self.assertIn('2. Conectó a la red.', out)
        self.assertIn('3. El broker la aceptó.', out)
        self.assertEqual(len(pedidas), 1)  # solo la clave de la red: la credencial viene del archivo
        self.assertIn('no se muestra', pedidas[0])
        self.sin_secretos(out, err, *pedidas, *argv)

    def test_sin_archivo_la_credencial_se_pide_oculta(self):
        eq = EquipoSimulado(self.maestro)
        argv = ['cargar', '--id', 'nodo-0001', '--sitio', 'uct', '--red', 'red-de-prueba', '--servidor', 'servidor.ejemplo']
        codigo, out, err, pedidas = self.correr(argv, eq, claves=(CLAVE_EQUIPO, ''))  # red abierta: clave vacía
        self.assertEqual(codigo, 0, err)
        self.assertEqual(len(pedidas), 2)
        conf = [o for o in eq.recibidas if o['orden'] == 'configurar'][0]
        self.assertEqual((conf['clave'], conf['clave_red']), (CLAVE_EQUIPO, ''))
        self.sin_secretos(out, err, *pedidas)

    def test_ninguna_clave_por_argumentos(self):
        for opcion in ('--clave', '--clave-red', '--credencial'):
            with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
                ce.analizador().parse_args(['--puerto', self.ruta, 'cargar', '--id', 'nodo-0001', '--servidor', 's', opcion, 'x'])

    def test_un_dato_mal_no_abre_el_puerto(self):
        eq = EquipoSimulado(self.maestro)
        codigo, out, err, _ = self.correr(['cargar', '--credenciales', self.csv, '--id', 'nodo-0001', '--red', 'r', '--servidor', 'con espacio'], eq)
        self.assertEqual(codigo, 2)
        self.assertIn('la dirección del servidor', err)
        time.sleep(0.1)
        self.assertEqual(eq.recibidas, [])
        self.sin_secretos(out, err)

    def test_el_equipo_rechaza_un_campo(self):
        eq = EquipoSimulado(self.maestro, rechaza='clave')
        codigo, out, err, _ = self.correr(['cargar', '--credenciales', self.csv, '--id', 'nodo-0001', '--red', 'r', '--servidor', 's.ejemplo'], eq)
        self.assertEqual(codigo, 1)
        self.assertIn('El equipo rechazó la credencial', err)
        self.assertNotIn('1. Credencial cargada', out)
        self.sin_secretos(out, err)

    def test_otro_firmware_no_recibe_nada(self):
        eq = EquipoSimulado(self.maestro, firmware='otro')
        codigo, out, err, _ = self.correr(['cargar', '--credenciales', self.csv, '--id', 'nodo-0001', '--red', 'r', '--servidor', 's.ejemplo'], eq)
        self.assertEqual(codigo, 1)
        self.assertIn('no tiene el firmware de la plataforma', err)
        self.assertEqual([o['orden'] for o in eq.recibidas], ['hola'])

    def test_el_broker_rechaza_la_credencial(self):
        eq = EquipoSimulado(self.maestro, error_broker='credencial')
        codigo, out, err, _ = self.correr(['cargar', '--credenciales', self.csv, '--id', 'nodo-0001', '--red', 'r', '--servidor', 's.ejemplo'], eq)
        self.assertEqual(codigo, 1)
        self.assertIn('2. Conectó a la red.', out)
        self.assertIn('El broker rechazó la credencial', err)
        self.sin_secretos(out, err)

    def test_sin_red(self):
        eq = EquipoSimulado(self.maestro, sin_red=True)
        codigo, out, err, _ = self.correr(['cargar', '--credenciales', self.csv, '--id', 'nodo-0001', '--red', 'r', '--servidor', 's.ejemplo'], eq)
        self.assertEqual(codigo, 1)
        self.assertIn('No encuentra la red', err)

    def test_el_archivo_no_lo_trae_o_no_va_por_mqtt(self):
        for ident, texto in (('nodo-9999', 'no está en'), ('nodo-http', 'no va por MQTT')):
            codigo, out, err, _ = self.correr(['cargar', '--credenciales', self.csv, '--id', ident, '--red', 'r', '--servidor', 's.ejemplo'])
            self.assertEqual(codigo, 2)
            self.assertIn(texto, err)
            self.assertNotIn('otra-clave-falsa', out + err)
            self.assertNotIn('token-falso', out + err)

    def test_un_error_de_forma_sin_orden_no_es_otro_firmware(self):
        eq = EquipoSimulado(self.maestro, basura_inicial=True)
        codigo, out, err, _ = self.correr(['cargar', '--credenciales', self.csv, '--id', 'nodo-0001', '--red', 'r', '--servidor', 's.ejemplo'], eq)
        self.assertEqual(codigo, 0, err)
        self.assertIn('3. El broker la aceptó.', out)

    def test_ruido_y_lineas_enormes_no_estorban(self):
        eq = EquipoSimulado(self.maestro, ruido=True)
        codigo, out, err, _ = self.correr(['cargar', '--credenciales', self.csv, '--id', 'nodo-0001', '--red', 'r', '--servidor', 's.ejemplo'], eq)
        self.assertEqual(codigo, 0, err)
        self.assertNotIn('rrrr', out + err)

    def test_el_cable_se_desconecta_en_configurar(self):
        eq = EquipoSimulado(self.maestro, corta_en_configurar=True)
        codigo, out, err, _ = self.correr(['cargar', '--credenciales', self.csv, '--id', 'nodo-0001', '--red', 'r', '--servidor', 's.ejemplo'], eq)
        self.assertEqual(codigo, 1)
        self.assertIn('no confirmó la carga', err)
        self.assertNotIn('1. Credencial cargada', out)
        self.sin_secretos(out, err)

    def test_el_cable_se_desconecta_al_escribir(self):
        eq = EquipoSimulado(self.maestro)
        escribir = os.write

        def write_falso(fd, datos):
            if b'configurar' in datos:
                raise OSError(5, 'Input/output error')
            return escribir(fd, datos)
        with mock.patch.object(ce.os, 'write', write_falso):
            codigo, out, err, _ = self.correr(['cargar', '--credenciales', self.csv, '--id', 'nodo-0001', '--red', 'r', '--servidor', 's.ejemplo'], eq)
        self.assertEqual(codigo, 1)
        self.assertIn('Se perdió el puerto', err)
        self.assertNotIn('Traceback', err)
        self.sin_secretos(out, err)

    def test_un_archivo_que_no_es_utf8_no_muestra_su_contenido(self):
        with open(self.csv, 'wb') as f:
            f.write(('id_fisico,id,credencial,destino\r\nnodo-0001,x,' + CLAVE_EQUIPO + ',sitio/uct/dispositivo/nodo-0001/<magnitud>\r\n').encode() + b'\xff\xfe\r\n')
        codigo, out, err, _ = self.correr(['cargar', '--credenciales', self.csv, '--id', 'nodo-0001', '--red', 'r', '--servidor', 's.ejemplo'])
        self.assertEqual(codigo, 2)
        self.assertIn('no se puede leer como CSV en UTF-8', err)
        self.sin_secretos(out, err)

    def test_recargar_el_mismo_id_con_una_red_mala_no_da_por_bueno_lo_viejo(self):
        # El caso de la revisión: el equipo sigue contestando con la sesión vieja (conectada) antes de reiniciarse.
        eq = EquipoSimulado(self.maestro, config={'id': 'nodo-0001'}, conectado=True, sin_red=True)
        codigo, out, err, _ = self.correr(['cargar', '--credenciales', self.csv, '--id', 'nodo-0001', '--red', 'r', '--servidor', 's.ejemplo'], eq)
        self.assertEqual(codigo, 1)
        self.assertNotIn('El broker la aceptó', out)
        self.assertIn('No encuentra la red', err)

    def test_otro_identificador_exige_reemplazar(self):
        eq = EquipoSimulado(self.maestro, config={'id': 'nodo-0009'})
        argv = ['cargar', '--credenciales', self.csv, '--id', 'nodo-0001', '--red', 'r', '--servidor', 's.ejemplo']
        codigo, out, err, _ = self.correr(argv, eq)
        self.assertEqual(codigo, 1)
        self.assertIn('ya está cargado como nodo-0009', err)
        self.assertIn('--reemplazar nodo-0009', err)
        self.assertNotIn('configurar', [o['orden'] for o in eq.recibidas])
        eq.parar = False  # el mismo equipo sigue contestando (su hilo está esperando la próxima línea)
        codigo, out, err, _ = self.correr(argv + ['--reemplazar', 'nodo-0008'])
        self.assertEqual(codigo, 1)  # otro identificador escrito: tampoco
        self.assertNotIn('configurar', [o['orden'] for o in eq.recibidas])
        eq.parar = False
        codigo, out, err, _ = self.correr(argv + ['--reemplazar', 'nodo-0009'])
        self.assertEqual(codigo, 0, err)
        self.assertIn('3. El broker la aceptó.', out)

    def test_otra_version_del_protocolo(self):
        for opciones in ({'protocolo': 1}, {'sin_arranque': True}):
            maestro, esclavo = os.openpty()
            try:
                eq = EquipoSimulado(maestro, **opciones)
                eq.start()
                with contextlib.redirect_stderr(io.StringIO()) as e, mock.patch.object(ce.getpass, 'getpass', lambda *_: CLAVE_RED):
                    codigo = ce.main(['--puerto', os.ttyname(esclavo), 'cargar', '--credenciales', self.csv, '--id', 'nodo-0001', '--red', 'r', '--servidor', 's.ejemplo'])
                eq.parar = True
                self.assertEqual(codigo, 1)
                self.assertIn('de otra versión', e.getvalue())
                self.assertNotIn('configurar', [o['orden'] for o in eq.recibidas])
            finally:
                os.close(maestro)
                os.close(esclavo)

    def test_lo_que_manda_el_equipo_no_escribe_secuencias_en_la_terminal(self):
        eq = EquipoSimulado(self.maestro, config={'id': 'nodo\x1b]0;titulo\x07-1'})
        codigo, out, err, _ = self.correr(['hola'], eq)
        self.assertEqual(codigo, 0, err)
        self.assertNotIn('\x1b', out + err)
        self.assertNotIn('\x07', out + err)

    def test_el_puerto_en_uso_por_otro_programa(self):
        import fcntl
        otro = os.open(self.ruta, os.O_RDWR | os.O_NOCTTY)
        try:
            fcntl.flock(otro, fcntl.LOCK_EX | fcntl.LOCK_NB)
            codigo, out, err, _ = self.correr(['hola'])
        finally:
            os.close(otro)
        self.assertEqual(codigo, 1)
        self.assertIn('lo tiene abierto otro programa', err)

    def test_borrar_dice_con_que_arranco(self):
        eq = EquipoSimulado(self.maestro, config={'id': 'nodo-0001'})
        codigo, out, err, _ = self.correr(['borrar'], eq)
        self.assertEqual(codigo, 0, err)
        self.assertIn('arrancó sin configurar', out)
        self.assertNotIn('fábrica', out.replace('no de fábrica', ''))
        self.assertIn('rota también su credencial', out)

    def test_casos_compartidos_con_el_firmware_y_el_panel(self):
        base = {'red': 'red-de-prueba', 'clave_red': 'clave-de-red-falsa', 'servidor': 'servidor.ejemplo', 'puerto': 8883, 'sitio': 'uct',
                'id': 'nodo-0001', 'clave': 'clave-falsa-de-prueba-sin-valor'}
        casos = [l.split('\t') for l in RUTA.with_name('casos-validacion.txt').read_text(encoding='utf-8').splitlines() if l and not l.startswith('#')]
        self.assertGreaterEqual(len(casos), 25)
        for campo, fragmento in casos:
            with self.subTest(fragmento=fragmento[:40]):
                self.assertEqual(ce.campo_invalido({**base, **json.loads('{' + fragmento + '}')}), None if campo == 'ninguno' else campo)

    def test_equipo_mudo(self):
        with mock.patch.object(ce, 'ESPERA_SALUDO', 0.6):
            codigo, out, err, _ = self.correr(['hola'])
        self.assertEqual(codigo, 1)
        self.assertIn('no responde', err)

    def test_hola_y_estado_no_traen_secretos(self):
        eq = EquipoSimulado(self.maestro)
        eq.config = {'id': 'nodo-0001', 'clave': CLAVE_EQUIPO, 'clave_red': CLAVE_RED}
        codigo, out, err, _ = self.correr(['hola'], eq)
        self.assertEqual(codigo, 0, err)
        self.assertIn('configurado', out)
        self.assertIn('nodo-0001', out)
        self.sin_secretos(out, err)


if __name__ == '__main__':
    unittest.main(verbosity=1)
