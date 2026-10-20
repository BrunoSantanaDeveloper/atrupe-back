export const BASE_UNIT_OF_MEASURES = [
  // Comprimento - padrão Milímetros (MM)
  {
    id: 'unit-mt',
    name: 'Metro',
    code: 'MT',
    description: 'Unidade de comprimento em metros',
    kind: 'LENGTH',
    variant: 'MT',
    isActive: true,
  },
  {
    id: 'unit-cm',
    name: 'Centímetro',
    code: 'CM',
    description: 'Unidade de comprimento em centímetros',
    kind: 'LENGTH',
    variant: 'CM',
    isActive: true,
  },
  {
    id: 'unit-mm',
    name: 'Milímetro',
    code: 'MM',
    description: 'Unidade de comprimento em milímetros',
    kind: 'LENGTH',
    variant: 'MM',
    isActive: true,
  },
  // Peso - padrão Miligramas (MG)
  {
    id: 'unit-kg',
    name: 'Quilograma',
    code: 'KG',
    description: 'Unidade de peso em quilogramas',
    kind: 'WEIGHT',
    variant: 'KG',
    isActive: true,
  },
  {
    id: 'unit-gr',
    name: 'Grama',
    code: 'GR',
    description: 'Unidade de peso em gramas',
    kind: 'WEIGHT',
    variant: 'GR',
    isActive: true,
  },
  {
    id: 'unit-mg',
    name: 'Miligrama',
    code: 'MG',
    description: 'Unidade de peso em miligramas',
    kind: 'WEIGHT',
    variant: 'MG',
    isActive: true,
  },
  // Volume - padrão Mililitros (ML)
  {
    id: 'unit-lt',
    name: 'Litro',
    code: 'LT',
    description: 'Unidade de volume em litros',
    kind: 'CAPACITY',
    variant: 'LT',
    isActive: true,
  },
  {
    id: 'unit-ml',
    name: 'Mililitro',
    code: 'ML',
    description: 'Unidade de volume em mililitros',
    kind: 'CAPACITY',
    variant: 'ML',
    isActive: true,
  },
  // Distância - padrão Metros (convertido internamente)
  {
    id: 'unit-km',
    name: 'Quilômetro',
    code: 'KM',
    description: 'Unidade de distância em quilômetros',
    kind: 'DISTANCE',
    variant: 'KM',
    isActive: true,
  },
  // Duração - padrão Segundos (convertido internamente)
  {
    id: 'unit-hh',
    name: 'Hora',
    code: 'HH',
    description: 'Unidade de duração em horas',
    kind: 'DURATION',
    variant: 'HH',
    isActive: true,
  },
  // Unidade - padrão Unidade
  {
    id: 'unit-un',
    name: 'Unidade',
    code: 'UN',
    description: 'Unidade de quantidade',
    kind: 'UNITY',
    variant: 'UN',
    isActive: true,
  },
  // Área - padrão Milímetro quadrado (convertido internamente)
  {
    id: 'unit-m2',
    name: 'Metro Quadrado',
    code: 'M2',
    description: 'Unidade de área em metro quadrado',
    kind: 'AREA',
    variant: 'M2',
    isActive: true,
  },
  // Folha (Papéis no LITE, 13/10/2026): o código é o do formato do papel; a
  // medida em mm sai das variantes (unit-of-measure.service › SHEET_VARIANTS).
  // A migration 20261020170100_unidades_da_folha grava estas linhas
  {
    id: 'unit-sheet-a4',
    name: 'Folha A4',
    code: 'A4',
    description: 'Folha A4, 210 × 297 mm',
    kind: 'SHEET',
    variant: 'A4',
    isActive: true,
  },
  {
    id: 'unit-sheet-a3',
    name: 'Folha A3',
    code: 'A3',
    description: 'Folha A3, 297 × 420 mm',
    kind: 'SHEET',
    variant: 'A3',
    isActive: true,
  },
  {
    id: 'unit-sheet-sra3',
    name: 'Folha SRA3',
    code: 'SRA3',
    description: 'Folha SRA3, 320 × 450 mm',
    kind: 'SHEET',
    variant: 'SRA3',
    isActive: true,
  },
  {
    id: 'unit-sheet-a3-plus',
    name: 'Folha A3+',
    code: 'A3_PLUS',
    description: 'Folha A3+, 329 × 483 mm',
    kind: 'SHEET',
    variant: 'A3_PLUS',
    isActive: true,
  },
  {
    id: 'unit-sheet-custom',
    name: 'Folha personalizada',
    code: 'CUSTOM',
    description: 'Folha na medida informada',
    kind: 'SHEET',
    variant: 'CUSTOM',
    isActive: true,
  },
];

export const CONVERSION_FACTORS = {
  LENGTH: {
    MM: 1, // Padrão (base)
    CM: 10, // 1 cm = 10 mm
    MT: 1000, // 1 m = 1000 mm
  },
  WEIGHT: {
    MG: 1, // Padrão (base)
    GR: 1000, // 1 g = 1000 mg
    KG: 1000000, // 1 kg = 1000000 mg
  },
  CAPACITY: {
    ML: 1, // Padrão (base)
    LT: 1000, // 1 l = 1000 ml
  },
  DISTANCE: {
    KM: 1000, // 1 km = 1000 m (salvo em metros)
  },
  DURATION: {
    HH: 3600, // 1 hora = 3600 segundos
  },
  UNITY: {
    UN: 1, // Unidade padrão
  },
  AREA: {
    M2: 1000000, // 1 m² = 1000000 mm²
  },
};
