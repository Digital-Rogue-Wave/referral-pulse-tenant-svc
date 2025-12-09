import { Module, Global } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import oryConfig from '@mod/config/ory.config';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { KetoService } from './keto.service';
import { KetoGuard } from './keto.guard';
import { HttpClientsModule } from '@mod/common/http/http-clients.module';

@Global()
@Module({
    imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        ConfigModule.forFeature(oryConfig),
        HttpClientsModule.register(),
    ],
    providers: [
        JwtStrategy,
        KetoService,
        // Guards (order matters: JWT first, then Keto)
        {
            provide: APP_GUARD,
            useClass: JwtAuthGuard,
        },
        {
            provide: APP_GUARD,
            useClass: KetoGuard,
        },
    ],
    exports: [PassportModule, KetoService],
})
export class AuthModule {}
