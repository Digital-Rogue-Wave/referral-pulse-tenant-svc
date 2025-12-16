import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt, StrategyOptions } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { ClsService } from 'nestjs-cls';
import oryConfig from '@mod/config/ory.config';
import { JwtPayload } from '@mod/types/app.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
    constructor(
        private readonly config: ConfigService,
        private readonly cls: ClsService
    ) {
        const oryCfg = config.getOrThrow<ConfigType<typeof oryConfig>>('oryConfig', { infer: true });

        const options: StrategyOptions = {
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

            secretOrKeyProvider: passportJwtSecret({
                cache: true,
                rateLimit: true,
                jwksRequestsPerMinute: 10,
                jwksUri: oryCfg.hydra.jwksUrl
            }),

            audience: oryCfg.audience,
            issuer: oryCfg.hydra.issuer,
            algorithms: ['RS256']
        };

        super(options);
    }

    validate(payload: JwtPayload): JwtPayload {
        if (!payload.sub) {
            throw new UnauthorizedException('JWT missing sub claim');
        }

        // Determine if this is a user or service token
        const isServiceToken = !!payload.client_id || payload.grant_type === 'client_credentials';

        // Extract tenant_id from various possible locations
        /*const tenantId = this.extractTenantId(payload);

        if (!tenantId) {
            throw new UnauthorizedException('JWT missing tenant_id claim');
        }*/

        // Store in CLS
        //this.cls.set('tenantId', tenantId);
        this.cls.set('userId', isServiceToken ? undefined : payload.sub);
        this.cls.set('isServiceToken', isServiceToken);

        if (isServiceToken) {
            this.cls.set('serviceClientId', payload.client_id || payload.sub);
        }

        return payload;
    }

    private extractTenantId(payload: JwtPayload): string | undefined {
        // Priority order for tenant extraction:
        // 1. Top-level tenant_id
        // 2. ext.tenant_id
        // 3. For M2M tokens, might be in client metadata (handle in service layer)
        return payload.tenant_id || payload.ext?.tenant_id || undefined;
    }
}
