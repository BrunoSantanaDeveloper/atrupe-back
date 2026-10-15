import { presignGetUrl } from './s3-presign';

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
