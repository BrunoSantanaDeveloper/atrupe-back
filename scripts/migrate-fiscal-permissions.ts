/**
 * Migração de permissões fiscais — Fase 2 da centralização.
 *
 * PROBLEMA
 * O recurso `nota_fiscal:emitidas` é exigido por 28 endpoints (nfe/nfse/nfce
 * controllers) mas nunca existiu no catálogo de cargos do frontend
 * (app-web/src/consts/permissions.ts). Ou seja: era impossível conceder essa
 * permissão pela interface. Na prática, só cargos `isAdmin` ou com wildcard
 * conseguiam consultar notas emitidas.
 *
 * A Fase 2 adicionou `emitidas` ao catálogo, mas cargos já existentes não a
 * têm. Sem esta migração, quem hoje emite notas continua sem conseguir
 * consultá-las depois que a aba de gestão passar a exigir a chave correta.
 *
 * O QUE FAZ
 * Para todo cargo não-admin que já possua qualquer `nota_fiscal:emitir:*`,
 * concede `nota_fiscal:emitidas:view`. Idempotente: não duplica e não mexe
 * em cargo que já tenha a permissão.
 *
 * Rode com --dry-run primeiro.
 *
 * Uso:
 *   npx ts-node scripts/migrate-fiscal-permissions.ts --dry-run
 *   npx ts-node scripts/migrate-fiscal-permissions.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const GRANTED = 'nota_fiscal:emitidas:view';
const TRIGGER_PREFIX = 'nota_fiscal:emitir:';

const isDryRun = process.argv.includes('--dry-run');

async function main() {
  console.log(
    isDryRun
      ? '[DRY-RUN] Nenhuma alteração será gravada.\n'
      : '[MIGRAÇÃO] Concedendo ' + GRANTED + ' aos cargos elegíveis.\n',
  );

  const roles = await prisma.role.findMany({
    select: {
      id: true,
      name: true,
      isAdmin: true,
      permissions: true,
      companyId: true,
    },
  });

  const elegiveis = roles.filter((r) => {
    if (r.isAdmin) return false;
    const perms = r.permissions || [];
    if (perms.includes('*')) return false;
    if (perms.includes(GRANTED)) return false;
    return perms.some((p) => p.startsWith(TRIGGER_PREFIX));
  });

  console.log(`Cargos analisados: ${roles.length}`);
  console.log(`Cargos elegíveis:  ${elegiveis.length}\n`);

  if (elegiveis.length === 0) {
    console.log('Nada a fazer.');
    return;
  }

  for (const role of elegiveis) {
    const antes = (role.permissions || []).filter((p) =>
      p.startsWith('nota_fiscal:'),
    );
    console.log(`  ${role.name} (${role.id})`);
    console.log(`    company: ${role.companyId}`);
    console.log(`    fiscais hoje: ${antes.join(', ') || '(nenhuma)'}`);
    console.log(`    + ${GRANTED}`);

    if (!isDryRun) {
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { push: GRANTED } },
      });
    }
  }

  console.log(
    isDryRun
      ? `\n[DRY-RUN] ${elegiveis.length} cargo(s) seriam atualizados.`
      : `\n[OK] ${elegiveis.length} cargo(s) atualizados.`,
  );
}

main()
  .catch((e) => {
    console.error('Falha na migração:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
