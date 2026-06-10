import * as tls from 'tls';
import * as crypto from 'crypto';

export interface CertificateInfo {
  expiresAt: Date | null;
  issuer: string | null;
  serialNumber: string | null;
  subject: string | null;
  cnpj: string | null;
}

/**
 * Parses a PFX/PKCS12 certificate (base64) and extracts metadata.
 * Uses Node.js built-in tls + crypto modules — no external dependencies.
 *
 * @param base64Certificate - Base64-encoded PFX file content
 * @param password - PFX password
 * @returns Parsed certificate info or null if parsing fails
 */
export function parsePfxCertificate(
  base64Certificate: string,
  password: string,
): CertificateInfo | null {
  try {
    const pfxBuffer = Buffer.from(stripDataUrl(base64Certificate), 'base64');

    // Create secure context to extract the certificate
    const secureContext = tls.createSecureContext({
      pfx: pfxBuffer,
      passphrase: password,
    });

    // Get the raw certificate from the context
    const rawCert = (secureContext as any).context?.getCertificate?.();

    if (rawCert) {
      try {
        const x509 = new crypto.X509Certificate(rawCert);
        return {
          expiresAt: new Date(x509.validTo),
          issuer: extractCN(x509.issuer) || x509.issuer,
          serialNumber: x509.serialNumber,
          subject: extractCN(x509.subject) || x509.subject,
          cnpj: extractCnpj(x509.subject),
        };
      } catch {
        // X509Certificate constructor may not be available in older Node versions
      }
    }

    return null;
  } catch (error) {
    // Log but don't throw — certificate parsing is non-critical
    console.warn('Failed to parse PFX certificate:', error?.message || error);
    return null;
  }
}

export function validatePfxCertificateCnpj(
  base64Certificate: string,
  password: string,
  expectedCnpj: string,
): { valid: boolean; certificateCnpj?: string; message?: string } {
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

  if (certInfo.cnpj !== expected) {
    return {
      valid: false,
      certificateCnpj: certInfo.cnpj,
      message: `O CNPJ do certificado digital (${formatCnpj(
        certInfo.cnpj,
      )}) é diferente do CNPJ cadastrado no Atrupe (${formatCnpj(expected)}).`,
    };
  }

  return { valid: true, certificateCnpj: certInfo.cnpj };
}

/**
 * Extracts Common Name (CN) from a distinguished name string.
 * Example: "CN=EMPRESA LTDA\nO=ICP-Brasil" → "EMPRESA LTDA"
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

function extractCnpj(value: string): string | null {
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
