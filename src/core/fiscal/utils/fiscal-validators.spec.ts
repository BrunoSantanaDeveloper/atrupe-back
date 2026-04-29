import {
  validateNcm,
  formatNcm,
  validateCfop,
  formatCfop,
  getCfopByUf,
  validateCstIcms,
  validateCsosn,
  validateUf,
  getUfCode,
  validateFiscalItem,
  validateCep,
  validateCpf,
  validateCnpj,
} from './fiscal-validators';

describe('Fiscal Validators', () => {
  describe('NCM', () => {
    describe('validateNcm', () => {
      it('should validate correct NCM', () => {
        expect(validateNcm('12345678').valid).toBe(true);
        expect(validateNcm('84713012').valid).toBe(true);
        expect(validateNcm('01012100').valid).toBe(true);
      });

      it('should reject empty NCM', () => {
        const result = validateNcm('');
        expect(result.valid).toBe(false);
        expect(result.message).toBe('NCM é obrigatório');
      });

      it('should reject NCM with wrong length', () => {
        expect(validateNcm('1234567').valid).toBe(false);
        expect(validateNcm('123456789').valid).toBe(false);
      });

      it('should reject generic NCM 00000000 by default', () => {
        const result = validateNcm('00000000');
        expect(result.valid).toBe(false);
        expect(result.message).toBe('NCM genérico não permitido');
      });

      it('should allow generic NCM when flag is set', () => {
        expect(validateNcm('00000000', true).valid).toBe(true);
      });

      it('should strip non-numeric characters', () => {
        expect(validateNcm('1234.56.78').valid).toBe(true);
        expect(validateNcm('12.34.56.78').valid).toBe(true);
      });
    });

    describe('formatNcm', () => {
      it('should format NCM correctly', () => {
        expect(formatNcm('12345678')).toBe('12345678');
        expect(formatNcm('1234.56.78')).toBe('12345678');
        expect(formatNcm('123')).toBe('00000123');
      });
    });
  });

  describe('CFOP', () => {
    describe('validateCfop', () => {
      it('should validate correct CFOPs', () => {
        expect(validateCfop('5102').valid).toBe(true);
        expect(validateCfop('6102').valid).toBe(true);
        expect(validateCfop('1102').valid).toBe(true);
        expect(validateCfop('5949').valid).toBe(true);
      });

      it('should reject empty CFOP', () => {
        const result = validateCfop('');
        expect(result.valid).toBe(false);
        expect(result.message).toBe('CFOP é obrigatório');
      });

      it('should reject CFOP with wrong length', () => {
        expect(validateCfop('510').valid).toBe(false);
        expect(validateCfop('51022').valid).toBe(false);
      });

      it('should reject CFOP starting with invalid digit', () => {
        expect(validateCfop('4102').valid).toBe(false);
        expect(validateCfop('8102').valid).toBe(false);
        expect(validateCfop('0102').valid).toBe(false);
      });

      it('should validate in strict mode', () => {
        expect(validateCfop('5102', true).valid).toBe(true); // Valid CFOP
        expect(validateCfop('5999', true).valid).toBe(false); // Invalid CFOP
      });
    });

    describe('formatCfop', () => {
      it('should format CFOP correctly', () => {
        expect(formatCfop('5102')).toBe('5102');
        expect(formatCfop('5.102')).toBe('5102');
        expect(formatCfop('102')).toBe('0102');
      });
    });

    describe('getCfopByUf', () => {
      it('should return correct CFOP for same state', () => {
        expect(getCfopByUf('5102', 'SP', 'SP')).toBe('5102');
        expect(getCfopByUf('6102', 'SP', 'SP')).toBe('5102');
      });

      it('should return correct CFOP for interstate', () => {
        expect(getCfopByUf('5102', 'SP', 'RJ')).toBe('6102');
        expect(getCfopByUf('6102', 'SP', 'RJ')).toBe('6102');
      });

      it('should return correct CFOP for export', () => {
        expect(getCfopByUf('5102', 'SP', 'EX')).toBe('7102');
      });

      it('should handle entry CFOPs', () => {
        expect(getCfopByUf('1102', 'SP', 'SP')).toBe('1102');
        expect(getCfopByUf('1102', 'RJ', 'SP')).toBe('2102');
        expect(getCfopByUf('1102', 'EX', 'SP')).toBe('3102');
      });
    });
  });

  describe('CST ICMS', () => {
    describe('validateCstIcms', () => {
      it('should validate correct CSTs', () => {
        expect(validateCstIcms('00').valid).toBe(true);
        expect(validateCstIcms('10').valid).toBe(true);
        expect(validateCstIcms('40').valid).toBe(true);
        expect(validateCstIcms('60').valid).toBe(true);
        expect(validateCstIcms('90').valid).toBe(true);
      });

      it('should reject empty CST', () => {
        expect(validateCstIcms('').valid).toBe(false);
      });

      it('should reject invalid CST', () => {
        expect(validateCstIcms('99').valid).toBe(false);
        expect(validateCstIcms('05').valid).toBe(false);
      });
    });
  });

  describe('CSOSN', () => {
    describe('validateCsosn', () => {
      it('should validate correct CSOSNs', () => {
        expect(validateCsosn('101').valid).toBe(true);
        expect(validateCsosn('102').valid).toBe(true);
        expect(validateCsosn('500').valid).toBe(true);
        expect(validateCsosn('900').valid).toBe(true);
      });

      it('should reject empty CSOSN', () => {
        expect(validateCsosn('').valid).toBe(false);
      });

      it('should reject invalid CSOSN', () => {
        expect(validateCsosn('199').valid).toBe(false);
        expect(validateCsosn('000').valid).toBe(false);
      });
    });
  });

  describe('UF', () => {
    describe('validateUf', () => {
      it('should validate correct UFs', () => {
        expect(validateUf('SP').valid).toBe(true);
        expect(validateUf('RJ').valid).toBe(true);
        expect(validateUf('MG').valid).toBe(true);
        expect(validateUf('EX').valid).toBe(true);
      });

      it('should validate lowercase UFs', () => {
        expect(validateUf('sp').valid).toBe(true);
      });

      it('should reject empty UF', () => {
        expect(validateUf('').valid).toBe(false);
      });

      it('should reject invalid UF', () => {
        expect(validateUf('XX').valid).toBe(false);
        expect(validateUf('ZZ').valid).toBe(false);
      });
    });

    describe('getUfCode', () => {
      it('should return correct IBGE codes', () => {
        expect(getUfCode('SP')).toBe(35);
        expect(getUfCode('RJ')).toBe(33);
        expect(getUfCode('MG')).toBe(31);
        expect(getUfCode('EX')).toBe(99);
      });

      it('should handle lowercase', () => {
        expect(getUfCode('sp')).toBe(35);
      });

      it('should return 0 for invalid UF', () => {
        expect(getUfCode('XX')).toBe(0);
        expect(getUfCode('')).toBe(0);
      });
    });
  });

  describe('validateFiscalItem', () => {
    it('should validate complete item', () => {
      const results = validateFiscalItem({
        ncm: '12345678',
        cfop: '5102',
        cst: '00',
        uf: 'SP',
      });
      expect(results).toHaveLength(0);
    });

    it('should return errors for invalid fields', () => {
      const results = validateFiscalItem({
        ncm: '1234', // invalid
        cfop: '0102', // invalid
        cst: '99', // invalid
        uf: 'XX', // invalid
      });
      expect(results.length).toBeGreaterThan(0);
    });

    it('should validate CSOSN for Simples Nacional', () => {
      const results = validateFiscalItem(
        { csosn: '101' },
        true, // isSimples
      );
      expect(results).toHaveLength(0);
    });

    it('should reject invalid CSOSN for Simples Nacional', () => {
      const results = validateFiscalItem(
        { csosn: '999' },
        true, // isSimples
      );
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('CEP', () => {
    it('deve validar formato correto de CEP', () => {
      expect(validateCep('12345-678').valid).toBe(true);
      expect(validateCep('12345678').valid).toBe(true);
    });

    it('deve rejeitar CEP incompleto ou com letras', () => {
      expect(validateCep('12345-67').valid).toBe(false);
      expect(validateCep('12345-ABC').valid).toBe(false);
      expect(validateCep('').valid).toBe(false);
    });
  });

  describe('CPF e CNPJ', () => {
    it('deve validar cálculo de dígito verificador do CNPJ', () => {
      expect(validateCnpj('11.222.333/0001-81').valid).toBe(true); // Um CNPJ válido para teste (exemplo gerado aleatoriamente) - Wait, let's use a widely known valid mock like "00.000.000/0001-91"
      expect(validateCnpj('00.000.000/0001-91').valid).toBe(true); // Banco do Brasil
      expect(validateCnpj('11.222.333/0001-00').valid).toBe(false); // Invalido
    });

    it('deve bloquear CPFs notoriamente inválidos (ex: 111.111.111-11)', () => {
      expect(validateCpf('111.111.111-11').valid).toBe(false);
      expect(validateCpf('000.000.000-00').valid).toBe(false);
    });

    it('deve validar cálculo de dígito verificador do CPF', () => {
      expect(validateCpf('52998224725').valid).toBe(true); // Gerador valido
      expect(validateCpf('123.456.789-10').valid).toBe(false); // Invalido
    });
  });
});
