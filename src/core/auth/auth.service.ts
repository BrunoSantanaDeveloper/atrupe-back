import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import * as argon2 from 'argon2';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UserService,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);
    if (user && (await argon2.verify(user.password, pass))) {
      const { ...result } = user;
      return result;
    }

    return null;
  }

  async login(user: any) {
    try {
      const payload = {
        username: user.email,
        sub: user.id,
        companyId: user.employee[0]?.company.id,
        role: user.employee[0]?.role?.name,
      };

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.employee[0]?.avatarUrl,
        role: user.employee[0] ? user.employee[0].role?.name : null,
        employeeId: user.employee[0]?.id,
        permissions: user.employee[0]?.role?.permissions,
        company: user.employee[0]?.company
          ? {
              id: user.employee[0].company.id,
              name: user.employee[0].company.name,
              legalName: user.employee[0].company.legalName,
              logo: user.employee[0].company.logoUrl,
              favicon: user.employee[0].company.favIconUrl,
            }
          : null,
        access_token: this.jwtService.sign(payload),
      };
    } catch (error) {
      console.log(error);
      throw new Error('Erro ao gerar token');
    }
  }
}
