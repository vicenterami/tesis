<script lang="ts">
  // P11 mínima (docs/19 §4, tablero v2, A1; P11): el pie «Legal y acerca de» de toda pantalla lleva aquí, también antes de entrar. Hoy:
  // el aviso de la licencia AGPL del sistema y los avisos de terceros que el paquete del panel debe acompañar (un archivo que ya se
  // sirve junto al panel). Privacidad, términos y soporte llegan con su propio bloque (P11 completa), sin cambiar esta ruta.
  const avisos = `${import.meta.env.BASE_URL}avisos-de-terceros.txt`;
</script>

<div class="legal" data-legal>
  <h2>Legal y acerca de</h2>
  <section aria-labelledby="titulo-licencia">
    <h3 id="titulo-licencia">Licencia</h3>
    <p>Este sistema es software libre bajo la licencia <strong>GNU Affero General Public License, versión 3</strong> (AGPL-3.0-only): puedes
      usarlo, estudiarlo, modificarlo y redistribuirlo. Si lo ofreces como servicio en una red, debes ofrecer también su código fuente a
      quienes lo usen, con tus cambios.</p>
  </section>
  <section aria-labelledby="titulo-terceros">
    <h3 id="titulo-terceros">Avisos de terceros</h3>
    <p>El panel incluye bibliotecas de terceros bajo sus propias licencias: <a href={avisos} data-avisos-terceros>avisos de terceros (texto)</a>.</p>
  </section>
  <section aria-labelledby="titulo-cookies">
    <h3 id="titulo-cookies">Cookies</h3>
    <p data-legal-cookie>El panel usa una sola cookie, <code>__Host-sesion</code>: la de la sesión, estrictamente necesaria para entrar. Vence a los
      30 minutos sin actividad o a las 8 horas de abierta, lo que ocurra primero; se borra al salir o al cerrar el navegador. No hay cookies de
      terceros ni de analítica.</p>
  </section>
  <section aria-labelledby="titulo-pronto">
    <h3 id="titulo-pronto">Privacidad, términos de uso y soporte</h3>
    <p class="vivo">Se publican en esta misma página en una próxima versión.</p>
  </section>
  <p><a href="#/">Volver al tablero</a></p>
</div>
