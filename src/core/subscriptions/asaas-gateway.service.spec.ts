import { Test, TestingModule } from '@nestjs/testing';
import { AsaasGatewayService } from './asaas-gateway.service';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AsaasGatewayService', () => {
  let service: AsaasGatewayService;

  const mockApi = {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    mockedAxios.create.mockReturnValue(mockApi as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AsaasGatewayService,
        {
          provide: SystemSettingsService,
          useValue: {
            getActiveAsaasConfig: jest.fn().mockResolvedValue({
              url: 'https://sandbox.asaas.com/api/v3',
              apiKey: 'test_key',
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AsaasGatewayService>(AsaasGatewayService);
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue(mockApi as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('cancelAsaasSubscription', () => {
    it('should call DELETE on the correct route', async () => {
      mockApi.delete.mockResolvedValue({});

      await service.cancelAsaasSubscription('sub_123');

      expect(mockApi.delete).toHaveBeenCalledWith('/subscriptions/sub_123');
    });

    it('should throw Error when Asaas API fails', async () => {
      mockApi.delete.mockRejectedValue({
        response: { data: 'API Error' },
        message: 'Request failed',
      });

      await expect(service.cancelAsaasSubscription('sub_123')).rejects.toThrow(
        'Failed to cancel subscription in Asaas',
      );
    });
  });

  describe('updateAsaasSubscription', () => {
    const updateData = { value: 100, nextDueDate: '2026-03-01' } as any;

    it('should POST update data and return response', async () => {
      const mockResponse = { id: 'sub_123', value: 100 };
      mockApi.post.mockResolvedValue({ data: mockResponse });

      const result = await service.updateAsaasSubscription(
        'sub_123',
        updateData,
      );

      expect(mockApi.post).toHaveBeenCalledWith(
        '/subscriptions/sub_123',
        updateData,
      );
      expect(result).toEqual(mockResponse);
    });

    it('should throw with Asaas error descriptions when available', async () => {
      mockApi.post.mockRejectedValue({
        response: {
          data: {
            errors: [
              { description: 'Invalid value' },
              { description: 'Missing field' },
            ],
          },
          status: 400,
        },
        message: 'Request failed',
      });

      await expect(
        service.updateAsaasSubscription('sub_123', updateData),
      ).rejects.toThrow('Invalid value, Missing field');
    });

    it('should throw with error.message when no Asaas descriptions', async () => {
      mockApi.post.mockRejectedValue({
        response: { data: {} },
        message: 'Network error',
      });

      await expect(
        service.updateAsaasSubscription('sub_123', updateData),
      ).rejects.toThrow('Network error');
    });
  });

  describe('createSubscription', () => {
    const subscriptionData = {
      customer: 'cus_123',
      billingType: 'CREDIT_CARD',
      value: 99.9,
    } as any;

    it('should POST subscription data and return response', async () => {
      const mockResponse = { id: 'sub_new', status: 'ACTIVE' };
      mockApi.post.mockResolvedValue({ data: mockResponse });

      const result = await service.createSubscription(subscriptionData);

      expect(mockApi.post).toHaveBeenCalledWith(
        '/subscriptions',
        subscriptionData,
      );
      expect(result).toEqual(mockResponse);
    });

    it('should throw with Asaas error descriptions', async () => {
      mockApi.post.mockRejectedValue({
        response: {
          data: {
            errors: [{ description: 'Customer not found' }],
          },
          status: 404,
        },
        message: 'Request failed',
      });

      await expect(
        service.createSubscription(subscriptionData),
      ).rejects.toThrow('Customer not found');
    });
  });

  describe('getAsaasSubscriptionPayments', () => {
    it('should return payments array', async () => {
      const payments = [
        { id: 'pay_1', status: 'RECEIVED' },
        { id: 'pay_2', status: 'PENDING' },
      ];
      mockApi.get.mockResolvedValue({ data: { data: payments } });

      const result = await service.getAsaasSubscriptionPayments('sub_123');

      expect(mockApi.get).toHaveBeenCalledWith(
        '/subscriptions/sub_123/payments',
      );
      expect(result).toEqual(payments);
    });

    it('should return empty array when no payments', async () => {
      mockApi.get.mockResolvedValue({ data: { data: null } });

      const result = await service.getAsaasSubscriptionPayments('sub_123');

      expect(result).toEqual([]);
    });

    it('should throw when API fails', async () => {
      mockApi.get.mockRejectedValue({
        message: 'Timeout',
        response: { data: null, status: 500 },
      });

      await expect(
        service.getAsaasSubscriptionPayments('sub_123'),
      ).rejects.toThrow('Falha ao buscar cobranças da assinatura no Asaas');
    });
  });

  describe('mapAsaasPaymentStatus', () => {
    it.each([
      ['PENDING', 'PENDING'],
      ['CONFIRMED', 'CONFIRMED'],
      ['RECEIVED', 'RECEIVED'],
      ['RECEIVED_IN_CASH', 'RECEIVED'],
      ['OVERDUE', 'OVERDUE'],
      ['REFUNDED', 'REFUNDED'],
      ['REFUND_REQUESTED', 'REFUNDED'],
      ['CHARGEBACK_REQUESTED', 'REFUNDED'],
      ['CHARGEBACK_DISPUTE', 'REFUNDED'],
      ['AWAITING_CHARGEBACK_REVERSAL', 'REFUNDED'],
      ['DUNNING_REQUESTED', 'OVERDUE'],
      ['DUNNING_RECEIVED', 'RECEIVED'],
      ['AWAITING_RISK_ANALYSIS', 'PENDING'],
    ])('should map %s → %s', (input, expected) => {
      expect(service.mapAsaasPaymentStatus(input)).toBe(expected);
    });

    it('should return PENDING for unknown status', () => {
      expect(service.mapAsaasPaymentStatus('UNKNOWN_STATUS')).toBe('PENDING');
    });
  });

  describe('createAsaasCustomer', () => {
    const customerData = { name: 'Test', cpfCnpj: '12345678901' };

    it('should create customer and return data', async () => {
      const mockResponse = { id: 'cus_new', name: 'Test' };
      mockApi.post.mockResolvedValue({ data: mockResponse });

      const result = await service.createAsaasCustomer(customerData);

      expect(mockApi.post).toHaveBeenCalledWith('/customers', customerData);
      expect(result).toEqual(mockResponse);
    });

    it('should throw when creation fails', async () => {
      mockApi.post.mockRejectedValue({
        message: 'Duplicate customer',
        response: { data: null, status: 409 },
      });

      await expect(service.createAsaasCustomer(customerData)).rejects.toThrow(
        'Falha ao criar customer no Asaas',
      );
    });
  });
});
