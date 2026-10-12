import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

// Sin scripts en línea: la CSP del backend (`default-src 'self'`) los prohíbe; Vite deja este módulo como archivo aparte.
const destino = document.getElementById('app');
if (destino === null) throw new Error('falta el elemento #app');
mount(App, { target: destino });
