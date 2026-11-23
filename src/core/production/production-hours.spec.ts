import { HAS_PERMISSION_KEY } from '../auth/abac/has-permission.decorator';
import { REQUIRED_FEATURE_KEY } from '../plan/guards/feature.guard';
import { ProductionConfigController } from './production-config.controller';
import { hoursData } from './production-config.service';

describe('o expediente da empresa na Agenda de entrega (GP-49)', () => {
  const featureOf = (handler?: keyof ProductionConfigController) =>
    Reflect.getMetadata(
      REQUIRED_FEATURE_KEY,
      handler
        ? ProductionConfigController.prototype[handler]
        : ProductionConfigController,
    );

  it('a leitura vale em todo plano com a Agenda, com a permissão dela', () => {
    expect(featureOf('getCalendar')).toEqual([]);
    expect(
      Reflect.getMetadata(
        HAS_PERMISSION_KEY,
        ProductionConfigController.prototype.getCalendar,
      ),
    ).toEqual({ action: 'view', resource: 'production:delivery_schedule' });
  });

  it('gravar o expediente continua da produção', () => {
    expect(featureOf('updateCalendar')).toBeUndefined();
    expect(featureOf()).toEqual(['production_manager', 'sector_board']);
  });
});

describe('o expediente do gerenciador (GP-48 item 19)', () => {
  it('sem horário, vale o da empresa', () => {
    expect(hoursData({})).toEqual({
      workStart: null,
      workEnd: null,
      breakStart: null,
      breakEnd: null,
      runsThroughBreak: false,
    });
  });

  it('com o almoço dentro do expediente', () => {
    expect(
      hoursData({
        workStart: '07:30',
        workEnd: '17:30',
        breakStart: '12:00',
        breakEnd: '13:00',
        runsThroughBreak: true,
      }),
    ).toMatchObject({
      workStart: '07:30',
      breakEnd: '13:00',
      runsThroughBreak: true,
    });
  });

  it.each([
    [{ workStart: '08:00' }, 'início e o fim do expediente'],
    [{ workStart: '18:00', workEnd: '08:00' }, 'depois do início'],
    [{ breakStart: '12:00' }, 'início e o fim do intervalo'],
    [{ breakStart: '13:00', breakEnd: '12:00' }, 'fim do intervalo'],
    [
      {
        workStart: '08:00',
        workEnd: '12:00',
        breakStart: '12:00',
        breakEnd: '13:00',
      },
      'dentro do expediente',
    ],
  ])('recusa %j', (dto, message) => {
    expect(() => hoursData(dto)).toThrow(message);
  });
});
