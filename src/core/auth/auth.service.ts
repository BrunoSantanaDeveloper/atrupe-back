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
      console.log(result);
      return result;
    }

    return null;
  }

  async login(user: any) {
    const payload = {
      username: user.email,
      sub: user.id,
      companyId: user.employee?.companyId,
    };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
