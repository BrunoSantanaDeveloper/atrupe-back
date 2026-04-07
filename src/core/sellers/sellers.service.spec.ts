import { Test, TestingModule } from '@nestjs/testing';
import { SellersService } from './sellers.service';
import { PrismaService } from 'nestjs-prisma';

describe('SellersService', () => {
  let service: SellersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SellersService,
        {
          provide: PrismaService,
          useValue: {
            employee: { findMany: jest.fn(), findUnique: jest.fn() },
          },
        },
      ],
    }).compile();

    service = module.get<SellersService>(SellersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
