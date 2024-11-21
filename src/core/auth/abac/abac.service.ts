import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { UserService } from 'src/core/user/user.service';

@Injectable()
export class AbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
  ) {}

  async hasPermission(
    user: { userId: string; username: string },
    action: string,
    resource: string,
  ): Promise<boolean> {
    const userWithRolesAndAttributes = await this.userService.findOne(
      user.userId,
    );

    if (!userWithRolesAndAttributes) {
      return false;
    }

    // TODO: Implementar verificação de atributos
    // Verifica se o usuário tem os atributos necessários
    // const hasRequiredAttributes = userWithRolesAndAttributes.attributes.some(
    //   attr => /* Sua lógica para verificar atributos */
    // );

    // if (!hasRequiredAttributes) {
    //   return false;
    // }

    // console.log(userWithRolesAndAttributes);

    // Verifica se alguma das roles do usuário concede permissão
    return userWithRolesAndAttributes.policies.some((userRole) => {
      return (
        userRole.definition['resource'] === resource &&
        userRole.definition['action'] === action
      );
      // return userRole.role.rolePolicy.some((rolePolicy) => {
      //   // Verifique se a política está associada ao recurso e permite a ação
      //   const policy = rolePolicy.policy;
      //   return (
      //     policy.definition['resource'] === resource &&
      //     policy.definition['action'] === action
      //   );
      // });
    });
  }
}
