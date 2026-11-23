import { createHash, createHmac } from 'crypto';

/**
 * O link assinado de leitura do S3 (SigV4 por query string), sem SDK: o
 * arquivo do anexo é privado e a tela recebe um link com prazo (GP-27).
 * Conferido com o exemplo da documentação da AWS no spec.
 */
export type PresignInput = {
  bucket: string;
  region: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiresSeconds: number;
  now: Date;
};

/** O envio assina também o tamanho e o tipo declarados ao pedir o link. */
export type PresignPutInput = PresignInput & {
  contentLength: number;
  contentType: string;
};

// RFC 3986: o encodeURIComponent deixa !'()* sem codificar
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const hmac = (key: string | Buffer, data: string) =>
  createHmac('sha256', key).update(data, 'utf8').digest();

export const s3Host = (bucket: string, region: string) =>
  region === 'us-east-1'
    ? `${bucket}.s3.amazonaws.com`
    : `${bucket}.s3.${region}.amazonaws.com`;

export function presignGetUrl(input: PresignInput): string {
  return presignUrl('GET', input, {});
}

/**
 * O link assinado de envio: o navegador manda o arquivo direto ao S3 (PUT),
 * sem passar pelo servidor, e o arquivo pesado não tem o teto do upload.
 *
 * O `content-length` e o `content-type` entram na assinatura: o S3 recusa o
 * PUT de outro tamanho ou de outro tipo (SignatureDoesNotMatch), então o
 * mesmo link não serve para trocar o arquivo por um maior depois de
 * registrado. O navegador põe o Content-Length sozinho; a tela manda o
 * Content-Type exatamente como veio com o link.
 */
export function presignPutUrl(input: PresignPutInput): string {
  if (!Number.isSafeInteger(input.contentLength) || input.contentLength < 1) {
    throw new Error('Tamanho do arquivo inválido para o link de envio');
  }
  const contentType = input.contentType.trim();
  if (!contentType || /[\r\n]/.test(contentType)) {
    throw new Error('Tipo do arquivo inválido para o link de envio');
  }
  return presignUrl('PUT', input, {
    'content-length': String(input.contentLength),
    'content-type': contentType,
  });
}

function presignUrl(
  method: 'GET' | 'PUT',
  input: PresignInput,
  extraHeaders: Record<string, string>,
): string {
  const host = s3Host(input.bucket, input.region);
  // Os cabeçalhos assinados, com o nome em minúsculas e em ordem alfabética
  const headers: Record<string, string> = { ...extraHeaders, host };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonicalHeaders = names
    .map((name) => `${name}:${headers[name].trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const amzDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const path = `/${input.key.split('/').map(encode).join('/')}`;
  const params: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${input.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(input.expiresSeconds)],
    ...(input.sessionToken
      ? [['X-Amz-Security-Token', input.sessionToken] as [string, string]]
      : []),
    ['X-Amz-SignedHeaders', signedHeaders],
  ];
  const query = params
    .map(([name, value]) => [encode(name), encode(value)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  // Cada cabeçalho termina em \n; o join põe a linha em branco depois deles
  const canonical = [
    method,
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const toSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonical, 'utf8').digest('hex'),
  ].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey)
    .update(toSign, 'utf8')
    .digest('hex');
  return `https://${host}${path}?${query}&X-Amz-Signature=${signature}`;
}
