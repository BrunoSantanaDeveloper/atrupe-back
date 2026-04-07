import { Test, TestingModule } from '@nestjs/testing';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { AbacService } from '../../core/auth/abac/abac.service';

describe('ReportController', () => {
  let controller: ReportController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportController],
      providers: [
        {
          provide: ReportService,
          useValue: {
            menu: jest.fn().mockResolvedValue({
              sales: { quotations: 0, orders: 0 },
              financial: { receivable: 0, payable: 0 },
              production: { followUp: 0, production: 0 },
            }),
          },
        },
        {
          provide: AbacService,
          useValue: {
            hasPermission: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    controller = module.get<ReportController>(ReportController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
