#!/usr/bin/env python3
"""
Generador y validador de mensajes Ademco Contact ID (SIA DC-05).

Herramienta de apoyo al análisis del protocolo (OE2). Permite verificar
empíricamente la gramática del mensaje, el cálculo del checksum y el tamaño
resultante, en lugar de asumirlos.

Formato del bloque de mensaje según SIA DC-05:

    ACCT  MT  Q  XYZ  GG  CCC  S

    ACCT  4 dígitos  número de abonado
    MT    2 dígitos  tipo de mensaje, siempre 18 (preferido) o 98
    Q     1 dígito   1 = nuevo evento · 3 = restauración · 6 = estado presente
    XYZ   3 dígitos  código de evento
    GG    2 dígitos  grupo o partición (00 = no aplica)
    CCC   3 dígitos  zona (evento) o usuario (apertura/cierre); 000 = no aplica
    S     1 dígito   checksum

El alfabeto es de 15 símbolos: los dígitos 1-9 valen su cifra, el símbolo 0
vale 10, y B, C, D, E, F valen 11 a 15. El checksum S es el valor que cumple
(suma de todos los dígitos + S) mod 15 == 0.
"""

VALORES = {str(d): d for d in range(1, 10)}
VALORES["0"] = 10
for i, s in enumerate("BCDEF", start=11):
    VALORES[s] = i

SIMBOLO = {v: k for k, v in VALORES.items()}


def valor(digito: str) -> int:
    """Valor numérico de un dígito Contact ID (0 vale 10, B-F valen 11-15)."""
    d = digito.upper()
    if d not in VALORES:
        raise ValueError(f"dígito no válido en Contact ID: {digito!r}")
    return VALORES[d]


def checksum(cuerpo: str) -> str:
    """Dígito de checksum para los 15 dígitos del cuerpo del mensaje."""
    cuerpo = cuerpo.replace(" ", "")
    if len(cuerpo) != 15:
        raise ValueError(f"el cuerpo debe tener 15 dígitos, tiene {len(cuerpo)}")
    suma = sum(valor(d) for d in cuerpo)
    faltante = (15 - (suma % 15)) % 15
    return SIMBOLO[15 if faltante == 0 else faltante]


def construir(acct: str, q: str, evento: str, grupo: str = "00",
              zona: str = "000", mt: str = "18") -> str:
    """Mensaje Contact ID completo de 16 dígitos, con checksum calculado."""
    for nombre, campo, largo in (("ACCT", acct, 4), ("MT", mt, 2), ("Q", q, 1),
                                 ("XYZ", evento, 3), ("GG", grupo, 2), ("CCC", zona, 3)):
        if len(campo) != largo:
            raise ValueError(f"{nombre} debe tener {largo} dígitos, recibió {campo!r}")
    cuerpo = f"{acct}{mt}{q}{evento}{grupo}{zona}"
    return cuerpo + checksum(cuerpo)


def validar(mensaje: str) -> bool:
    """Verifica que un mensaje de 16 dígitos tenga checksum correcto."""
    m = mensaje.replace(" ", "").upper()
    if len(m) != 16:
        raise ValueError(f"el mensaje debe tener 16 dígitos, tiene {len(m)}")
    return (sum(valor(d) for d in m) % 15) == 0


def descomponer(mensaje: str) -> dict:
    """Separa un mensaje en sus campos."""
    m = mensaje.replace(" ", "").upper()
    return {
        "ACCT": m[0:4], "MT": m[4:6], "Q": m[6], "XYZ": m[7:10],
        "GG": m[10:12], "CCC": m[12:15], "S": m[15],
        "checksum_valido": validar(m),
    }


def a_bcd(mensaje: str) -> bytes:
    """
    Empaqueta el mensaje en BCD comprimido: dos dígitos por byte.
    16 dígitos → 8 bytes. Los símbolos B-F ocupan los nibbles 0xB-0xF.
    """
    m = mensaje.replace(" ", "").upper()
    if len(m) % 2:
        raise ValueError("se requiere un número par de dígitos")
    nibble = lambda d: 0x0 if d == "0" else int(d, 16)
    return bytes((nibble(m[i]) << 4) | nibble(m[i + 1]) for i in range(0, len(m), 2))


# Códigos de evento relevantes para gestión de sensores IoT (subconjunto DC-05)
CODIGOS = {
    "110": "Alarma de incendio",
    "114": "Sensor de calor",
    "130": "Intrusión",
    "132": "Intrusión perimetral",
    "134": "Intrusión entrada/salida",
    "150": "Alarma auxiliar 24 h (no incendio, no intrusión)",
    "154": "Fuga de agua",
    "158": "Temperatura alta",
    "159": "Temperatura baja",
    "161": "Pérdida de flujo de aire",
    "200": "Supervisión de incendio",
    "300": "Problema de sistema",
    "301": "Pérdida de alimentación de red",
    "302": "Batería baja del sistema",
    "305": "Reinicio del sistema",
    "344": "Interferencia detectada en receptor RF (jamming)",
    "350": "Problema de comunicación",
    "354": "Falla al comunicar el evento",
    "380": "Problema de sensor / avería",
    "381": "Pérdida de supervisión RF (el nodo dejó de reportar)",
    "383": "Manipulación de sensor (tamper)",
    "384": "Batería baja en zona RF",
    "400": "Apertura / cierre",
    "570": "Zona anulada (bypass)",
    "602": "Reporte de prueba periódico",
    "603": "Transmisión RF periódica (heartbeat)",
}


if __name__ == "__main__":
    print(__doc__.strip())
    print("\n" + "=" * 78)
    print("VERIFICACIÓN DE EJEMPLOS")
    print("=" * 78)

    ejemplos = [
        ("Nodo 007 dejó de reportar (pérdida de supervisión RF)", "1234", "1", "381", "00", "007"),
        ("Restauración: el nodo 007 volvió a reportar",           "1234", "3", "381", "00", "007"),
        ("Batería baja en el nodo 012",                            "1234", "1", "384", "00", "012"),
        ("Temperatura alta en cámara de frío, zona 003",           "1234", "1", "158", "01", "003"),
        ("Puerta abierta, zona 021",                              "1234", "1", "134", "02", "021"),
        ("Heartbeat periódico del sistema",                       "1234", "1", "602", "00", "000"),
        ("Interferencia RF detectada en el gateway",              "1234", "1", "344", "00", "000"),
    ]

    for desc, acct, q, ev, gg, ccc in ejemplos:
        msg = construir(acct, q, ev, gg, ccc)
        bcd = a_bcd(msg)
        print(f"\n{desc}")
        print(f"  código {ev}: {CODIGOS.get(ev, '—')}")
        print(f"  mensaje  : {msg[0:4]} {msg[4:6]} {msg[6]} {msg[7:10]} {msg[10:12]} {msg[12:15]} {msg[15]}")
        print(f"  plano    : {msg}   ({len(msg)} dígitos)")
        print(f"  BCD      : {bcd.hex(' ')}   ({len(bcd)} bytes)")
        print(f"  checksum : {'válido' if validar(msg) else 'INVÁLIDO'}")

    print("\n" + "=" * 78)
    print("RESUMEN DE TAMAÑO")
    print("=" * 78)
    m = construir("1234", "1", "381", "00", "007")
    print(f"  Mensaje en dígitos ASCII : {len(m)} bytes")
    print(f"  Mensaje en BCD comprimido: {len(a_bcd(m))} bytes")
    print(f"  Payload útil LoRaWAN AU915, peor caso (DR2 con dwell time): 11 bytes")
    print(f"  → cabe con {11 - len(a_bcd(m))} bytes de margen")

    print("\n" + "=" * 78)
    print("PRUEBA DE VALIDACIÓN: mensaje con un dígito alterado")
    print("=" * 78)
    corrupto = m[:-2] + ("8" if m[-2] != "8" else "7") + m[-1]
    print(f"  original : {m}          → checksum {'válido' if validar(m) else 'INVÁLIDO'}")
    print(f"  alterado : {corrupto}          → checksum {'válido' if validar(corrupto) else 'INVÁLIDO'}")
