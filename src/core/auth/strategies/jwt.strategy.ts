import { Strategy, ExtractJwt } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { jwtConstants } from '../constants';
import { SessionAccessService } from '../session-access.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly sessionAccess: SessionAccessService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtConstants.secret,
    });
  }

  async validate(payload: any) {
    // O token é sem estado: quem perdeu o acesso (uma transferência de
    // titularidade) é barrado aqui, e não só quando o token vencer.
    await this.sessionAccess.assertLinked(payload);

    return {
      userId: payload.sub,
      username: payload.username,
      companyId: payload.companyId,
      role: payload.role,
      isAdmin: payload.isAdmin,
      isSystemAdmin: payload.isSystemAdmin,
      employeeId: payload.employeeId,
    };
  }
}
