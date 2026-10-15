import { OfxError, businessDaysBetween, parseOfx } from './ofx';

const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>0237<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260928120000[-3:BRT]
<TRNAMT>1200.00
<FITID>A1
<MEMO>PIX RECEBIDO &amp; CIA
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260929
<TRNAMT>-12,90
<FITID>A2
<NAME>TARIFA
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const XML = `<?xml version="1.0"?><?OFX OFXHEADER="200" VERSION="220"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261001</DTPOSTED><TRNAMT>950.5</TRNAMT><FITID>X9</FITID><MEMO>REDE</MEMO></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('parseOfx', () => {
  it('lê o SGML do OFX 1.x: data, valor com sinal em centavos, FITID e memo', () => {
    const statement = parseOfx(SGML);
    expect(statement.bankId).toBe('0237');
    expect(statement.accountId).toBe('12345-6');
    expect(statement.lines).toEqual([
      {
        fitId: 'A1',
        date: '2026-09-28',
        amount: 120000,
        memo: 'PIX RECEBIDO & CIA',
      },
      { fitId: 'A2', date: '2026-09-29', amount: -1290, memo: 'TARIFA' },
    ]);
  });

  it('lê o XML do OFX 2.x', () => {
    expect(parseOfx(XML).lines).toEqual([
      { fitId: 'X9', date: '2026-10-01', amount: 95050, memo: 'REDE' },
    ]);
  });

  it('recusa o que não é OFX', () => {
    expect(() => parseOfx('data;valor')).toThrow(OfxError);
  });
});

describe('businessDaysBetween', () => {
  it('não conta sábado e domingo', () => {
    // Sexta 25/09 → segunda 28/09: 1 dia útil
    expect(businessDaysBetween('2026-09-25', '2026-09-28')).toBe(1);
    expect(businessDaysBetween('2026-09-28', '2026-09-25')).toBe(1);
    expect(businessDaysBetween('2026-09-28', '2026-10-01')).toBe(3);
    expect(businessDaysBetween('2026-09-28', '2026-09-28')).toBe(0);
  });
});
