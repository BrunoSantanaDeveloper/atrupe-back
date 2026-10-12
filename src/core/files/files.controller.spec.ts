import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FilesController } from './files.controller';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

// O config do multer-s3 exige o bucket já no import
jest.mock('./multer.config-s3', () => ({ __esModule: true, default: {} }));

describe('FilesController', () => {
  it('o upload exige login', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, FilesController)).toEqual([
      JwtAuthGuard,
    ]);
  });
});
