<script lang="ts">
  // Ruteo por fragmento (docs/19 §1): `#/` inventario, `#/dispositivos/<id>` ficha. Así ninguna ruta del panel choca
  // con las de la API, que viven en la raíz del mismo origen. La vista (canal, rango, filtros) va tras el `?` del fragmento
  // (docs/19 §4, incremento 1, punto 1): se lee al cargar y en cada `hashchange` (atrás, un enlace); cada pantalla la escribe
  // con `replaceState`, que no ensucia el historial ni dispara `hashchange`.
  import Ficha from './Ficha.svelte';
  import Inventario from './Inventario.svelte';
  import { obtener } from './lib/api';
  import type { Salud } from './lib/modelo';
  import { leerVista } from './lib/vista';

  let ruta = $state(window.location.hash);
  let salud = $state<string>('consultando…');
  const vista = $derived(leerVista(ruta));

  // Una pantalla cambió su vista: se reemplaza la entrada actual del historial (nunca pushState por cada filtro) y `ruta` se
  // pone al día, para que un `hashchange` posterior hacia la vista anterior se note como cambio.
  function alCambiarVista(fragmento: string): void {
    if (fragmento !== window.location.hash) history.replaceState(history.state, '', fragmento);
    ruta = fragmento;
  }

  $effect(() => {
    const alCambiar = (): void => {
      ruta = window.location.hash;
    };
    window.addEventListener('hashchange', alCambiar);
    void obtener<Salud>('/salud')
      .then((s) => (salud = `${s.estado}, base ${s.base}, ${s.tablas} tablas`))
      .catch(() => (salud = 'sin respuesta'));
    return () => window.removeEventListener('hashchange', alCambiar);
  });
</script>

<header class="principal">
  <h1>Registro, gestión y monitoreo de dispositivos IoT</h1>
  <nav><a href="#/">Inventario</a></nav>
  <span class="vivo" data-salud>servicio: {salud}</span>
</header>
<main>
  {#if vista.pantalla === 'ficha'}
    <!-- {#key}: otro dispositivo es otra ficha (otro canal en vivo, otro histórico), no la misma con otro id -->
    {#key vista.id}
      <Ficha id={vista.id} canal={vista.canal} rango={vista.rango} {alCambiarVista} />
    {/key}
  {:else}
    <Inventario filtros={vista.filtros} {alCambiarVista} />
  {/if}
</main>
