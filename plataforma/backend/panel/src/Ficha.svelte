<script lang="ts">
  // Pantalla P3 (docs/19): se construye en el tramo 3. Hasta entonces, un marcador para que el enlace del inventario
  // tenga destino y la ruta exista.
  let { id }: { id: string } = $props();
</script>

<p class="vacio">Ficha del dispositivo <code>{id}</code>: en construcción (tramo 3). <a href="#/">Volver al inventario</a></p>
