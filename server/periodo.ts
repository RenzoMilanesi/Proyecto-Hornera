// Qué reservas pertenecen a un período: las que tienen noches en él o las que llegan
// en él (una cancelación de 0 noches cobra en el mes en que llegaba). `cierre` y
// `salida` son exclusivos. Única definición: la usan "traer mes", su borrado y la API.
// El motor recibe las reservas ya filtradas con esta regla.

export const enPeriodo = (llegada: string, salida: string, inicio: string, cierre: string) =>
  (llegada < cierre && salida > inicio) || (llegada >= inicio && llegada < cierre);

// La misma regla en SQL, sobre la tabla `reserva` con alias `r` y parámetros :inicio y :cierre.
export const SQL_EN_PERIODO = '((r.llegada < :cierre AND r.salida > :inicio) OR (r.llegada >= :inicio AND r.llegada < :cierre))';
