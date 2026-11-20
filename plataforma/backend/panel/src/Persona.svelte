<script lang="ts">
  // «Quién lo hizo» (20/11/2026; docs/19 §4, G): el nombre y, al lado, el correo en texto secundario, para distinguir a dos
  // personas con el mismo nombre. Sin correo (cuenta anonimizada), solo el nombre. Sin persona (`null`), el texto de reemplazo si se da.
  // Es el único lugar del panel que escribe a una persona de la actividad, de la ficha y de los enlaces.
  import type { Persona } from './lib/persona';

  let { persona, vacio = '' }: { persona: Persona | null; vacio?: string } = $props();
</script>

{#if persona === null}{vacio}{:else}<span data-persona>{persona.nombre}{#if persona.correo !== null && persona.correo !== ''}{' '}<span class="persona-correo" data-persona-correo>{persona.correo}</span>{/if}</span>{/if}
