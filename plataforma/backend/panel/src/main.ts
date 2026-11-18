import { mount } from 'svelte';
import App from './App.svelte';
import { esRutaPublica, leerTokenPublico } from './lib/publico';
import './app.css';

// Sin scripts en línea: la CSP del backend (`default-src 'self'`) los prohíbe; Vite deja este módulo como archivo aparte.
const destino = document.getElementById('app');
if (destino === null) throw new Error('falta el elemento #app');

// La vista pública por enlace (P9; docs/19 §4, O, punto 5) se resuelve ANTES de montar la aplicación: con `#/v/<token>` se monta solo su
// pantalla (Publico.svelte, cargada a pedido), sin pedir la sesión ni la salud ni leer preferencias, y la ruta nunca llega al ruteo de
// App (no cuenta como «última vista» ni se guarda como vista). El token se lee aquí y pasa como propiedad; no se guarda en ningún lado.
// Si el fragmento cambia de una a otra (de la vista pública al panel, de un enlace a otro, o del panel a un enlace), se recarga la
// página: cada una arranca limpia, sin heredar nada de la otra.
const publica = esRutaPublica(window.location.hash);
const tokenAlCargar = publica ? leerTokenPublico(window.location.hash) : null;
window.addEventListener('hashchange', () => {
  const ahoraPublica = esRutaPublica(window.location.hash);
  if (ahoraPublica !== publica || (publica && leerTokenPublico(window.location.hash) !== tokenAlCargar)) window.location.reload();
});
if (publica) {
  import('./Publico.svelte')
    .then(({ default: Publico }) => mount(Publico, { target: destino, props: { token: tokenAlCargar } }))
    .catch(() => (destino.textContent = 'No se pudo cargar la vista pública (¿se cortó la conexión?): recarga la página.'));
} else {
  mount(App, { target: destino });
}
