<script lang="ts">
  // Ruteo por fragmento (docs/19 §1): `#/` inventario, `#/dispositivos/<id>` ficha. Así ninguna ruta del panel choca
  // con las de la API, que viven en la raíz del mismo origen.
  import Ficha from './Ficha.svelte';
  import Inventario from './Inventario.svelte';
  import { obtener } from './lib/api';
  import type { Salud } from './lib/modelo';

  let ruta = $state(window.location.hash);
  let salud = $state<string>('consultando…');
  const dispositivoId = $derived(/^#\/dispositivos\/([0-9a-f-]{36})$/i.exec(ruta)?.[1] ?? null);

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
  {#if dispositivoId !== null}
    <Ficha id={dispositivoId} />
  {:else}
    <Inventario />
  {/if}
</main>
