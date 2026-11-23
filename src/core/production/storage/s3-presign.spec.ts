import { presignGetUrl, presignPutUrl } from './s3-presign';

describe('presignGetUrl', () => {
  // O exemplo de "Authenticating Requests: Using Query Parameters (AWS
  // Signature Version 4)" da documentação do S3
  it('confere com o exemplo da AWS', () => {
    const url = presignGetUrl({
      bucket: 'examplebucket',
      region: 'us-east-1',
      key: 'test.txt',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      expiresSeconds: 86400,
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('codifica cada parte do caminho e usa o host da região', () => {
    const url = presignGetUrl({
      bucket: 'b',
      region: 'sa-east-1',
      key: 'production/c1/t1/arte final (v2).pdf',
      accessKeyId: 'K',
      secretAccessKey: 'S',
      expiresSeconds: 900,
      now: new Date('2026-10-07T12:00:00Z'),
    });
    expect(url).toMatch(
      /^https:\/\/b\.s3\.sa-east-1\.amazonaws\.com\/production\/c1\/t1\/arte%20final%20%28v2%29\.pdf\?/,
    );
    expect(url).toContain('X-Amz-Expires=900');
  });
});

describe('presignPutUrl', () => {
  const put = {
    bucket: 'b',
    region: 'us-east-1',
    key: 'production/c1/t1/arte final (v2).pdf',
    accessKeyId: 'K',
    secretAccessKey: 'S',
    expiresSeconds: 900,
    now: new Date('2026-11-23T12:00:00Z'),
    contentLength: 1048576,
    contentType: 'application/pdf',
  };
  const signatureOf = (url: string) =>
    new URL(url).searchParams.get('X-Amz-Signature');

  // Conferido em 23/11/2026 com o SignatureV4 do SDK da AWS (@smithy 5.1.2),
  // com content-length e content-type assinados e o corpo sem assinatura
  // (UNSIGNED-PAYLOAD), como o presigner do S3 faz
  it('assina o tamanho e o tipo e confere com o SDK da AWS', () => {
    expect(presignPutUrl(put)).toBe(
      'https://b.s3.amazonaws.com/production/c1/t1/arte%20final%20%28v2%29.pdf' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=K%2F20261123%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20261123T120000Z&X-Amz-Expires=900' +
        '&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost' +
        '&X-Amz-Signature=f58ea7405a98f6ed30e45f1622df850442ad4b7a6da8018243e582b334cf68d1',
    );
  });

  // Também conferido com o SDK: outra região e o token de sessão na query
  it('confere com o SDK em outra região e com o token de sessão', () => {
    const url = presignPutUrl({
      ...put,
      region: 'sa-east-1',
      sessionToken: 'TOKEN/abc+=',
      contentLength: 20 * 1024 * 1024,
      contentType: 'image/vnd.dxf',
    });
    expect(url).toContain('X-Amz-Security-Token=TOKEN%2Fabc%2B%3D');
    expect(signatureOf(url)).toBe(
      '70b89d3eb11526665a37d6060a809333e478ac8dac3aa7a17963a3162701f881',
    );
  });

  it('outro tamanho ou outro tipo dão outra assinatura', () => {
    const base = signatureOf(presignPutUrl(put));
    expect(
      signatureOf(presignPutUrl({ ...put, contentLength: 1048577 })),
    ).not.toBe(base);
    expect(
      signatureOf(presignPutUrl({ ...put, contentType: 'image/png' })),
    ).not.toBe(base);
  });

  it('recusa tamanho ou tipo inválido', () => {
    expect(() => presignPutUrl({ ...put, contentLength: 0 })).toThrow();
    expect(() => presignPutUrl({ ...put, contentLength: 1.5 })).toThrow();
    expect(() => presignPutUrl({ ...put, contentType: ' ' })).toThrow();
    expect(() =>
      presignPutUrl({ ...put, contentType: 'text/plain\r\nx-amz-acl: public' }),
    ).toThrow();
  });
});
