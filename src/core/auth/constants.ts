import * as process from 'process';

export const jwtConstants = {
  secret: process.env.JWT_SECRET,
  refreshSecret: process.env.JWT_REFRESH_SECRET,
};

if (!jwtConstants.secret) {
  throw new Error('JWT_SECRET environment variable must be defined');
}

if (!jwtConstants.refreshSecret) {
  throw new Error('JWT_REFRESH_SECRET environment variable must be defined');
}
