# 22. Comparativa de tableros: referentes y normas (11/11/2026)

**Para qué.** El diseño del tablero del sitio y de las gráficas (`docs/19 §4`, «P1 rediseñado» y «Tablero v2») exige, antes de dibujar,
una comparación escrita de cómo resuelven el tablero los referentes y de lo que piden las normas de accesibilidad, con cada afirmación
respaldada por una cita de la fuente oficial. Este documento es esa comparación. Complementa la del 22/10/2026 (estado de la vista al
volver, rangos sin datos, intervalo e inactividad; `docs/19 §4`, incrementos 1 y 2) y alimenta la comparación completa con los referentes
(TT-40, `docs/04`) y el cuadro de referentes del informe.

**Método.** Siete referentes (ThingsBoard CE, Grafana, OpenRemote, Magistrala, Milesight IoT Cloud, Ubidots y TagoIO) y doce criterios
(resumen al entrar, zoom, rango temporal, varias series, agregados, tiempo real frente a historia, pantallas angostas, preferencias por
usuario, umbrales y alarmas, alta masiva, perfiles y vista pública, notificaciones), más WCAG 2.2 y las heurísticas de usabilidad de
Nielsen Norman Group. Cada página oficial se descargó el 11/11/2026 y cada cita se buscó literalmente en su texto; aquí van solo las filas
de los criterios que el tablero necesita y que la fuente **declara**. Lo que una fuente no menciona no aparece y no debe leerse como
ausencia. Describe lo documentado, no el comportamiento observado en ejecución. Las normas ISO 9241-110 e ISO 9241-210 no se citan: su
texto no es de acceso abierto. Las descargas y el registro completo (122 filas con su estado) se conservan fuera del repositorio: son
material de terceros.

| Criterio | Referente | Qué declara | Cita | Fuente (consulta 11/11/2026) |
|---|---|---|---|---|
| Resumen al entrar | ThingsBoard CE | Al entrar se abre el «Home dashboard»; si no hay uno configurado, una página de inicio por defecto del rol | «The Home dashboard is the dashboard that opens when a user clicks Home … falls back to a built-in default Home page for that role.» | https://thingsboard.io/docs/user-guide/dashboards/ |
| Resumen al entrar | Grafana | Al iniciar sesión se ve el tablero de inicio, configurable como preferencia | «Home dashboard refers to the dashboard you see when you sign in to Grafana. By default, this is set to the Home dashboard.» | https://grafana.com/docs/grafana/latest/administration/user-management/user-preferences/ |
| Resumen al entrar | OpenRemote | La aplicación abre con cuatro páginas principales | «If you open the application you will get four main pages: Map, Assets, Rules, and Insights.» | https://docs.openremote.io/docs/user-guide/manager-ui/ |
| Resumen al entrar | Magistrala | Widget que cuenta entidades (dispositivos, canales, miembros, grupos) | «A Count Card provides a quick overview of the total number of entities such as devices, channels, members, or groups within a workspace.» | https://www.absmach.eu/docs/magistrala/user-guide/dashboards/countcard/ |
| Resumen al entrar | Magistrala | Widget de conteo de alarmas con filtros | «The Alarm Count widget displays the total number of alarms based on your filter criteria.» | https://www.absmach.eu/docs/magistrala/user-guide/dashboards/alarmcount/ |
| Resumen al entrar | Milesight IoT Cloud | El tablero sirve para comparar valores y ver todos los sensores de un vistazo | «Milesight IoT Cloud supports create different diagrams of your own on dashboard, compare different values and monitor all the sensors at a glance.» | https://support.milesight-iot.com/support/solutions/articles/73000514201-how-to-create-diagrams-on-dashboard-of-milesight-iot-cloud |
| Zoom | ThingsBoard CE | Zoom con deslizadores sobre el eje de tiempo; se vuelve devolviéndolos a su posición | «Drag the sliders to narrow the visible time range; return them to their default position to zoom out.» | https://thingsboard.io/docs/user-guide/time-window/ |
| Zoom | Grafana | Zoom arrastrando en horizontal sobre el gráfico; doble clic para alejar | «Click and drag horizontally in the panel graph area to select a time range … Double click on the panel graph area» | https://grafana.com/docs/grafana/latest/dashboards/use-dashboards/ |
| Zoom | Ubidots | Barra de zoom del eje X activable por widget | «Switch ON/OFF to display the X-axis data zoom bar.» | https://help.ubidots.com/en/articles/2596623-line-chart-and-double-axis-widgets |
| Rango temporal | ThingsBoard CE | Tres tipos de intervalo: «Last» (hacia atrás desde ahora), «Range» (inicio y fin) y «Relative» (alineado al calendario) | «Rolling interval counted backward from the current time. … Explicit start and end timestamps. … Calendar-aligned interval.» | https://thingsboard.io/docs/user-guide/time-window/ |
| Rango temporal | Grafana | Rango relativo (preajustes) o absoluto, con calendario | «You can change the current time using a relative time range, such as the last 15 minutes, or an absolute time range … Grafana displays a calendar.» | https://grafana.com/docs/grafana/latest/dashboards/use-dashboards/ |
| Rango temporal | Grafana | El rango viaja en la URL del tablero | «You can control the time range of a dashboard by providing the following query parameters in the dashboard URL» | https://grafana.com/docs/grafana/latest/dashboards/use-dashboards/ |
| Rango temporal | Ubidots | Selector de fecha y hora para un rango | «Date time picker: Allows you to select a time range to display the data contained within the defined range.» | https://help.ubidots.com/en/articles/2400308-create-dashboards-and-widgets |
| Rango temporal | Ubidots | Rango por defecto al cargar; después, el último elegido | «The first load corresponds to the predetermined time interval when the dashboard is loaded, otherwise it corresponds to the last selected time range.» | https://help.ubidots.com/en/articles/2400308-create-dashboards-and-widgets |
| Rango temporal | TagoIO | Selector de fechas global del tablero con preajustes definidos por quien lo arma | «When enabled, a date picker is available to choose specific date ranges. … set period presets to allow users to easily change the filter range by selecting predefined periods.» | https://docs.tago.io/docs/tagoio/dashboards/dashboard-global-time-filter-and-period-presets |
| Varias series | ThingsBoard CE | Cada serie tiene etiqueta (en leyenda y globo) y color propio | «Label — Display name shown in the widget legend and tooltip. … Color — Series color used in charts and legends.» | https://thingsboard.io/docs/user-guide/widgets/ |
| Varias series | Grafana | Leyenda para identificar las series; puede llevar valores o cálculos por serie | «A panel includes a legend that you can use to identify and interpret data displayed in a visualization. … adding series data values or calculations to a legend» | https://grafana.com/docs/grafana/latest/panels-visualizations/configure-legend/ |
| Varias series | Magistrala | Varias fuentes de datos en un gráfico, cada una con su etiqueta | «Label: A clear label for identifying each data source on the chart. … compare multiple data sources» | https://www.absmach.eu/docs/magistrala/user-guide/dashboards/linechart/ |
| Varias series | Milesight IoT Cloud | Clic en la leyenda para ocultar variables; el eje se reajusta | «you can click the legend on the top of chart to disable the display of variables, then the X-axis will be adjusted automatically.» | https://support.milesight-iot.com/support/solutions/articles/73000603114-milesight-iot-cloud-faq |
| Varias series | Ubidots | Hasta 30 variables por gráfico y leyenda por variable | «visualize time series data from one or more variables at a time (up to 30) … Enable/disable the toggle to show legends for each variable.» | https://help.ubidots.com/en/articles/2596623-line-chart-and-double-axis-widgets |
| Agregados | ThingsBoard CE | Agregación por intervalo de agrupación: un valor por intervalo | «Defines the size of time buckets used for aggregation. Each bucket produces one aggregated value.» | https://thingsboard.io/docs/user-guide/time-window/ |
| Agregados | OpenRemote | La API agrupa los datos en intervalos alineados | «Aggregates numeric or boolean datapoints from the inclusive range into aligned time buckets and returns buckets in chronological order.» | https://docs.openremote.io/docs/rest-api/schemas/assetdatapointintervalquery/ |
| Agregados | Magistrala | Agregación con desde, hasta e intervalo (p. ej., máximos cada 15 minutos) | «By setting a From date, To date, and an interval (e.g., 15 minutes), the data is grouped accordingly.» | https://www.absmach.eu/docs/magistrala/user-guide/dashboards/linechart/ |
| Agregados | Ubidots | Método de agregación por variable | «Select the aggregation method that will be applied to the variable's data.» | https://help.ubidots.com/en/articles/2596623-line-chart-and-double-axis-widgets |
| Agregados | TagoIO | Función «Aggregate» para gráficos con muchos puntos | «enable the Aggregate feature to improve widget performance and make the data easier to visualize» | https://docs.tago.io/docs/tagoio/widgets/charts/line-chart-widget |
| Pantallas angostas | ThingsBoard CE | Puntos de quiebre: distinta disposición de widgets por ancho de pantalla | «Breakpoints let you configure separate widget arrangements and settings for different screen widths.» | https://thingsboard.io/docs/user-guide/layouts/ |
| Pantallas angostas | ThingsBoard CE | Aplicación móvil para iOS y Android, con licencia Apache 2.0 | «It is available for both iOS and Android and licensed under Apache 2.0.» | https://thingsboard.io/docs/reference/mobile-app/ |
| Pantallas angostas | OpenRemote | El gestor y los tableros Insights son adaptables y se usan en móviles | «The OpenRemote Manager including the Insights dashboards, are responsive and can be used on mobile devices.» | https://docs.openremote.io/docs/user-guide/manager-ui/on-mobile/ |
| Pantallas angostas | Milesight IoT Cloud | Sitio web y aplicación móvil | «Milesight IoT Cloud provides online website and APP, you can use your mobile phone to set configuration and check data anytime and anywhere.» | https://support.milesight-iot.com/support/solutions/articles/73000514221-how-to-use-milesight-iot-cloud-app |
| Pantallas angostas | Ubidots | Ancho del tablero fijo o «auto» adaptable | «Choose a resolution according to the screen used to display the dashboard or leave it in "auto" for it to be responsive.» | https://help.ubidots.com/en/articles/2400308-create-dashboards-and-widgets |
| Pantallas angostas | TagoIO | App móvil para usuarios finales (TagoRUN) | «The TagoRUN mobile app is designed for end users to access applications created by companies and developers.» | https://docs.tago.io/docs/tagoio/tagorun/getting-started/tagorun-mobile-app |
| Biblioteca de gráficos | Grafana | El panel de series de tiempo dibuja con uPlot (cadena `TimeSeriesPanel` → `GraphNG` → `UPlotChart`) | «import uPlot, { type AlignedData, type Options } from 'uplot'; … const plot = new uPlot(options, data as AlignedData, plotContainer.current!);» | https://github.com/grafana/grafana/blob/4f2bebd4a0f2d36b2559330878b9b48f3a79e9b6/packages/grafana-ui/src/components/uPlot/Plot.tsx#L2-L41 |

**WCAG 2.2** (W3C Recommendation, 12/12/2024; https://www.w3.org/TR/WCAG22/, consulta 11/11/2026; las filas de 1.1.1, 1.4.13, 2.2.2, 2.4.1, 2.4.3 y 4.1.2, que pide el tablero v3 de `docs/19 §4`, bloque L, consulta 13/11/2026):

| Criterio | Nivel | Cita | Enlace |
|---|---|---|---|
| 1.1.1 Non-text Content | A | «All non-text content that is presented to the user has a text alternative that serves the equivalent purpose, except for the situations listed below.» | https://www.w3.org/TR/WCAG22/#non-text-content |
| 1.4.1 Use of Color | A | «Color is not used as the only visual means of conveying information, indicating an action, prompting a response, or distinguishing a visual element.» | https://www.w3.org/TR/WCAG22/#use-of-color |
| 1.4.3 Contrast (Minimum) | AA | «has a contrast ratio of at least 4.5:1 … Large-scale text and images of large-scale text have a contrast ratio of at least 3:1» | https://www.w3.org/TR/WCAG22/#contrast-minimum |
| 1.4.10 Reflow | AA | «without requiring scrolling in two dimensions for: Vertical scrolling content at a width equivalent to 320 CSS pixels» | https://www.w3.org/TR/WCAG22/#reflow |
| 1.4.12 Text Spacing | AA | «Line height (line spacing) to at least 1.5 times the font size; Spacing following paragraphs to at least 2 times the font size» | https://www.w3.org/TR/WCAG22/#text-spacing |
| 1.4.13 Content on Hover or Focus | AA | «Where receiving and then removing pointer hover or keyboard focus triggers additional content to become visible and then hidden, the following are true: … Dismissible … Hoverable … Persistent» | https://www.w3.org/TR/WCAG22/#content-on-hover-or-focus |
| 2.2.2 Pause, Stop, Hide | A | «For any auto-updating information that (1) starts automatically and (2) is presented in parallel with other content, there is a mechanism for the user to pause, stop, or hide it …» | https://www.w3.org/TR/WCAG22/#pause-stop-hide |
| 2.4.1 Bypass Blocks | A | «A mechanism is available to bypass blocks of content that are repeated on multiple web pages.» | https://www.w3.org/TR/WCAG22/#bypass-blocks |
| 2.4.3 Focus Order | A | «If a web page can be navigated sequentially and the navigation sequences affect meaning or operation, focusable components receive focus in an order that preserves meaning and operability.» | https://www.w3.org/TR/WCAG22/#focus-order |
| 2.4.7 Focus Visible | AA | «Any keyboard operable user interface has a mode of operation where the keyboard focus indicator is visible.» | https://www.w3.org/TR/WCAG22/#focus-visible |
| 2.4.11 Focus Not Obscured (Minimum) | AA | «When a user interface component receives keyboard focus, the component is not entirely hidden due to author-created content.» | https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum |
| 2.5.8 Target Size (Minimum) | AA | «The size of the target for pointer inputs is at least 24 by 24 CSS pixels, except when:» | https://www.w3.org/TR/WCAG22/#target-size-minimum |
| 4.1.2 Name, Role, Value | A | «For all user interface components (including but not limited to: form elements, links and components generated by scripts), the name and role can be programmatically determined; …» | https://www.w3.org/TR/WCAG22/#name-role-value |

## Qué toma el diseño del tablero v2 (y qué no)

**Lo que los referentes hacen igual.** Rango con preajustes contados hacia atrás desde ahora y un rango a medida con fechas (ThingsBoard,
Grafana, Ubidots, TagoIO, Magistrala); cada serie con su etiqueta en la leyenda (ThingsBoard, Grafana, Magistrala, Ubidots); el agregado por
intervalo configurable por quien arma el gráfico (ThingsBoard, Magistrala, Ubidots, TagoIO; OpenRemote solo en la API); pantallas angostas por
disposición según el ancho (ThingsBoard, OpenRemote, Ubidots) o por aplicación móvil (ThingsBoard, Milesight, TagoIO).

**Lo que resuelven distinto.** El zoom: arrastre horizontal sobre el gráfico y doble clic para alejar (Grafana, que dibuja con uPlot, la
misma biblioteca de este panel); deslizadores en el eje (ThingsBoard); barra de zoom (Ubidots); rueda del ratón (Milesight, según su FAQ).

**Lo que ninguno declara en lo revisado.** Cómo se nombra el agregado en la pantalla; que la portada por defecto traiga conteos por estado y
alarmas abiertas; un indicador explícito de «en vivo» (salvo Magistrala, `docs/19 §4` incremento 1).

**Decisiones que esta evidencia sostiene** (aplicadas en `docs/19 §4`, tablero v2):
1. Portada del sitio fija, no armada por el usuario: conteos por estado, condiciones abiertas y salud; cada estado con texto además del
   color (WCAG 1.4.1).
2. Zoom por arrastre horizontal con vuelta atrás por doble clic y un botón visible: el patrón de Grafana sobre la misma biblioteca.
3. Preajustes hacia atrás (1 h, 24 h, 7 días, 30 días), rango a medida con fecha y hora, y el rango en la URL (como Grafana), que además
   resuelve el estado al volver.
4. El agregado con su nombre escrito («promedio por hora»): nadie lo declara y es lo que pide la heurística de hablar el idioma de la persona.
5. Diseño adaptable a 320 px CSS sin desplazamiento en dos dimensiones (1.4.10), objetivos de 24 × 24 px CSS como mínimo (2.5.8; 44 pt y
   48 dp como referencia táctil de Apple y Android), foco visible y no tapado (2.4.7, 2.4.11) y contraste de 4,5:1 (1.4.3).
6. Fuera del tablero, pero ligado: retardo antes de abrir una condición y una regla de cierre distinta de la de apertura (Grafana y
   ThingsBoard lo declaran): la histéresis ya existía (RF-14); el retardo de activación entra con P6.
