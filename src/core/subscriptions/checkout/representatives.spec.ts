import {
  cpfMatchesMask,
  hasAdministrationPower,
  RegistryPartner,
  verifyRepresentative,
} from './representatives';

const partner = (
  qualification: string,
  maskedDocument: string,
  name = 'MARIA DA SILVA',
  qualificationCode: number | null = null,
): RegistryPartner => ({
  name,
  qualification,
  maskedDocument,
  qualificationCode,
});

// CPF 123.487.787-00: os dígitos 4 a 9 são 487787, os que a base publica.
const CPF_DA_MARIA = '123.487.787-00';
const MASCARA_DA_MARIA = '***487787**';

describe('representatives', () => {
  describe('hasAdministrationPower', () => {
    it.each([
      'Sócio-Administrador',
      'Diretor Presidente',
      'Administrador Judicial',
      'Titular Pessoa Física Residente ou Domiciliado no Brasil',
      'Empresário',
      'Presidente',
    ])('%s administra', (qualification) => {
      expect(
        hasAdministrationPower(partner(qualification, MASCARA_DA_MARIA)),
      ).toBe(true);
    });

    it('sócio quotista não administra', () => {
      expect(hasAdministrationPower(partner('Sócio', MASCARA_DA_MARIA))).toBe(
        false,
      );
    });

    it('sem o texto, decide pelo código da Receita', () => {
      expect(
        hasAdministrationPower(partner('', MASCARA_DA_MARIA, 'X', 49)),
      ).toBe(true);
      expect(
        hasAdministrationPower(partner('', MASCARA_DA_MARIA, 'X', 22)),
      ).toBe(false);
    });
  });

  describe('cpfMatchesMask', () => {
    it('confere os dígitos à mostra', () => {
      expect(cpfMatchesMask(CPF_DA_MARIA, MASCARA_DA_MARIA)).toBe(true);
      expect(cpfMatchesMask('123.999.787-00', MASCARA_DA_MARIA)).toBe(false);
    });

    it('máscara fora do formato ou sem dígitos não confirma nada', () => {
      expect(cpfMatchesMask(CPF_DA_MARIA, '')).toBe(false);
      expect(cpfMatchesMask(CPF_DA_MARIA, '***********')).toBe(false);
      expect(cpfMatchesMask(CPF_DA_MARIA, '487787')).toBe(false);
    });
  });

  describe('verifyRepresentative', () => {
    it('CPF de administrador: conferido, com o nome publicado no registro', () => {
      const verdict = verifyRepresentative(
        [
          partner(
            'Sócio-Administrador',
            MASCARA_DA_MARIA,
            'MARIA DA SILVA SOUZA',
          ),
        ],
        CPF_DA_MARIA,
      );
      expect(verdict).toEqual({
        status: 'VERIFIED',
        name: 'MARIA DA SILVA SOUZA',
        qualification: 'Sócio-Administrador',
      });
    });

    it('CPF que não é de administrador bloqueia o aceite', () => {
      const verdict = verifyRepresentative(
        [partner('Sócio-Administrador', '***111222**')],
        CPF_DA_MARIA,
      );
      expect(verdict).toEqual({ status: 'NOT_IN_REGISTRY' });
    });

    it('sócio quotista com o mesmo CPF não serve de representante', () => {
      const verdict = verifyRepresentative(
        [
          partner('Sócio', MASCARA_DA_MARIA),
          partner('Sócio-Administrador', '***111222**', 'JOÃO'),
        ],
        CPF_DA_MARIA,
      );
      expect(verdict).toEqual({ status: 'NOT_IN_REGISTRY' });
    });

    it('sem quadro societário, aceita sem conferência', () => {
      expect(verifyRepresentative([], CPF_DA_MARIA)).toEqual({
        status: 'UNVERIFIABLE',
      });
    });

    it('quadro só com quotistas não permite conferir', () => {
      expect(
        verifyRepresentative(
          [partner('Sócio', MASCARA_DA_MARIA)],
          CPF_DA_MARIA,
        ),
      ).toEqual({ status: 'UNVERIFIABLE' });
    });

    it('administrador sem documento publicado não permite conferir', () => {
      expect(
        verifyRepresentative(
          [partner('Sócio-Administrador', '')],
          CPF_DA_MARIA,
        ),
      ).toEqual({ status: 'UNVERIFIABLE' });
    });
  });
});
