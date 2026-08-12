import * as crypto from 'crypto';
import * as forge from 'node-forge';
import * as tls from 'tls';

export interface CertificateInfo {
  validFrom: Date | null;
  expiresAt: Date | null;
  issuer: string | null;
  serialNumber: string | null;
  subject: string | null;
  cnpj: string | null;
}

/**
 * Parses a PFX/PKCS12 certificate (base64) and extracts metadata.
 * The Node TLS path is kept for modern certificates; forge is used as a
 * fallback for PKCS#12 files that OpenSSL rejects because of legacy ciphers.
 */
export function parsePfxCertificate(
  base64Certificate: string,
  password: string,
): CertificateInfo | null {
  const pfxBuffer = Buffer.from(stripDataUrl(base64Certificate), 'base64');

  return (
    parsePfxCertificateWithNode(pfxBuffer, password) ||
    parsePfxCertificateWithForge(pfxBuffer, password)
  );
}

function parsePfxCertificateWithNode(
  pfxBuffer: Buffer,
  password: string,
): CertificateInfo | null {
  try {
    const secureContext = tls.createSecureContext({
      pfx: pfxBuffer,
      passphrase: password,
    });

    const rawCert = (secureContext as any).context?.getCertificate?.();
    if (!rawCert) return null;

    const x509 = new crypto.X509Certificate(rawCert);

    return {
      validFrom: new Date(x509.validFrom),
      expiresAt: new Date(x509.validTo),
      issuer: extractCN(x509.issuer) || x509.issuer,
      serialNumber: x509.serialNumber,
      subject: extractCN(x509.subject) || x509.subject,
      cnpj: extractCnpj(x509.subject),
    };
  } catch (error) {
    console.warn(
      'Failed to parse PFX certificate with Node:',
      error?.message || error,
    );
    return null;
  }
}

function parsePfxCertificateWithForge(
  pfxBuffer: Buffer,
  password: string,
): CertificateInfo | null {
  try {
    const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password || '');
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[
      forge.pki.oids.certBag
    ];

    const cert = certBags?.find((bag) => !!bag.cert)?.cert;
    if (!cert) return null;

    const subject = forgeDistinguishedNameToString(cert.subject);
    const issuer = forgeDistinguishedNameToString(cert.issuer);

    return {
      validFrom: cert.validity?.notBefore || null,
      expiresAt: cert.validity?.notAfter || null,
      issuer: extractCN(issuer) || issuer,
      serialNumber: cert.serialNumber || null,
      subject: extractCN(subject) || subject,
      cnpj: extractCnpj(subject),
    };
  } catch (error) {
    console.warn(
      'Failed to parse PFX certificate with forge:',
      error?.message || error,
    );
    return null;
  }
}

function forgeDistinguishedNameToString(
  name: forge.pki.Certificate['subject'],
): string {
  return (name.attributes || [])
    .map((attribute) => {
      const key = attribute.shortName || attribute.name || attribute.type;
      return `${key}=${attribute.value}`;
    })
    .join('\n');
}

/** Raiz do CNPJ: os 8 primeiros dígitos, comuns a matriz e filiais. */
function cnpjRoot(cnpj: string): string {
  return onlyDigits(cnpj).slice(0, 8);
}

/**
 * Valida se o certificado digital pode assinar as notas deste emitente.
 *
 * A comparação é pela RAIZ do CNPJ (8 primeiros dígitos), não pelos 14 dígitos:
 * a SEFAZ aceita que o certificado da matriz assine as notas das filiais, e o
 * contrário também. Exigir o CNPJ completo reprovava uma configuração legítima
 * — e comum, já que a maioria das empresas com filial usa um único A1 — travando
 * a ativação de produção com uma pendência que a SEFAZ nunca levantaria.
 *
 * A raiz continua barrando o que realmente importa: certificado de outra
 * empresa.
 */
export function validatePfxCertificateCnpj(
  base64Certificate: string,
  password: string,
  expectedCnpj: string,
): {
  valid: boolean;
  certificateCnpj?: string;
  message?: string;
  differentEstablishment?: boolean;
} {
  const expected = onlyDigits(expectedCnpj);
  const certInfo = parsePfxCertificate(base64Certificate, password);

  if (!certInfo) {
    return {
      valid: false,
      message:
        'Não foi possível ler o certificado digital. Verifique o arquivo A1 e a senha informada.',
    };
  }

  if (!certInfo.cnpj) {
    return {
      valid: false,
      message:
        'Não foi possível identificar o CNPJ no certificado digital informado.',
    };
  }

  if (cnpjRoot(certInfo.cnpj) !== cnpjRoot(expected)) {
    return {
      valid: false,
      certificateCnpj: certInfo.cnpj,
      message: `O certificado digital (${formatCnpj(
        certInfo.cnpj,
      )}) pertence a outra empresa. O CNPJ cadastrado no Atrupe é ${formatCnpj(
        expected,
      )} — o certificado precisa ser da mesma raiz de CNPJ (matriz ou filial).`,
    };
  }

  // Mesma raiz, estabelecimento diferente: válido para a SEFAZ. Sinalizado para
  // quem quiser avisar que a assinatura sai com o certificado de outra filial.
  return {
    valid: true,
    certificateCnpj: certInfo.cnpj,
    differentEstablishment: certInfo.cnpj !== expected,
  };
}

/**
 * Extracts Common Name (CN) from a distinguished name string.
 * Example: "CN=EMPRESA LTDA\nO=ICP-Brasil" -> "EMPRESA LTDA"
 */
function extractCN(dn: string): string | null {
  if (!dn) return null;
  const match = dn.match(/CN=([^\n,]+)/i);
  return match ? match[1].trim() : null;
}

function stripDataUrl(value: string): string {
  return value?.includes(',') ? value.split(',').pop() || '' : value;
}

function onlyDigits(value: string): string {
  return (value || '').replace(/\D/g, '');
}

export function extractCnpj(value: string): string | null {
  if (!value) return null;

  const commonName = extractCN(value);
  const cnpjFromCommonName = findFirstCnpj(commonName || '');
  if (cnpjFromCommonName) return cnpjFromCommonName;

  return findFirstCnpj(value);
}

function findFirstCnpj(value: string): string | null {
  if (!value) return null;

  const formatted = value.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/);
  if (formatted) {
    const clean = onlyDigits(formatted[0]);
    if (clean.length === 14) return clean;
  }

  const candidates = value.match(/\d{14}/g) || [];
  return candidates.find((candidate) => candidate.length === 14) || null;
}

function formatCnpj(value: string): string {
  const clean = onlyDigits(value);
  if (clean.length !== 14) return value;

  return clean.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    '$1.$2.$3/$4-$5',
  );
}
