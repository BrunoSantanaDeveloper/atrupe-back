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
  // Capacidade - padrão Mililitros (ML)
  {
    id: 'unit-lt',
    name: 'Litro',
    code: 'LT',
    description: 'Unidade de capacidade em litros',
    kind: 'CAPACITY',
    variant: 'LT',
    isActive: true,
  },
  {
    id: 'unit-ml',
    name: 'Mililitro',
    code: 'ML',
    description: 'Unidade de capacidade em mililitros',
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
