import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CompanyController } from './company.controller';
import {
  FeatureGuard,
  REQUIRED_FEATURE_KEY,
} from '../plan/guards/feature.guard';

/**
 * Criar outra empresa na mesma conta é recurso de plano. A empresa principal,
 * criada no cadastro, nunca pode depender de plano: a conta ainda está
 * nascendo.
 */
describe('CompanyController — recurso de plano', () => {
  const handlerMetadata = (key: string, handler: 'create' | 'createMain') =>
    Reflect.getMetadata(key, CompanyController.prototype[handler]);

  it('POST /company (outra empresa) exige multiple_companies', () => {
    expect(handlerMetadata(REQUIRED_FEATURE_KEY, 'create')).toBe(
      'multiple_companies',
    );
    expect(handlerMetadata(GUARDS_METADATA, 'create')).toEqual([FeatureGuard]);
  });

  it('POST /company/main (cadastro) não confere plano', () => {
    expect(handlerMetadata(REQUIRED_FEATURE_KEY, 'createMain')).toBeUndefined();
    expect(handlerMetadata(GUARDS_METADATA, 'createMain')).toBeUndefined();
    expect(
      Reflect.getMetadata(REQUIRED_FEATURE_KEY, CompanyController),
    ).toBeUndefined();
  });
});
