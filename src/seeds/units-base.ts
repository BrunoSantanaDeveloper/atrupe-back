export const BASE_UNIT_OF_MEASURES = [
  // Comprimento - padrão Milímetros (MM)
  {
    id: 'unit-mt',
    name: 'Metros',
    code: 'MT',
    description: 'Unidade de comprimento em metros',
    kind: 'LENGTH',
    variant: 'MT',
    defaultVariant: 'MM',
    isActive: true,
  },
  {
    id: 'unit-cm',
    name: 'Centímetros',
    code: 'CM',
    description: 'Unidade de comprimento em centímetros',
    kind: 'LENGTH',
    variant: 'CM',
    defaultVariant: 'MM',
    isActive: true,
  },
  {
    id: 'unit-mm',
    name: 'Milímetros',
    code: 'MM',
    description: 'Unidade de comprimento em milímetros',
    kind: 'LENGTH',
    variant: 'MM',
    defaultVariant: 'MM',
    isActive: true,
  },
  // Peso - padrão Miligramas (MG)
  {
    id: 'unit-kg',
    name: 'Quilogramas',
    code: 'KG',
    description: 'Unidade de peso em quilogramas',
    kind: 'WEIGHT',
    variant: 'KG',
    defaultVariant: 'MG',
    isActive: true,
  },
  {
    id: 'unit-gr',
    name: 'Gramas',
    code: 'GR',
    description: 'Unidade de peso em gramas',
    kind: 'WEIGHT',
    variant: 'GR',
    defaultVariant: 'MG',
    isActive: true,
  },
  {
    id: 'unit-mg',
    name: 'Miligramas',
    code: 'MG',
    description: 'Unidade de peso em miligramas',
    kind: 'WEIGHT',
    variant: 'MG',
    defaultVariant: 'MG',
    isActive: true,
  },
  // Capacidade - padrão Mililitros (ML)
  {
    id: 'unit-lt',
    name: 'Litros',
    code: 'LT',
    description: 'Unidade de capacidade em litros',
    kind: 'CAPACITY',
    variant: 'LT',
    defaultVariant: 'ML',
    isActive: true,
  },
  {
    id: 'unit-ml',
    name: 'Mililitros',
    code: 'ML',
    description: 'Unidade de capacidade em mililitros',
    kind: 'CAPACITY',
    variant: 'ML',
    defaultVariant: 'ML',
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
};
