const KG_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5]
const LB_PLATES = [45, 35, 25, 10, 5, 2.5, 1.25]

export function plateLoad(total, unit = 'kg', bar) {
  const barWeight = Number(bar ?? (unit === 'lb' ? 45 : 20))
  const target = Number(total)
  if (!(target >= barWeight)) return { bar: barWeight, plates: [], remainder: 0 }
  let perSide = (target - barWeight) / 2
  const plates = []
  for (const plate of unit === 'lb' ? LB_PLATES : KG_PLATES) {
    const count = Math.floor((perSide + 1e-9) / plate)
    if (count) {
      plates.push({ weight: plate, count })
      perSide = Math.round((perSide - count * plate) * 100) / 100
    }
  }
  return { bar: barWeight, plates, remainder: perSide }
}

export function plateSummary(total, unit, bar) {
  const load = plateLoad(total, unit, bar)
  if (!load.plates.length) return `${load.bar} ${unit} bar`
  const sides = load.plates.map(p => `${p.count > 1 ? p.count + '×' : ''}${p.weight}`).join(' + ')
  return `${sides} ${unit} / side${load.remainder ? ` · ${load.remainder} ${unit} short` : ''}`
}
