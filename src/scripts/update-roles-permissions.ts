#!/usr/bin/env ts-node

import { PrismaService } from 'nestjs-prisma';
import { BASE_ROLES } from '../seeds/roles-base';

/**
 * Script para atualizar permissões dos cargos base existentes
 *
 * Este script:
 * 1. Identifica cargos base pelo nome (ex: "Gerente Geral", "Vendedor")
 * 2. Atualiza as permissões conforme roles-base.ts
 * 3. Mantém customizações de cargos criados pelos usuários
 * 4. Cria cargo "Super Admin" se não existir
 */

async function main() {
  const prisma = new PrismaService();

  try {
    console.log('🚀 Iniciando atualização de permissões dos cargos...\n');

    // Buscar todas as empresas
    const companies = await prisma.company.findMany({
      select: { id: true, name: true },
    });

    console.log(`📊 Encontradas ${companies.length} empresas\n`);

    let totalUpdated = 0;
    let totalCreated = 0;

    for (const company of companies) {
      console.log(
        `\n🏢 Processando empresa: ${company.name} (ID: ${company.id})`,
      );

      for (const baseRole of BASE_ROLES) {
        // Buscar cargo pelo nome na empresa
        const existingRole = await prisma.role.findFirst({
          where: {
            companyId: company.id,
            name: baseRole.name,
          },
        });

        if (existingRole) {
          // Atualizar permissões do cargo existente
          await prisma.role.update({
            where: { id: existingRole.id },
            data: {
              permissions: baseRole.permissions,
            },
          });

          console.log(
            `  ✅ Atualizado: "${baseRole.name}" (${baseRole.permissions.length} permissões)`,
          );
          totalUpdated++;
        } else {
          // Criar cargo se não existir (ex: Super Admin)
          await prisma.role.create({
            data: {
              name: baseRole.name,
              permissions: baseRole.permissions,
              companyId: company.id,
            },
          });

          console.log(
            `  ➕ Criado: "${baseRole.name}" (${baseRole.permissions.length} permissões)`,
          );
          totalCreated++;
        }
      }
    }

    console.log('\n\n📊 RESUMO DA ATUALIZAÇÃO:');
    console.log(`  • Empresas processadas: ${companies.length}`);
    console.log(`  • Cargos atualizados: ${totalUpdated}`);
    console.log(`  • Cargos criados: ${totalCreated}`);
    console.log(`  • Total de operações: ${totalUpdated + totalCreated}`);

    console.log('\n✅ Atualização de permissões concluída com sucesso!');
    console.log(
      '\n⚠️  IMPORTANTE: Usuários precisarão fazer logout e login novamente para as novas permissões entrarem em vigor.',
    );
  } catch (error) {
    console.error('❌ Erro durante atualização de permissões:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}

export { main };
