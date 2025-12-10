import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';

@Injectable()
export class SharedService {
    constructor(
        //private jwtService: JwtService,
        private configService: ConfigService<AllConfigType>
    ) {}
    /*
  async getTokensData(data: {
    id: UserEntity['id'];
    role: UserEntity['role'];
  }) {
    const tokenExpiresIn = this.configService.getOrThrow('auth.expires', {
      infer: true,
    });
    const tokenExpires = Date.now() + ms(tokenExpiresIn as unknown as number);
    const [accessToken, refreshToken] = await Promise.all([
      await this.jwtService.signAsync(
        {
          id: data.id,
          role: data.role,
        },
        {
          secret: this.configService.getOrThrow('auth.secret', { infer: true }),
          expiresIn: tokenExpiresIn,
        },
      ),
      await this.jwtService.signAsync(
        {
          id: data.id,
          role: data.role,
        },
        {
          secret: this.configService.getOrThrow('auth.refreshSecret', {
            infer: true,
          }),
          expiresIn: this.configService.getOrThrow('auth.refreshExpires', {
            infer: true,
          }),
        },
      ),
    ]);

    return {
      accessToken,
      refreshToken,
      tokenExpires: Number(tokenExpires),
    };
  }
  async getAccessTokensData(data: {
    id: UserEntity['id'];
    role: UserEntity['role'];
  }) {
    const tokenExpiresIn = this.configService.getOrThrow('auth.expires', {
      infer: true,
    });

    const tokenExpires = Date.now() + ms(tokenExpiresIn as unknown as number);

    const accessToken = await this.jwtService.signAsync(
      {
        id: data.id,
        role: data.role,
      },
      {
        secret: this.configService.getOrThrow('auth.secret', { infer: true }),
        expiresIn: tokenExpiresIn,
      },
    );

    return {
      accessToken,
      tokenExpires: Number(tokenExpires),
    };
  }*/
}
