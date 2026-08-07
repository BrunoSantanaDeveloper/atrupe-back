import { parseProjectDayBoundary, toProjectDateKey } from './project-date.util';

/**
 * A listagem fiscal agrupava por data UTC. Como o Brasil está em UTC-3, notas
 * emitidas depois das 21h caíam no grupo do dia seguinte, e o cabeçalho exibido
 * ao usuário não correspondia ao dia em que ele emitiu.
 */
describe('project-date.util', () => {
  describe('toProjectDateKey', () => {
    it('usa o dia civil brasileiro, não o dia UTC', () => {
      // 07/08/2026 21:30 BRT = 08/08/2026 00:30 UTC
      expect(toProjectDateKey(new Date('2026-08-08T00:30:00.000Z'))).toBe(
        '2026-08-07',
      );
    });

    it('mantém o dia quando UTC e horário local coincidem', () => {
      // 07/08/2026 13:30 BRT = 07/08/2026 16:30 UTC
      expect(toProjectDateKey(new Date('2026-08-07T16:30:57.960Z'))).toBe(
        '2026-08-07',
      );
    });

    it('vira o dia à meia-noite local, não à meia-noite UTC', () => {
      expect(toProjectDateKey(new Date('2026-08-07T02:59:59.999Z'))).toBe(
        '2026-08-06',
      );
      expect(toProjectDateKey(new Date('2026-08-07T03:00:00.000Z'))).toBe(
        '2026-08-07',
      );
    });
  });

  describe('parseProjectDayBoundary', () => {
    it('abre o dia à meia-noite local', () => {
      expect(
        parseProjectDayBoundary('2026-08-07', 'start')?.toISOString(),
      ).toBe('2026-08-07T03:00:00.000Z');
    });

    it('fecha o dia no último milissegundo local', () => {
      expect(parseProjectDayBoundary('2026-08-07', 'end')?.toISOString()).toBe(
        '2026-08-08T02:59:59.999Z',
      );
    });

    it('cobre uma nota emitida às 21h30 no filtro daquele dia', () => {
      const emitida = new Date('2026-08-08T00:30:00.000Z'); // 21h30 BRT do dia 07
      const inicio = parseProjectDayBoundary('2026-08-07', 'start');
      const fim = parseProjectDayBoundary('2026-08-07', 'end');

      expect(emitida >= inicio).toBe(true);
      expect(emitida <= fim).toBe(true);
      // E o cabeçalho do grupo concorda com o filtro.
      expect(toProjectDateKey(emitida)).toBe('2026-08-07');
    });

    it('rejeita entrada fora do formato YYYY-MM-DD', () => {
      expect(parseProjectDayBoundary('07/08/2026', 'start')).toBeNull();
      expect(parseProjectDayBoundary('', 'end')).toBeNull();
    });
  });
});
