import { NfeXmlError, parseNfeXml } from './nfe-xml';

const KEY = '42261012345678000190550010000129871000000017';

const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe>
<infNFe Id="NFe${KEY}" versao="4.00">${body}</infNFe></NFe></nfeProc>`;

const HEADER = `<ide><nNF>12987</nNF><serie>1</serie><dhEmi>2026-10-10T10:15:00-03:00</dhEmi></ide>
<emit><CNPJ>12345678000190</CNPJ><xNome>Distribuidora Sul &amp; Cia</xNome></emit>`;

describe('parseNfeXml', () => {
  it('lê a chave, o emitente, o total e os itens em centavos', () => {
    const invoice = parseNfeXml(
      xml(`${HEADER}
<det nItem="1"><prod><cProd>LN440-BR</cProd><cEAN>7891234567890</cEAN><xProd>LONA 440G</xProd><uCom>rolo</uCom><qCom>2.0000</qCom><vUnCom>680.0000000000</vUnCom></prod></det>
<det nItem="2"><prod><cProd>ILH-10</cProd><cEAN>SEM GTIN</cEAN><xProd>ILHOS &lt;10MM&gt;</xProd><uCom>PCT</uCom><qCom>1</qCom><vUnCom>50.005</vUnCom></prod></det>
<total><ICMSTot><vNF>1410.01</vNF></ICMSTot></total>`),
    );

    expect(invoice).toMatchObject({
      accessKey: KEY,
      number: '12987',
      series: '1',
      supplierName: 'Distribuidora Sul & Cia',
      supplierDocument: '12345678000190',
      total: 141001,
    });
    expect(invoice.issueDate.toISOString()).toBe('2026-10-10T13:15:00.000Z');
    expect(invoice.items).toEqual([
      {
        position: 1,
        supplierCode: 'LN440-BR',
        description: 'LONA 440G',
        supplierUnit: 'ROLO',
        quantity: 2,
        unitValue: 68000,
        gtin: '7891234567890',
      },
      {
        position: 2,
        supplierCode: 'ILH-10',
        description: 'ILHOS <10MM>',
        supplierUnit: 'PCT',
        quantity: 1,
        unitValue: 5001,
        gtin: null,
      },
    ]);
  });

  it('recusa o que não é NF-e e a nota sem itens', () => {
    expect(() => parseNfeXml('<html></html>')).toThrow(NfeXmlError);
    expect(() => parseNfeXml(xml(HEADER))).toThrow('A NF-e não tem itens');
  });
});
