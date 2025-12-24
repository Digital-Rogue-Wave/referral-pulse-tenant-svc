import { Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlanStripeSyncService } from './plan-stripe-sync.service';
import { BillingService } from './billing.service';
import { PlanService } from './plan.service';
import Stripe from 'stripe';

@ApiTags('Testing')
@Controller('test')
export class TestBillingController {
  constructor(
    private readonly planSyncService: PlanStripeSyncService,
    private readonly billingService: BillingService,
    private readonly planService: PlanService  // Added PlanService
  ) {}

  @Get('health')
  health() {
    return { 
      status: 'ok', 
      port: 5001,
      time: new Date().toISOString() 
    };
  }

  @Post('sync-stripe')
  async syncStripe() {
    await this.planSyncService.syncFromStripe();
    return { message: 'Stripe plans synced!' };
  }

  @Get('check-plans')
  async checkPlans() {
    // Use planService to get plans
    const plans = await this.planService.getPublicPlansCached();
    return {
      count: plans.length,
      plans: plans.map(p => ({
        id: p.id,
        name: p.name,
        stripePriceId: p.stripePriceId,
        isActive: p.isActive
      }))
    };
  }

  @Post('trigger-webhook')
  async triggerWebhook() {
    return {
      instruction: 'Run this in terminal:',
      command: 'stripe trigger checkout.session.completed'
    };
  }

  @Get('check-billing')
  async checkBilling() {
    // We'll implement this differently
    return { 
      message: 'Use billing service methods instead',
      hint: 'The billing repository is tenant-aware and requires tenant context'
    };
  }

@Post('test-stripe-connection')
async testStripe() {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-11-17.clover'
  });
  
  const customers = await stripe.customers.list({ limit: 1 });
  
  return {
    connected: true,
    customerCount: customers.data.length,
    defaultCurrency: customers.data[0]?.currency || 'usd'
  };
}

  // Simple endpoint to simulate checkout
  @Post('simulate-checkout')
  async simulateCheckout() {
    // This won't work without tenant context, but gives instructions
    return {
      steps: [
        '1. Get a valid JWT token',
        '2. Set tenant-id header',
        '3. POST to /api/v1/billings/subscription/checkout with {"plan": "starter"}',
        '4. Or test webhooks directly with: stripe trigger checkout.session.completed'
      ]
    };
  }
}