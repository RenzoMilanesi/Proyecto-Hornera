// Cuentas de los gráficos del Resumen (sin React, para poder probarlas con node --test).

// Una serie por año, con 12 valores (ene..dic) y null donde no hay dato. Años de menor a mayor.
export function porAnio<T extends { mes: string }>(filas: T[], valor: (f: T) => number | null) {
  const anios = new Map<number, (number | null)[]>();
  for (const f of filas) {
    const v = valor(f);
    if (v == null) continue;
    const [anio, m] = f.mes.split('-').map(Number);
    if (!anios.has(anio)) anios.set(anio, Array(12).fill(null));
    anios.get(anio)![m - 1] = v;
  }
  return [...anios].sort(([a], [b]) => a - b).map(([anio, valores]) => ({ anio, valores }));
}

// Tope redondo del eje: el primer 1, 2, 5 o 10 × 10^n que no queda por debajo del máximo.
export function techo(max: number) {
  if (!(max > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 5, 10].map((k) => k * p).find((x) => x >= max)!;
}

// El trazo de una línea con huecos: arranca de nuevo (M) después de cada null.
export function trazo(puntos: ({ x: number; y: number } | null)[]) {
  let d = '';
  let antes = false;
  for (const p of puntos) {
    if (p) d += `${antes ? 'L' : 'M'}${Math.round(p.x)},${Math.round(p.y)} `;
    antes = p != null;
  }
  return d.trim();
}
