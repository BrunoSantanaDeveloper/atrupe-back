import {
  confidentChoice,
  matchScore,
  parseDimensions,
  rank,
} from './ai-text-match';

describe('casar o pedido com o cadastro', () => {
  it('a medida "30x40" sem unidade é centímetro', () => {
    expect(parseDimensions('200 placas 30x40 em PVC 3mm')).toEqual({
      width: 0.3,
      height: 0.4,
      unit: 'cm',
    });
  });

  it('números pequenos sem unidade são metros; com unidade, vale a unidade', () => {
    expect(parseDimensions('banner 2x1')).toEqual({
      width: 2,
      height: 1,
      unit: 'm',
    });
    expect(parseDimensions('adesivo 1,5 x 0,8 m')).toEqual({
      width: 1.5,
      height: 0.8,
      unit: 'm',
    });
    expect(parseDimensions('placa 300x200mm')).toEqual({
      width: 0.3,
      height: 0.2,
      unit: 'mm',
    });
  });

  it('sem medida no texto: nulo', () => {
    expect(parseDimensions('banner lona com ilhós')).toBeNull();
    expect(parseDimensions('PVC 3mm')).toBeNull();
  });

  it('acento e plural não atrapalham', () => {
    expect(
      matchScore('placas pvc 3mm', { name: 'Placa PVC 3mm' }),
    ).toBeGreaterThan(0.9);
    expect(matchScore('impressao em lona', { name: 'Impressão em Lona' })).toBe(
      1,
    );
  });

  it('código igual vale 1', () => {
    expect(matchScore('BAN440', { name: 'Banner', code: 'ban440' })).toBe(1);
  });

  const catalog = [
    { name: 'Placa PVC 3 mm' },
    { name: 'Placa PVC 2 mm' },
    { name: 'Banner Lona 440 g' },
    { name: 'Adesivo vinil brilho' },
  ];

  it('um candidato que se destaca é usado sem perguntar', () => {
    const ranked = rank('banner lona', catalog, (item) => item);
    expect(confidentChoice(ranked)).toEqual({ name: 'Banner Lona 440 g' });
  });

  it('dois parecidos: a pessoa escolhe', () => {
    const ranked = rank('placa pvc', catalog, (item) => item);
    expect(ranked.map((entry) => entry.item.name).slice(0, 2)).toEqual([
      'Placa PVC 3 mm',
      'Placa PVC 2 mm',
    ]);
    expect(confidentChoice(ranked)).toBeNull();
  });

  it('nada parecido: sem candidato', () => {
    expect(rank('totem em acm', catalog, (item) => item)).toEqual([]);
  });
});
