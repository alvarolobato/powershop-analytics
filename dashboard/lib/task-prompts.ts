/**
 * Task-oriented prompts for the "¿Qué necesitas hacer?" section of the New Dashboard page.
 *
 * These are 6 hardcoded, decision-support prompts for common business tasks.
 * Each prompt is pre-optimised for the LLM and references the correct table
 * names and business rules (total_si, entrada=true, tienda<>'99').
 */

export interface TaskPrompt {
  id: string;
  title: string;
  description: string;
  icon: string;
  prompt: string;
}

export const TASK_PROMPTS: TaskPrompt[] = [
  {
    id: "weekly-sales-meeting",
    title: "Preparar la reunión semanal de ventas",
    description: "Tendencias semana vs semana anterior, KPIs y ranking de tiendas",
    icon: "📊",
    prompt:
      "Crea un cuadro de mandos para la reunión semanal de ventas. Incluye: KPIs clave de la semana actual (ventas netas, tickets, ticket medio, unidades) comparados con la semana anterior usando ps_ventas y ps_lineas_ventas; gráfico de barras con ventas por tienda (excluir tienda 99) ordenado de mayor a menor; gráfico de líneas con la tendencia diaria de ventas de las últimas 4 semanas; tabla con las 5 tiendas con mayor crecimiento y las 5 con mayor caída vs semana anterior; y un gráfico de barras con ventas por familia de producto (JOIN con ps_articulos y ps_familias). Filtra siempre entrada=true y tienda<>'99'. Usa total_si para importes. Muestra deltas porcentuales donde sea posible.",
  },
  {
    id: "replenishment",
    title: "Decidir qué reponer esta semana",
    description: "Stock bajo, sell-through, cobertura de días y sugerencias de reposición",
    icon: "📦",
    prompt:
      "Crea un cuadro de mandos para decisiones de reposición semanal. Incluye: KPIs de stock (artículos con cobertura <7 días, artículos sin stock, valor de ventas últimos 7 días usando total_si) uniendo ps_stock_tienda con ps_ventas y ps_lineas_ventas; tabla con los 20 artículos con menor cobertura de días (stock_actual / ventas_diarias_promedio) uniendo ps_stock_tienda con ps_lineas_ventas y ps_articulos; gráfico de barras con sell-through rate por familia (unidades vendidas / stock inicial) del último mes; tabla con artículos de alta rotación (top vendidos en unidades, suma total_si) que tienen stock bajo; y distribución de stock por tienda en gráfico de barras. Usa ps_articulos.ccrefejofacm como referencia y filtra entrada=true en ps_ventas. Muestra descripcion, referencia, stock actual, ventas últimas 2 semanas y días de cobertura estimados.",
  },
  {
    id: "store-performance",
    title: "Revisar el rendimiento de una tienda",
    description: "Deep dive de una tienda: KPIs, patrones horarios y comparativa con la cadena",
    icon: "🏪",
    prompt:
      "Crea un cuadro de mandos para el análisis de rendimiento de tiendas retail. Incluye: KPIs comparativos de todas las tiendas (ventas netas, tickets, ticket medio, uds/ticket) del mes actual vs mes anterior usando ps_ventas; gráfico de barras horizontales con ranking de tiendas por ventas netas (excluir tienda 99); tabla con métricas por tienda (ventas, tickets, ticket medio, variación % vs mes anterior) ordenada por ventas; gráfico de líneas con evolución semanal de las top 5 tiendas en las últimas 8 semanas; y gráfico de barras con contribución de cada tienda a las ventas totales de la cadena en porcentaje. Filtra entrada=true y tienda<>'99'. Muestra nombre de tienda cuando esté disponible.",
  },
  {
    id: "wholesale-analysis",
    title: "Analizar el canal mayorista",
    description: "KPIs mayoristas, top clientes, albaranes pendientes y márgenes",
    icon: "🤝",
    prompt:
      "Crea un cuadro de mandos para el análisis del canal mayorista. Incluye: KPIs clave mayoristas (facturación base1+base2+base3, número de albaranes, clientes activos, ticket medio mayorista) del mes actual usando ps_gc_lin_albarane y ps_gc_albarane; tabla con top 10 clientes mayoristas por facturación del trimestre (JOIN con ps_gc_clientes); gráfico de barras con facturación mayorista por mes de los últimos 6 meses; tabla con albaranes pendientes de facturar (estado no facturado) con cliente, importe y fecha; y gráfico de donut con distribución de ventas mayoristas por familia de artículo. Excluir abono=true (notas de crédito). Usar base1+base2+base3 NUNCA total_factura para importes mayoristas.",
  },
  {
    id: "month-end",
    title: "Preparar el cierre de mes",
    description: "Totales mensuales vs objetivo, YTD, evolución de márgenes y tasa de devolución",
    icon: "📅",
    prompt:
      "Crea un cuadro de mandos para el cierre mensual. Incluye: KPIs del mes (ventas netas, devoluciones, ventas brutas, tasa de devolución %, ticket medio, tickets totales) usando ps_ventas; gráfico de barras con ventas por mes del año en curso vs año anterior (últimos 12 meses) usando fecha_creacion o campo mes; tabla con top 10 categorías/familias del mes por ventas netas (JOIN ps_lineas_ventas con ps_articulos y ps_familias); gráfico de líneas con evolución mensual YTD del año actual; y tabla comparativa por tienda con ventas del mes, mes anterior y variación %. Filtra entrada=true para ventas y entrada=false separado para devoluciones. Usa total_si. Excluir tienda 99.",
  },
  {
    id: "period-comparison",
    title: "Comparar periodos de ventas",
    description: "Análisis delta entre dos periodos: tiendas, categorías y KPIs clave",
    icon: "🔄",
    prompt:
      "Crea un cuadro de mandos para la comparación de dos periodos de ventas. Incluye: KPIs comparativos (ventas netas, tickets, ticket medio, unidades) para el trimestre actual vs trimestre anterior usando ps_ventas; gráfico de barras agrupado con ventas por tienda en ambos periodos (excluir tienda 99); tabla con variación por tienda (ventas periodo 1, periodo 2, delta €, delta %) ordenada por mayor caída; gráfico de barras con ventas por familia de producto comparando ambos periodos (JOIN con ps_articulos y ps_familias); y tabla con los 10 artículos con mayor crecimiento y los 10 con mayor caída entre periodos. Usa total_si y filtra entrada=true. Muestra siempre los deltas absolutos y porcentuales.",
  },
];
