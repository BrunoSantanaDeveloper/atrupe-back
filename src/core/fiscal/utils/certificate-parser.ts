import * as tls from 'tls';
import * as crypto from 'crypto';

export interface CertificateInfo {
  expiresAt: Date | null;
  issuer: string | null;
  serialNumber: string | null;
  subject: string | null;
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
    const pfxBuffer = Buffer.from(base64Certificate, 'base64');

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

/**
 * Extracts Common Name (CN) from a distinguished name string.
 * Example: "CN=EMPRESA LTDA\nO=ICP-Brasil" → "EMPRESA LTDA"
 */
function extractCN(dn: string): string | null {
  if (!dn) return null;
  const match = dn.match(/CN=([^\n,]+)/i);
  return match ? match[1].trim() : null;
}
