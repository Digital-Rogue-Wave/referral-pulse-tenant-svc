import { Controller, Post, Body, Get, Request, Param } from '@nestjs/common';
import { Idempotent } from '@mod/common/idempotency/idempotency.decorator';
import { CampaignService } from '@mod/tenant/campaign.service';
import { HttpClient } from '@mod/common/http/http.client';
import { RequirePermission } from '@mod/common/auth/keto.guard';

@Controller('orders')
export class OrdersController {
    constructor(private readonly campaignService: CampaignService,
                private readonly http: HttpClient) {}

    @Post()
    @Idempotent({ keyPrefix: 'order:create', ttl: 86400 })
    async createCampaign(@Body() dto: {}) {
        // This is automatically deduped based on idempotency-key header
        return this.campaignService.create(dto);
    }

    /*@Post('bulk')
    @Idempotent({ keyPrefix: 'order:bulk', ttl: 3600 })
    async createBulkCampaigns(@Body() dto: {}) {
        return this.campaignService.createBulk(dto);
    }*/

    async notifyInventory(orderId: string) {
        // Automatically authenticated + uses intra circuit breaker
        return this.http.post('/internal/inventory/reserve', { orderId });
    }

    async fetchExternalRates() {
        // No auth + uses thirdparty circuit breaker
        return this.http.get('https://api.exchangerate.com/rates');
    }

    /*@Get()
    @RequirePermission({
        namespace: 'campaigns',
        relation: 'list',
        object: 'all' // Check if user can list campaigns
    })
    async list() {
        return this.campaignService.list();
    }

    // View specific campaign
    @Get(':id')
    @RequirePermission({
        namespace: 'campaigns',
        relation: 'view',
        // object comes from route param 'id'
    })
    async getOne(@Param('id') id: string) {
        return this.campaignService.findOne(id);
    }*/
}
