import { Injectable } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import servicesConfig from '@mod/config/services.config';
import { HttpClient } from '@mod/common/http/http.client';

@Injectable()
export class ClientIdentityClient {
    private readonly baseUrl: string;

    constructor(
        private readonly http: HttpClient,
        private readonly config: ConfigService,
    ) {
        const services = this.config.getOrThrow<ConfigType<typeof servicesConfig>>(
            'servicesConfig',
            { infer: true }
        );

        this.baseUrl = services.clientIdentity;
    }

    async getUsers(req: { userId: string; }) {
        const { data } = await this.http.post(
            `${this.baseUrl}/internal/users/{userId}/`,
            req
        );

        return data;
    }
}
