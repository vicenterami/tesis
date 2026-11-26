// Protocolo de configuración por el puerto serie (docs/17 §6.4; tabla de órdenes en docs/19 §4, bloque Z, punto 2). C++ sin dependencias
// del núcleo de Arduino: lo usa src/nodo.cpp y lo prueba herramientas/probar-protocolo.sh en el computador, sin placa.
//   - Una orden por línea: un objeto JSON plano (valores de texto o enteros no negativos), de a lo más LARGO_LINEA bytes.
//   - Las reglas de cada campo son las del alta y las del panel (lib/serie.ts): si cambian, cambian en los tres.
// Ningún texto de aquí devuelve un secreto: los errores nombran el campo, nunca su valor.
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace protocolo {

static constexpr size_t LARGO_LINEA = 512;
static constexpr uint16_t VERSION_REGISTRO = 1;  // del registro guardado en la memoria no volátil; otro número = registro ajeno
static constexpr const char *PREFIJO = "@plataforma ";
static constexpr int VERSION_PROTOCOLO = 2;  // 2 (25/11/2026): `hola` trae `arranque`, que cambia en cada inicio

// El registro que se guarda entero (un solo valor en NVS: escribirlo es atómico). Los tamaños incluyen el terminador.
struct Config {
  uint16_t version;
  uint16_t puerto;
  char red[33];       // SSID: hasta 32 bytes (802.11)
  char claveRed[64];  // vacía (red abierta) o de 8 a 63 caracteres (frase WPA2)
  char servidor[64];  // nombre o IPv4
  char sitio[64];     // código del sitio: ^[a-z0-9][a-z0-9-]{1,62}$
  char id[64];        // identificador físico, usuario del broker: ^[a-z0-9][a-z0-9-]{2,62}$
  char clave[129];    // credencial del alta
};

// Lo que trae una línea. `tiene*` distingue «vino vacío» de «no vino».
struct Orden {
  char orden[16];
  char red[33], claveRed[64], servidor[64], sitio[64], id[64], clave[129];
  bool tieneRed, tieneClaveRed, tieneServidor, tieneSitio, tieneId, tieneClave, tienePuerto;
  long puerto;
  const char *excedido;  // el primer campo cuyo texto no cabía (se rechaza por su largo), o nullptr
};

enum class Lectura { ok, json, larga };

// Borra memoria que tuvo un secreto; con `volatile`, el compilador no puede saltarse la escritura por ser «la última».
inline void borrarSeguro(void *p, size_t n) {
  volatile unsigned char *q = static_cast<volatile unsigned char *>(p);
  while (n--) *q++ = 0;
}

// Copia `n` bytes a `dst` si caben (con su terminador); si no, marca `largo` y deja el destino vacío.
inline bool copiar(char *dst, size_t cap, const char *src, size_t n) {
  if (n + 1 > cap) { dst[0] = '\0'; return false; }
  memcpy(dst, src, n);
  dst[n] = '\0';
  return true;
}

inline void saltarBlancos(const char *&p, const char *fin) {
  while (p < fin && (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n')) p++;
}

// Lee un texto JSON (con su comilla de apertura en *p) a `buf`; devuelve su largo, o -1 si está mal formado o no cabe en `cap`.
inline long leerTexto(const char *&p, const char *fin, char *buf, size_t cap) {
  if (p >= fin || *p != '"') return -1;
  p++;
  size_t n = 0;
  auto poner = [&](unsigned char c) -> bool { if (n + 1 >= cap) return false; buf[n++] = static_cast<char>(c); return true; };
  while (p < fin) {
    const unsigned char c = static_cast<unsigned char>(*p++);
    if (c == '"') { buf[n] = '\0'; return static_cast<long>(n); }
    if (c < 0x20) return -1;  // un control sin escapar no es JSON
    if (c != '\\') { if (!poner(c)) return -1; continue; }
    if (p >= fin) return -1;
    const char e = *p++;
    unsigned char simple = 0;
    switch (e) {
      case '"': simple = '"'; break;
      case '\\': simple = '\\'; break;
      case '/': simple = '/'; break;
      case 'b': simple = '\b'; break;
      case 'f': simple = '\f'; break;
      case 'n': simple = '\n'; break;
      case 'r': simple = '\r'; break;
      case 't': simple = '\t'; break;
      case 'u': {
        if (fin - p < 4) return -1;
        unsigned cp = 0;
        for (int i = 0; i < 4; i++) {
          const char h = *p++;
          cp <<= 4;
          if (h >= '0' && h <= '9') cp |= static_cast<unsigned>(h - '0');
          else if (h >= 'a' && h <= 'f') cp |= static_cast<unsigned>(h - 'a' + 10);
          else if (h >= 'A' && h <= 'F') cp |= static_cast<unsigned>(h - 'A' + 10);
          else return -1;
        }
        if (cp >= 0xD800 && cp <= 0xDFFF) return -1;  // pares sustitutos: ningún campo los necesita
        if (cp == 0) return -1;  // el nulo cortaría el campo en C y lo que sigue saltaría la validación (revisión del 25/11/2026)
        if (cp < 0x80) { if (!poner(static_cast<unsigned char>(cp))) return -1; }
        else if (cp < 0x800) { if (!poner(0xC0 | (cp >> 6)) || !poner(0x80 | (cp & 0x3F))) return -1; }
        else if (!poner(0xE0 | (cp >> 12)) || !poner(0x80 | ((cp >> 6) & 0x3F)) || !poner(0x80 | (cp & 0x3F))) return -1;
        continue;
      }
      default: return -1;
    }
    if (!poner(simple)) return -1;
  }
  return -1;  // sin comilla de cierre
}

// Una línea → la orden. Claves desconocidas se ignoran (una versión más nueva del panel no rompe a una más vieja del firmware); un valor
// de tipo equivocado (texto donde va un número o al revés; true, false, null, objetos, listas, negativos o decimales) o cualquier cosa que
// no sea un objeto plano → Lectura::json. Un texto más largo que su campo no es error de forma: queda en `excedido` y la validación
// rechaza ese campo por su largo.
inline Lectura leerOrden(const char *linea, size_t n, Orden &o) {
  memset(&o, 0, sizeof(o));
  if (n > LARGO_LINEA) return Lectura::larga;
  const char *p = linea, *fin = linea + n;
  saltarBlancos(p, fin);
  if (p >= fin || *p != '{') return Lectura::json;
  p++;
  saltarBlancos(p, fin);
  if (p < fin && *p == '}') { p++; saltarBlancos(p, fin); return p == fin ? Lectura::ok : Lectura::json; }
  char clave[LARGO_LINEA + 1];
  char valor[LARGO_LINEA + 1];
  Lectura r = Lectura::json;
  for (;;) {
    saltarBlancos(p, fin);
    if (leerTexto(p, fin, clave, sizeof(clave)) < 0) break;
    saltarBlancos(p, fin);
    if (p >= fin || *p != ':') break;
    p++;
    saltarBlancos(p, fin);
    if (p >= fin) break;
    long largo = -1;
    bool esNumero = false;
    long numero = 0;
    if (*p == '"') {
      largo = leerTexto(p, fin, valor, sizeof(valor));
      if (largo < 0) break;
    } else if (*p >= '0' && *p <= '9') {
      esNumero = true;
      int cifras = 0;
      while (p < fin && *p >= '0' && *p <= '9' && ++cifras <= 6) numero = numero * 10 + (*p++ - '0');
      if (cifras > 6 || (p < fin && (*p == '.' || *p == 'e' || *p == 'E'))) break;
    } else {
      break;
    }
    struct Campo { const char *nombre; char *dst; size_t cap; bool *tiene; };
    const Campo campos[] = {
      {"orden", o.orden, sizeof(o.orden), nullptr}, {"red", o.red, sizeof(o.red), &o.tieneRed},
      {"clave_red", o.claveRed, sizeof(o.claveRed), &o.tieneClaveRed}, {"servidor", o.servidor, sizeof(o.servidor), &o.tieneServidor},
      {"sitio", o.sitio, sizeof(o.sitio), &o.tieneSitio}, {"id", o.id, sizeof(o.id), &o.tieneId}, {"clave", o.clave, sizeof(o.clave), &o.tieneClave},
    };
    bool malTipo = false;
    if (strcmp(clave, "puerto") == 0) {
      malTipo = !esNumero;
      o.tienePuerto = esNumero;
      o.puerto = numero;
    } else {
      for (const Campo &c : campos) {
        if (strcmp(clave, c.nombre) != 0) continue;
        if (esNumero) { malTipo = true; break; }
        if (c.tiene != nullptr) *c.tiene = true;
        if (!copiar(c.dst, c.cap, valor, static_cast<size_t>(largo))) {
          if (c.tiene == nullptr) malTipo = true;  // una orden que no cabe no es ninguna orden conocida
          else if (o.excedido == nullptr) o.excedido = c.nombre;
        }
        break;
      }
    }
    borrarSeguro(valor, sizeof(valor));  // el valor pudo ser una clave: no queda en la pila
    if (malTipo) break;
    saltarBlancos(p, fin);
    if (p < fin && *p == ',') { p++; continue; }
    if (p < fin && *p == '}') { p++; saltarBlancos(p, fin); r = p == fin ? Lectura::ok : Lectura::json; }
    break;
  }
  borrarSeguro(valor, sizeof(valor));
  borrarSeguro(clave, sizeof(clave));  // en una línea mal formada, un secreto pudo quedar donde va el nombre de un campo
  if (r != Lectura::ok) borrarSeguro(&o, sizeof(o));  // una línea mal formada no deja nada a medias (ni una clave)
  return r;
}

inline bool minusculaODigito(char c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'); }

// ^[a-z0-9][a-z0-9-]{min-1,max-1}$
inline bool formaCodigo(const char *s, size_t min, size_t max) {
  const size_t n = strlen(s);
  if (n < min || n > max || !minusculaODigito(s[0])) return false;
  for (size_t i = 1; i < n; i++) if (!minusculaODigito(s[i]) && s[i] != '-') return false;
  return true;
}

inline bool imprimibles(const char *s, unsigned char desde) {
  for (const unsigned char *p = reinterpret_cast<const unsigned char *>(s); *p; p++) if (*p < desde || *p > 0x7E) return false;
  return true;
}

// El primer campo que no cumple su regla, o nullptr si todos la cumplen. Mismas reglas en lib/serie.ts (validarDatos).
inline const char *campoInvalido(const Orden &o) {
  if (o.excedido != nullptr) return o.excedido;
  const size_t nRed = strlen(o.red);
  if (!o.tieneRed || nRed < 1 || nRed > 32) return "red";
  for (const unsigned char *p = reinterpret_cast<const unsigned char *>(o.red); *p; p++) if (*p < 0x20 || *p == 0x7F) return "red";
  const size_t nClaveRed = strlen(o.claveRed);
  if (!o.tieneClaveRed || (nClaveRed != 0 && (nClaveRed < 8 || nClaveRed > 63)) || !imprimibles(o.claveRed, 0x20)) return "clave_red";
  const size_t nServidor = strlen(o.servidor);
  if (!o.tieneServidor || nServidor < 1 || nServidor > 63 || o.servidor[0] == '-' || o.servidor[0] == '.') return "servidor";
  for (const char *p = o.servidor; *p; p++) {
    const char c = *p;
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '-')) return "servidor";
  }
  if (!o.tienePuerto || o.puerto < 1 || o.puerto > 65535) return "puerto";
  if (!o.tieneSitio || !formaCodigo(o.sitio, 2, 63)) return "sitio";
  if (!o.tieneId || !formaCodigo(o.id, 3, 63)) return "id";
  const size_t nClave = strlen(o.clave);
  if (!o.tieneClave || nClave < 16 || nClave > 128 || !imprimibles(o.clave, 0x21)) return "clave";
  return nullptr;
}

// La orden ya validada → el registro que se guarda.
inline void aConfig(const Orden &o, Config &c) {
  memset(&c, 0, sizeof(c));
  c.version = VERSION_REGISTRO;
  c.puerto = static_cast<uint16_t>(o.puerto);
  strcpy(c.red, o.red);
  strcpy(c.claveRed, o.claveRed);
  strcpy(c.servidor, o.servidor);
  strcpy(c.sitio, o.sitio);
  strcpy(c.id, o.id);
  strcpy(c.clave, o.clave);
}

// Arma las líneas que llegan por el puerto, byte a byte y sin bloquear. Una línea a medias que se queda sin bytes ESPERA_LINEA_MS (el
// cable se desconectó en medio de `configurar`, o el programa del otro lado se cerró) se borra entera: no queda un trozo de clave en la
// memoria ni se pega al comienzo de la orden siguiente (que entonces llegaría mal formada).
static constexpr uint32_t ESPERA_LINEA_MS = 2000;
struct Armador {
  enum class Evento { nada, linea, larga };
  char linea[LARGO_LINEA + 1];
  size_t largo;
  bool desbordada;
  uint32_t ultimoMs;
  void descartar() { borrarSeguro(linea, sizeof(linea)); largo = 0; desbordada = false; }
  // Lo que se tenía a medias y venció: se descarta (llamar antes de cada lectura). Devuelve si descartó algo.
  bool vencer(uint32_t ahoraMs) {
    if ((largo == 0 && !desbordada) || ahoraMs - ultimoMs < ESPERA_LINEA_MS) return false;
    descartar();
    return true;
  }
  // Un byte. `linea`: hay una línea completa en linea[0..largo) (quien la procesa llama después a descartar); `larga`: la que terminó
  // no cabía y ya se descartó. Los \r se ignoran.
  Evento poner(unsigned char c, uint32_t ahoraMs) {
    ultimoMs = ahoraMs;
    if (c == '\r') return Evento::nada;
    if (c == '\n') {
      if (desbordada) { descartar(); return Evento::larga; }
      if (largo == 0) return Evento::nada;
      linea[largo] = '\0';
      return Evento::linea;
    }
    if (largo < LARGO_LINEA) linea[largo++] = static_cast<char>(c);
    else desbordada = true;
    return Evento::nada;
  }
};

// Un texto como valor JSON (con sus comillas) en `dst`; solo para lo que no es secreto (el identificador, el nombre del firmware).
inline void textoJson(char *dst, size_t cap, const char *s) {
  size_t n = 0;
  auto poner = [&](char c) { if (n + 2 < cap) dst[n++] = c; };
  poner('"');
  for (const unsigned char *p = reinterpret_cast<const unsigned char *>(s); *p; p++) {
    if (*p == '"' || *p == '\\') { poner('\\'); poner(static_cast<char>(*p)); }
    else if (*p < 0x20) poner('?');
    else poner(static_cast<char>(*p));
  }
  if (n + 1 < cap) dst[n++] = '"';
  dst[n] = '\0';
}

}  // namespace protocolo
