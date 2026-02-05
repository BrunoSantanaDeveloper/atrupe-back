/**
 * Testes unitários para a lógica de classificação por blockLevel
 * Testa a lógica usada em getActiveTotals e listActiveClients
 */
describe('BlockLevel Classification Logic', () => {
  /**
   * Função extraída da lógica de getActiveTotals
   * Determina o status final de uma empresa baseado no blockLevel e status da subscription
   */
  function classifyCompanyStatus(
    blockLevel: string | null,
    subscriptionStatuses: string[],
  ): string {
    let finalStatus = 'INACTIVE'; // Default fallback

    // Verificar primeiro o blockLevel da empresa
    // PARTIAL = Bloqueadas (ainda pode usar, mas com restrições)
    // FULL = Inativas (não pode usar o sistema)
    if (blockLevel === 'PARTIAL') {
      finalStatus = 'BLOCKED';
    } else if (blockLevel === 'FULL') {
      finalStatus = 'INACTIVE';
    }
    // Lógica de prioridade para empresas sem bloqueio: ACTIVE > BLOCKED > INACTIVE > CANCELED
    else if (subscriptionStatuses.includes('ACTIVE')) {
      finalStatus = 'ACTIVE';
    } else if (subscriptionStatuses.includes('BLOCKED')) {
      finalStatus = 'BLOCKED';
    } else if (subscriptionStatuses.includes('INACTIVE')) {
      finalStatus = 'INACTIVE';
    } else if (subscriptionStatuses.includes('CANCELED')) {
      finalStatus = 'CANCELED';
    }

    return finalStatus;
  }

  describe('classifyCompanyStatus', () => {
    it('should classify PARTIAL blockLevel as BLOCKED', () => {
      const result = classifyCompanyStatus('PARTIAL', ['ACTIVE']);
      expect(result).toBe('BLOCKED');
    });

    it('should classify FULL blockLevel as INACTIVE', () => {
      const result = classifyCompanyStatus('FULL', ['ACTIVE']);
      expect(result).toBe('INACTIVE');
    });

    it('should classify NONE blockLevel with ACTIVE subscription as ACTIVE', () => {
      const result = classifyCompanyStatus('NONE', ['ACTIVE']);
      expect(result).toBe('ACTIVE');
    });

    it('should classify null blockLevel with ACTIVE subscription as ACTIVE', () => {
      const result = classifyCompanyStatus(null, ['ACTIVE']);
      expect(result).toBe('ACTIVE');
    });

    it('should classify NONE blockLevel with INACTIVE subscription as INACTIVE', () => {
      const result = classifyCompanyStatus('NONE', ['INACTIVE']);
      expect(result).toBe('INACTIVE');
    });

    it('should classify NONE blockLevel with CANCELED subscription as CANCELED', () => {
      const result = classifyCompanyStatus('NONE', ['CANCELED']);
      expect(result).toBe('CANCELED');
    });

    it('should prioritize ACTIVE over other subscription statuses', () => {
      const result = classifyCompanyStatus('NONE', [
        'INACTIVE',
        'ACTIVE',
        'CANCELED',
      ]);
      expect(result).toBe('ACTIVE');
    });

    it('should prioritize blockLevel PARTIAL over subscription ACTIVE', () => {
      // Even if subscription is ACTIVE, PARTIAL block takes precedence
      const result = classifyCompanyStatus('PARTIAL', ['ACTIVE']);
      expect(result).toBe('BLOCKED');
    });

    it('should prioritize blockLevel FULL over subscription ACTIVE', () => {
      // Even if subscription is ACTIVE, FULL block takes precedence
      const result = classifyCompanyStatus('FULL', ['ACTIVE']);
      expect(result).toBe('INACTIVE');
    });
  });

  describe('listActiveClients filtering logic', () => {
    /**
     * Determina se uma empresa deve aparecer na lista baseado no filtro de status
     */
    function shouldIncludeCompany(
      statusFilter: string,
      companyBlockLevel: string,
      subscriptionStatus: string,
    ): boolean {
      switch (statusFilter) {
        case 'bloqueadas':
          // Apenas PARTIAL blockLevel
          return companyBlockLevel === 'PARTIAL';

        case 'inativas':
          // FULL blockLevel OU subscription INACTIVE (sem bloqueio)
          return (
            companyBlockLevel === 'FULL' ||
            (companyBlockLevel === 'NONE' && subscriptionStatus === 'INACTIVE')
          );

        case 'ativas':
          // Apenas se não está bloqueado e subscription ativa
          return (
            companyBlockLevel === 'NONE' && subscriptionStatus === 'ACTIVE'
          );

        case 'canceladas':
          // Sem bloqueio e subscription cancelada
          return (
            companyBlockLevel === 'NONE' && subscriptionStatus === 'CANCELED'
          );

        default:
          return false;
      }
    }

    describe('bloqueadas filter', () => {
      it('should include company with PARTIAL blockLevel', () => {
        expect(shouldIncludeCompany('bloqueadas', 'PARTIAL', 'ACTIVE')).toBe(
          true,
        );
      });

      it('should NOT include company with FULL blockLevel', () => {
        expect(shouldIncludeCompany('bloqueadas', 'FULL', 'ACTIVE')).toBe(
          false,
        );
      });

      it('should NOT include company with NONE blockLevel', () => {
        expect(shouldIncludeCompany('bloqueadas', 'NONE', 'ACTIVE')).toBe(
          false,
        );
      });
    });

    describe('inativas filter', () => {
      it('should include company with FULL blockLevel', () => {
        expect(shouldIncludeCompany('inativas', 'FULL', 'ACTIVE')).toBe(true);
      });

      it('should include company with NONE blockLevel and INACTIVE subscription', () => {
        expect(shouldIncludeCompany('inativas', 'NONE', 'INACTIVE')).toBe(true);
      });

      it('should NOT include company with PARTIAL blockLevel', () => {
        expect(shouldIncludeCompany('inativas', 'PARTIAL', 'ACTIVE')).toBe(
          false,
        );
      });

      it('should NOT include company with NONE blockLevel and ACTIVE subscription', () => {
        expect(shouldIncludeCompany('inativas', 'NONE', 'ACTIVE')).toBe(false);
      });
    });

    describe('ativas filter', () => {
      it('should include company with NONE blockLevel and ACTIVE subscription', () => {
        expect(shouldIncludeCompany('ativas', 'NONE', 'ACTIVE')).toBe(true);
      });

      it('should NOT include company with PARTIAL blockLevel', () => {
        expect(shouldIncludeCompany('ativas', 'PARTIAL', 'ACTIVE')).toBe(false);
      });

      it('should NOT include company with FULL blockLevel', () => {
        expect(shouldIncludeCompany('ativas', 'FULL', 'ACTIVE')).toBe(false);
      });
    });

    describe('canceladas filter', () => {
      it('should include company with NONE blockLevel and CANCELED subscription', () => {
        expect(shouldIncludeCompany('canceladas', 'NONE', 'CANCELED')).toBe(
          true,
        );
      });

      it('should NOT include blocked company even with CANCELED subscription', () => {
        expect(shouldIncludeCompany('canceladas', 'PARTIAL', 'CANCELED')).toBe(
          false,
        );
      });
    });
  });
});
