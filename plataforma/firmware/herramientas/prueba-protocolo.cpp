// Pruebas del protocolo de configuración por el puerto serie (include/protocolo.h; docs/17 §6.4), compiladas y corridas en el computador,
// sin placa: herramientas/probar-protocolo.sh. Las claves de aquí son evidentemente falsas.
#include "protocolo.h"
#include <cstdio>
#include <fstream>
#include <string>

using namespace protocolo;

static int fallas = 0, total = 0;
static void comprobar(bool ok, const char *que) {
  total++;
  if (!ok) { fallas++; std::printf("FALLA %s\n", que); }
}
static Lectura leer(const std::string &s, Orden &o) { return leerOrden(s.data(), s.size(), o); }
static std::string conf(const std::string &cambio) {
  // Una orden válida; `cambio` reemplaza o agrega campos al final (JSON permite claves repetidas: vale la última).
  std::string base = R"({"orden":"configurar","red":"red-de-prueba","clave_red":"clave-de-red-falsa","servidor":"servidor.ejemplo","puerto":8883,"sitio":"uct","id":"nodo-0001","clave":"clave-falsa-de-prueba-sin-valor")";
  return base + (cambio.empty() ? "" : "," + cambio) + "}";
}
static const char *invalido(const std::string &cambio) {
  Orden o;
  if (leer(conf(cambio), o) != Lectura::ok) return "(json)";
  const char *c = campoInvalido(o);
  return c == nullptr ? "(ninguno)" : c;
}
static bool igual(const char *a, const char *b) { return std::string(a) == b; }

int main() {
  Orden o;
  comprobar(leer(R"({"orden":"hola"})", o) == Lectura::ok && igual(o.orden, "hola"), "hola se lee");
  comprobar(leer(" { \"orden\" : \"estado\" } \r", o) == Lectura::ok && igual(o.orden, "estado"), "blancos alrededor");
  comprobar(leer(R"({"orden":"borrar","otra":"cosa","n":5})", o) == Lectura::ok && igual(o.orden, "borrar"), "claves desconocidas se ignoran");

  comprobar(leer(conf(""), o) == Lectura::ok && campoInvalido(o) == nullptr, "configurar completo y válido");
  Config c;
  aConfig(o, c);
  comprobar(c.version == VERSION_REGISTRO && c.puerto == 8883 && igual(c.red, "red-de-prueba") && igual(c.servidor, "servidor.ejemplo") &&
            igual(c.sitio, "uct") && igual(c.id, "nodo-0001") && igual(c.clave, "clave-falsa-de-prueba-sin-valor"), "aConfig copia cada campo");

  // Cada campo con su regla: el primero que no la cumple se nombra (nunca su valor).
  struct Caso { std::string cambio; const char *campo; };
  const Caso casos[] = {
    {R"("red":"")", "red"},
    {R"("red":"123456789012345678901234567890123")", "red"},          // 33 bytes
    {R"("red":"a\tb")", "red"},                                        // un control
    {R"("clave_red":"corta12")", "clave_red"},                        // 7
    {R"("clave_red":")" + std::string(64, 'x') + "\"", "clave_red"},  // 64
    {R"("clave_red":")" + std::string(100, 'x') + "\"", "clave_red"}, // no cabe: no se toma como red abierta
    {R"("servidor":"")", "servidor"},
    {R"("servidor":"-malo")", "servidor"},
    {R"("servidor":"con espacio")", "servidor"},
    {R"("servidor":"a/b")", "servidor"},
    {R"("puerto":0)", "puerto"},
    {R"("puerto":65536)", "puerto"},
    {R"("sitio":"u")", "sitio"},
    {R"("sitio":"UCT")", "sitio"},
    {R"("id":"no")", "id"},
    {R"("id":"Nodo-1")", "id"},
    {R"("id":"-nodo")", "id"},
    {R"("clave":"corta")", "clave"},
    {R"("clave":"con espacio 000000000")", "clave"},
    {R"("clave":")" + std::string(129, 'k') + "\"", "clave"},
  };
  for (const Caso &k : casos) {
    char que[200];
    std::snprintf(que, sizeof(que), "%.60s → rechaza «%s»", k.cambio.c_str(), k.campo);
    comprobar(igual(invalido(k.cambio), k.campo), que);
  }
  // Lo que sí vale.
  comprobar(igual(invalido(R"("clave_red":"")"), "(ninguno)"), "clave de red vacía = red abierta");
  comprobar(igual(invalido(R"("clave_red":"12345678")"), "(ninguno)"), "clave de red de 8");
  comprobar(igual(invalido(R"("servidor":"192.0.2.10")"), "(ninguno)"), "servidor por IPv4 (de documentación, RFC 5737)");
  comprobar(igual(invalido(R"("clave":"Ab-_0123456789xyzABCDEFGHIJKLMNOP")"), "(ninguno)"), "credencial base64url de 32");
  comprobar(igual(invalido(R"("clave":"abc+/=0123456789")"), "(ninguno)"), "credencial base64 con + / =");
  // Una red con tilde: en bytes UTF-8 tal cual o con é (lo que podría mandar otro cliente) es la misma.
  Orden a, b;
  leer(conf(R"("red":"Café")"), a);
  leer(conf(R"("red":"Caf\u00e9")"), b);
  comprobar(campoInvalido(a) == nullptr && igual(a.red, b.red) && std::string(a.red).size() == 5, "red con tilde, cruda o escapada");

  // Forma: nada a medias.
  comprobar(leer(std::string(LARGO_LINEA + 1, ' '), o) == Lectura::larga, "más de 512 bytes → larga");
  const char *malas[] = {
    "hola", "", "{", "[]", R"({"orden":hola})", R"({"orden":"hola"} x)", R"({"orden":"hola",})", R"({"orden":true})",
    R"({"orden":null})", R"({"puerto":"8883"})", R"({"puerto":-1})", R"({"puerto":88.3})", R"({"puerto":1234567})", R"({"red":{"a":1}})",
    R"({"red":["a"]})", R"({"orden":"configurar","id":5})", R"({"orden":"\ud83d\ude00"})", R"({"orden":"esta-orden-no-cabe-en-dieciseis"})",
    R"({"orden":"hola\x"})", "{\"orden\":\"a\nb\"}",
  };
  for (const char *m : malas) {
    char que[200];
    std::snprintf(que, sizeof(que), "%s → json", m);
    comprobar(leer(m, o) == Lectura::json, que);
  }
  // Una línea mal formada que alcanzó a traer la clave no la deja en la orden.
  leer(R"({"orden":"configurar","clave":"clave-falsa-de-prueba-sin-valor","puerto":"x"})", o);
  comprobar(o.clave[0] == '\0' && !o.tieneClave, "línea mal formada: la clave no queda");

  // El armador de líneas (src/nodo.cpp, atenderSerie): una orden entera, una que no cabe y una a medias que vence.
  {
    Armador a = {};
    const std::string orden = conf("") + "\r\n";
    Armador::Evento e = Armador::Evento::nada;
    for (char ch : orden) e = a.poner(static_cast<unsigned char>(ch), 100);
    comprobar(e == Armador::Evento::linea && leer(std::string(a.linea, a.largo), o) == Lectura::ok && igual(o.orden, "configurar"), "armador: una orden entera (sin el \\r)");
    a.descartar();
    comprobar(a.largo == 0 && a.linea[0] == '\0', "armador: descartar la borra");
    for (size_t i = 0; i < LARGO_LINEA + 10; i++) a.poner('x', 200);
    comprobar(a.poner('\n', 200) == Armador::Evento::larga && a.largo == 0, "armador: más de 512 bytes → larga, y se descarta");
    // El cable se desconecta en medio de `configurar`: la mitad con la clave queda a medias.
    const std::string mitad = conf("").substr(0, conf("").size() - 8);
    for (char ch : mitad) a.poner(static_cast<unsigned char>(ch), 1000);
    comprobar(!a.vencer(1000 + ESPERA_LINEA_MS - 1), "armador: a medias, todavía no vence");
    comprobar(a.vencer(1000 + ESPERA_LINEA_MS) && a.largo == 0 && std::string(a.linea, sizeof(a.linea)).find("clave-falsa") == std::string::npos,
              "armador: a medias 2 s sin bytes → se borra (ni un trozo de la clave)");
    // Y la orden siguiente llega limpia (sin el trozo viejo pegado al comienzo).
    const std::string hola = "{\"orden\":\"hola\"}\n";
    for (char ch : hola) e = a.poner(static_cast<unsigned char>(ch), 5000);
    comprobar(e == Armador::Evento::linea && leer(std::string(a.linea, a.largo), o) == Lectura::ok && igual(o.orden, "hola"), "armador: tras vencer, la orden siguiente se lee bien");
    a.descartar();
    comprobar(!a.vencer(100000), "armador: vacío no vence");
  }

  // Los casos compartidos con el guion y el panel (herramientas/casos-validacion.txt): las tres implementaciones rechazan lo mismo.
  {
    std::ifstream f("herramientas/casos-validacion.txt");
    std::string l;
    int casos = 0, malos = 0;
    while (std::getline(f, l)) {
      if (l.empty() || l[0] == '#') continue;
      const size_t tab = l.find('\t');
      const std::string campo = l.substr(0, tab), fragmento = l.substr(tab + 1);
      const std::string visto = invalido(fragmento);
      const bool bien = campo == "ninguno" ? visto == "(ninguno)" : (visto == campo || (visto == "(json)" && fragmento.find("\\u0000") != std::string::npos));
      casos++;
      if (!bien) { malos++; std::printf("  caso compartido: %s → %s (esperado %s)\n", fragmento.substr(0, 40).c_str(), visto.c_str(), campo.c_str()); }
    }
    comprobar(casos >= 25 && malos == 0, "los casos compartidos con el guion y el panel (casos-validacion.txt)");
  }
  {
    Orden n;
    comprobar(leer(R"({"orden":"configurar","clave":"abcdefghijklmnop\u0000XYZ"})", n) == Lectura::json && n.clave[0] == '\0', "un nulo en un texto: la línea se rechaza y no queda nada");
  }

  char json[64];
  textoJson(json, sizeof(json), "a\"b\\c");
  comprobar(igual(json, R"("a\"b\\c")"), "textoJson escapa comillas y barras");

  std::printf("%d de %d comprobaciones%s\n", total - fallas, total, fallas == 0 ? "" : " (hay fallas)");
  return fallas == 0 ? 0 : 1;
}
