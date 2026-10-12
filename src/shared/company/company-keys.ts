/**
 * A linha da empresa sem as chaves do provedor fiscal (`accessKey` e
 * `partnerKey`, gravadas em texto puro no modo legado), para as respostas que
 * levam a empresa inteira a qualquer usuário dela.
 */
export function companyWithoutKeys<T extends object | null | undefined>(
  company: T,
): T {
  if (!company) return company;
  const rest: any = { ...company };
  delete rest.accessKey;
  delete rest.partnerKey;
  return rest;
}
