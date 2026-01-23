# Account Lifecycle & Compliance
## Referral Marketing SaaS Platform

**Version:** 1.0  
**Date:** December 2024

---

# 1. Payment-Based Account Locking

## Flow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PAYMENT FAILURE FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Payment Due ──► Payment Failed ──► Grace Period ──► Restricted ──► Locked │
│       │               │                  │               │            │     │
│       │               │                  │               │            │     │
│       ▼               ▼                  ▼               ▼            ▼     │
│   [Active]     [Notify Admin]      [7 days]      [Read-only]    [No access] │
│                [Retry x3]          [Daily emails]  [14 days]    [Data kept] │
│                                                                              │
│   ◄──────────────── Payment Success = Immediate Restoration ────────────►   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Account States

| State | Access Level | Duration | Trigger |
|-------|--------------|----------|---------|
| **Active** | Full access | - | Payment successful |
| **Past Due** | Full access | 0-7 days | Payment failed, retrying |
| **Restricted** | Read-only | 7-21 days | Grace period expired |
| **Locked** | No access | 21+ days | Still unpaid |
| **Suspended** | No access | Manual | Admin action (policy violation) |

## Database Schema

```sql
-- Add to Tenant entity
ALTER TABLE tenant ADD COLUMN payment_status VARCHAR(20) DEFAULT 'active';
-- Values: active, past_due, restricted, locked

ALTER TABLE tenant ADD COLUMN payment_failed_at TIMESTAMPTZ;
ALTER TABLE tenant ADD COLUMN restriction_started_at TIMESTAMPTZ;
ALTER TABLE tenant ADD COLUMN locked_at TIMESTAMPTZ;
ALTER TABLE tenant ADD COLUMN last_payment_reminder_at TIMESTAMPTZ;
ALTER TABLE tenant ADD COLUMN payment_reminder_count INT DEFAULT 0;
```

## Stripe Webhook Handlers

### 1. Payment Failed (`invoice.payment_failed`)

```typescript
async handlePaymentFailed(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  const tenant = await this.findByStripeCustomerId(invoice.customer);
  
  // Update tenant status
  await this.tenantRepo.update(tenant.id, {
    payment_status: 'past_due',
    payment_failed_at: new Date(),
    payment_reminder_count: 0
  });
  
  // Publish event for notifications
  await this.eventBus.publish('payment.failed', {
    tenantId: tenant.id,
    invoiceId: invoice.id,
    amount: invoice.amount_due,
    currency: invoice.currency,
    nextRetryAt: invoice.next_payment_attempt
  });
  
  // Send immediate notification
  await this.integrationService.sendEmail({
    to: tenant.billingEmail,
    template: 'payment_failed',
    data: { 
      amount: invoice.amount_due,
      updatePaymentUrl: `${APP_URL}/settings/billing`
    }
  });
}
```

### 2. Payment Succeeded (`invoice.paid`)

```typescript
async handlePaymentSucceeded(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  const tenant = await this.findByStripeCustomerId(invoice.customer);
  
  // Immediate restoration regardless of previous state
  await this.tenantRepo.update(tenant.id, {
    payment_status: 'active',
    payment_failed_at: null,
    restriction_started_at: null,
    locked_at: null,
    payment_reminder_count: 0
  });
  
  // Publish restoration event
  await this.eventBus.publish('payment.restored', {
    tenantId: tenant.id
  });
  
  // Send confirmation
  await this.integrationService.sendEmail({
    to: tenant.billingEmail,
    template: 'payment_restored',
    data: { invoiceUrl: invoice.hosted_invoice_url }
  });
}
```

## Scheduled Jobs (Bull)

### Daily Payment Status Check

```typescript
@Cron('0 9 * * *') // 9 AM daily
async checkPaymentStatuses() {
  const now = new Date();
  
  // 1. Move past_due (7+ days) → restricted
  const pastDueTenants = await this.tenantRepo.find({
    where: {
      payment_status: 'past_due',
      payment_failed_at: LessThan(subDays(now, 7))
    }
  });
  
  for (const tenant of pastDueTenants) {
    await this.tenantRepo.update(tenant.id, {
      payment_status: 'restricted',
      restriction_started_at: now
    });
    
    await this.eventBus.publish('tenant.restricted', { tenantId: tenant.id });
    await this.sendRestrictionNotice(tenant);
  }
  
  // 2. Move restricted (14+ days) → locked
  const restrictedTenants = await this.tenantRepo.find({
    where: {
      payment_status: 'restricted',
      restriction_started_at: LessThan(subDays(now, 14))
    }
  });
  
  for (const tenant of restrictedTenants) {
    await this.tenantRepo.update(tenant.id, {
      payment_status: 'locked',
      locked_at: now
    });
    
    await this.eventBus.publish('tenant.locked', { tenantId: tenant.id });
    await this.pauseAllCampaigns(tenant.id);
    await this.sendLockNotice(tenant);
  }
  
  // 3. Send daily reminders for past_due accounts
  await this.sendDailyPaymentReminders();
}
```

## Access Control Guards

### Payment Status Guard

```typescript
@Injectable()
export class PaymentStatusGuard implements CanActivate {
  
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const tenant = request.tenant;
    const endpoint = request.route.path;
    const method = request.method;
    
    // Locked = no access at all (except billing pages)
    if (tenant.payment_status === 'locked') {
      if (this.isBillingEndpoint(endpoint)) {
        return true; // Allow access to update payment
      }
      throw new PaymentRequiredException('Account locked due to unpaid invoice');
    }
    
    // Restricted = read-only
    if (tenant.payment_status === 'restricted') {
      if (method === 'GET' || this.isBillingEndpoint(endpoint)) {
        return true;
      }
      throw new PaymentRequiredException('Account restricted. Please update payment to continue.');
    }
    
    return true;
  }
  
  private isBillingEndpoint(endpoint: string): boolean {
    return endpoint.includes('/billing') || 
           endpoint.includes('/subscription') ||
           endpoint.includes('/payment-method');
  }
}
```

## What Happens at Each Stage

### Past Due (Day 0-7)
- ✅ Full access continues
- ✅ Campaigns keep running
- ✅ Referrals tracked
- ⚠️ Banner warning in dashboard
- 📧 Email on Day 0, 3, 5, 7

### Restricted (Day 7-21)
- ✅ Read-only access to dashboard
- ✅ Can view analytics, reports
- ✅ Campaigns **keep running** (don't break customer's site)
- ✅ Referrals still tracked
- ❌ Cannot create/edit campaigns
- ❌ Cannot invite team members
- ❌ Cannot change settings
- ✅ Can update payment method
- 📧 Email on Day 7, 10, 14, 18, 21

### Locked (Day 21+)
- ❌ No dashboard access (redirect to payment page)
- ⏸️ All campaigns **paused**
- ❌ Widgets show fallback (or hide)
- ❌ Tracking endpoints return 402
- ✅ Data preserved (not deleted)
- ✅ Can still login to update payment
- 📧 Email on Day 21, 28, then weekly

### Restored (Payment Success)
- ✅ Immediate full access
- ✅ Campaigns **remain paused** (manual reactivation)
- ✅ Data intact
- 📧 Confirmation email

## Notification Schedule

| Day | Status | Email Subject |
|-----|--------|---------------|
| 0 | Past Due | "Payment failed - please update" |
| 3 | Past Due | "Reminder: Payment issue" |
| 5 | Past Due | "Action needed: 2 days until restriction" |
| 7 | Restricted | "Account restricted - update payment now" |
| 10 | Restricted | "Your campaigns will pause in 11 days" |
| 14 | Restricted | "Final warning: 7 days until lock" |
| 21 | Locked | "Account locked - campaigns paused" |
| 28+ | Locked | Weekly reminder |

---

# 2. Team Member Departure

## Scenarios

| Scenario | Who Initiates | What Happens |
|----------|---------------|--------------|
| **Voluntary Leave** | Member | Removed by admin |
| **Terminated** | Admin | Immediate removal |
| **Company Offboarding** | Admin | Immediate removal |
| **Member Deletes Ory Account** | Member | Auto-removed from all tenants |

## Flow: Admin Removes Member

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      MEMBER REMOVAL FLOW                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Admin clicks "Remove" ──► Confirm dialog ──► Process removal              │
│                                                    │                         │
│                         ┌──────────────────────────┼──────────────────────┐  │
│                         ▼                          ▼                      ▼  │
│                  [Revoke Sessions]        [Update Records]         [Notify]  │
│                         │                          │                      │  │
│                         ▼                          ▼                      ▼  │
│              Invalidate all JWT          Set removed_at          Email sent  │
│              for this tenant             Keep for audit          to member   │
│                                          Anonymize PII (30 days)             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Implementation

### Remove Member Endpoint

```typescript
@Delete('/members/:memberId')
@Roles(Role.Admin, Role.Owner)
async removeMember(
  @Param('memberId') memberId: string,
  @CurrentUser() currentUser: User,
  @CurrentTenant() tenant: Tenant
) {
  const member = await this.memberRepo.findOne({ 
    where: { id: memberId, tenantId: tenant.id }
  });
  
  // Validations
  if (member.userId === currentUser.id) {
    throw new BadRequestException('Cannot remove yourself');
  }
  
  if (member.role === Role.Owner) {
    throw new BadRequestException('Cannot remove owner. Transfer ownership first.');
  }
  
  const ownerCount = await this.memberRepo.count({
    where: { tenantId: tenant.id, role: Role.Owner }
  });
  
  if (member.role === Role.Admin && ownerCount === 0) {
    // Check if this is the last admin
    const adminCount = await this.memberRepo.count({
      where: { tenantId: tenant.id, role: Role.Admin, id: Not(memberId) }
    });
    if (adminCount === 0) {
      throw new BadRequestException('Cannot remove last admin');
    }
  }
  
  // Soft delete - keep for audit
  await this.memberRepo.update(memberId, {
    status: 'removed',
    removed_at: new Date(),
    removed_by: currentUser.id
  });
  
  // Invalidate sessions for this tenant
  await this.sessionService.revokeAllForUserInTenant(member.oryIdentityId, tenant.id);
  
  // Publish event
  await this.eventBus.publish('member.removed', {
    tenantId: tenant.id,
    memberId: member.id,
    removedBy: currentUser.id
  });
  
  // Notify removed member
  await this.integrationService.sendEmail({
    to: member.email,
    template: 'member_removed',
    data: {
      tenantName: tenant.name,
      removedBy: currentUser.name
    }
  });
  
  // Schedule PII cleanup
  await this.scheduleAnonymization(memberId, 30); // 30 days
  
  return { success: true };
}
```

### Data Handling for Removed Members

```typescript
// Keep for audit trail
TeamMember {
  id: 'xxx',
  status: 'removed',
  removed_at: '2024-12-01',
  removed_by: 'admin-user-id',
  
  // After 30 days, anonymize PII
  email: 'removed-xxx@anonymized.local', // or hash
  name: 'Removed User',
  ory_identity_id: null, // Unlink from Ory
}

// Audit log entries preserved with original data
AuditLog {
  user_id: 'xxx', // Still linked
  user_email_snapshot: 'john@acme.com', // Snapshot at time of action
  action: 'campaign.created',
  // ...
}
```

### What Gets Preserved vs Removed

| Data | Action | Reason |
|------|--------|--------|
| Member record | Soft delete, then anonymize | Audit trail |
| Audit logs | Keep with snapshot | Compliance |
| Sessions | Revoke immediately | Security |
| API keys created by member | Keep, transfer to owner | Continuity |
| Campaigns created by member | Keep, attribute to tenant | Business data |
| Comments/notes by member | Keep with name snapshot | Context |

## Member Self-Removal

Members cannot remove themselves. They must ask an admin.

**Why?**
- Prevents accidental loss of access
- Maintains audit trail
- Owner must explicitly approve

## Ory Account Deletion

When a user deletes their Ory account:

```typescript
// Ory webhook: identity.deleted
async handleOryIdentityDeleted(event: OryWebhook) {
  const oryIdentityId = event.identity.id;
  
  // Find all tenant memberships
  const memberships = await this.memberRepo.find({
    where: { ory_identity_id: oryIdentityId }
  });
  
  for (const membership of memberships) {
    // Check if owner
    if (membership.role === Role.Owner) {
      // Cannot auto-remove owner - notify other admins
      await this.notifyOwnerAccountDeleted(membership);
      continue;
    }
    
    // Remove from tenant
    await this.memberRepo.update(membership.id, {
      status: 'removed',
      removed_at: new Date(),
      removed_by: 'ory_account_deleted',
      ory_identity_id: null
    });
    
    await this.eventBus.publish('member.removed', {
      tenantId: membership.tenantId,
      reason: 'ory_account_deleted'
    });
  }
}
```

---

# 3. Account Deletion

## Two Types

| Type | Initiated By | Grace Period | Data Outcome |
|------|--------------|--------------|--------------|
| **Tenant Deletion** | Owner | 30 days | All data deleted |
| **Platform Ban** | Platform Admin | Immediate | Data preserved for legal |

## Tenant Self-Deletion Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      TENANT DELETION FLOW                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Owner requests ──► Password confirm ──► Schedule deletion (30 days)       │
│                                                    │                         │
│                                                    ▼                         │
│                                          [Immediate Actions]                 │
│                                          • Cancel Stripe subscription        │
│                                          • Send confirmation email           │
│                                          • Mark tenant as "pending_deletion" │
│                                          • Notify all team members           │
│                                                    │                         │
│                                                    ▼                         │
│                         ┌──────────────────────────┴──────────────────────┐  │
│                         │              30-Day Grace Period                │  │
│                         │  • Owner can cancel deletion anytime            │  │
│                         │  • Account remains accessible (read-only)       │  │
│                         │  • Campaigns paused                             │  │
│                         │  • Reminder emails at Day 7, 21, 29             │  │
│                         └──────────────────────────┬──────────────────────┘  │
│                                                    │                         │
│                                                    ▼                         │
│                                          [Day 30: Execute Deletion]          │
│                                          • Delete all tenant data            │
│                                          • Across ALL services               │
│                                          • Final confirmation email          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Database Schema

```sql
ALTER TABLE tenant ADD COLUMN deletion_scheduled_at TIMESTAMPTZ;
ALTER TABLE tenant ADD COLUMN deletion_requested_by UUID;
ALTER TABLE tenant ADD COLUMN deletion_reason TEXT;
ALTER TABLE tenant ADD COLUMN deleted_at TIMESTAMPTZ;
```

## Implementation

### Schedule Deletion

```typescript
@Post('/tenants/:id/delete')
@Roles(Role.Owner)
async scheduleDeletion(
  @Param('id') tenantId: string,
  @Body() dto: DeleteTenantDto,
  @CurrentUser() user: User
) {
  // Verify password via Ory
  const passwordValid = await this.oryService.verifyPassword(
    user.oryIdentityId, 
    dto.password
  );
  if (!passwordValid) {
    throw new UnauthorizedException('Invalid password');
  }
  
  const tenant = await this.tenantRepo.findOne(tenantId);
  
  // Schedule deletion 30 days from now
  const deletionDate = addDays(new Date(), 30);
  
  await this.tenantRepo.update(tenantId, {
    status: 'pending_deletion',
    deletion_scheduled_at: deletionDate,
    deletion_requested_by: user.id,
    deletion_reason: dto.reason
  });
  
  // Cancel Stripe subscription immediately
  await this.stripeService.cancelSubscription(tenant.stripeSubscriptionId, {
    prorate: true
  });
  
  // Pause all campaigns
  await this.campaignService.pauseAllForTenant(tenantId);
  
  // Notify all team members
  const members = await this.memberRepo.find({ where: { tenantId } });
  for (const member of members) {
    await this.integrationService.sendEmail({
      to: member.email,
      template: 'tenant_deletion_scheduled',
      data: {
        tenantName: tenant.name,
        deletionDate,
        cancelUrl: `${APP_URL}/settings/cancel-deletion`
      }
    });
  }
  
  // Schedule deletion job
  await this.deletionQueue.add('execute-deletion', {
    tenantId,
    executeAt: deletionDate
  }, {
    delay: 30 * 24 * 60 * 60 * 1000 // 30 days in ms
  });
  
  // Audit log
  await this.auditLog.log({
    tenantId,
    userId: user.id,
    action: 'tenant.deletion_scheduled',
    details: { reason: dto.reason, scheduledFor: deletionDate }
  });
  
  return { 
    deletionScheduledAt: deletionDate,
    message: 'Account deletion scheduled. You can cancel anytime before the deletion date.'
  };
}
```

### Cancel Deletion

```typescript
@Post('/tenants/:id/cancel-deletion')
@Roles(Role.Owner)
async cancelDeletion(
  @Param('id') tenantId: string,
  @CurrentUser() user: User
) {
  const tenant = await this.tenantRepo.findOne(tenantId);
  
  if (tenant.status !== 'pending_deletion') {
    throw new BadRequestException('No pending deletion to cancel');
  }
  
  // Remove scheduled job
  await this.deletionQueue.removeJobs(tenantId);
  
  // Restore tenant
  await this.tenantRepo.update(tenantId, {
    status: 'active', // or previous status
    deletion_scheduled_at: null,
    deletion_requested_by: null,
    deletion_reason: null
  });
  
  // Note: Subscription already cancelled - user needs to resubscribe
  
  // Notify owner
  await this.integrationService.sendEmail({
    to: user.email,
    template: 'tenant_deletion_cancelled',
    data: { tenantName: tenant.name }
  });
  
  return { message: 'Deletion cancelled. Please resubscribe to continue.' };
}
```

### Execute Deletion (Bull Job)

```typescript
@Processor('deletion')
export class DeletionProcessor {
  
  @Process('execute-deletion')
  async executeDeletion(job: Job<{ tenantId: string }>) {
    const { tenantId } = job.data;
    
    const tenant = await this.tenantRepo.findOne(tenantId);
    
    // Verify still pending (owner might have cancelled)
    if (tenant.status !== 'pending_deletion') {
      return { skipped: true, reason: 'Deletion was cancelled' };
    }
    
    // Verify grace period passed
    if (tenant.deletion_scheduled_at > new Date()) {
      throw new Error('Grace period not yet passed');
    }
    
    // ==========================================
    // DELETE DATA FROM ALL SERVICES
    // ==========================================
    
    // 1. Campaign Service
    await this.campaignService.deleteAllForTenant(tenantId);
    // Deletes: campaigns, widget_configs, landing_pages, email_templates, reward_rules
    
    // 2. Referral Service
    await this.referralService.deleteAllForTenant(tenantId);
    // Deletes: referrers, referral_links, referrals
    
    // 3. Reward Service
    await this.rewardService.deleteAllForTenant(tenantId);
    // Deletes: rewards, reward_balances, balance_transactions, payouts, payout_methods
    
    // 4. Tracker Service
    await this.trackerService.deleteAllForTenant(tenantId);
    // Deletes: click_events, signup_events, conversion_events, tracker_sessions
    
    // 5. Analytics Service (ClickHouse)
    await this.analyticsService.deleteAllForTenant(tenantId);
    // Deletes: events (ClickHouse), scheduled_reports
    
    // 6. AI Service
    await this.aiService.deleteAllForTenant(tenantId);
    // Deletes: conversations, generations, insights
    
    // 7. Integration Service
    await this.integrationService.deleteAllForTenant(tenantId);
    // Deletes: integrations, webhook_endpoints, webhook_deliveries, email_sends
    
    // 8. Media (S3)
    await this.mediaService.deleteAllForTenant(tenantId);
    // Deletes: S3 objects (logos, QR codes, exports)
    
    // 9. Tenant Service - Last
    // Deletes: team_members, api_keys, audit_logs (archive first), tenant
    
    // Archive audit logs to S3 before deletion (legal requirement)
    await this.archiveAuditLogs(tenantId);
    
    // Delete team members
    await this.memberRepo.delete({ tenantId });
    
    // Delete API keys
    await this.apiKeyRepo.delete({ tenantId });
    
    // Delete audit logs (already archived)
    await this.auditLogRepo.delete({ tenantId });
    
    // Finally, delete tenant
    await this.tenantRepo.update(tenantId, {
      status: 'deleted',
      deleted_at: new Date(),
      // Anonymize
      name: `Deleted Tenant ${tenantId.slice(0, 8)}`,
      slug: `deleted-${tenantId}`,
      stripe_customer_id: null
    });
    
    // Send final confirmation
    // Note: We saved owner email before deletion
    await this.integrationService.sendEmail({
      to: job.data.ownerEmail,
      template: 'tenant_deleted_confirmation',
      data: { tenantName: tenant.name }
    });
    
    return { success: true, deletedAt: new Date() };
  }
}
```

## Service Deletion Responsibilities

| Service | Data to Delete |
|---------|----------------|
| **Tenant** | tenant, team_members, api_keys, audit_logs |
| **Campaign** | campaigns, widget_configs, landing_pages, email_templates, reward_rules, campaign_templates |
| **Referral** | referrers, referral_links, referrals, fraud_rules |
| **Reward** | rewards, reward_balances, balance_transactions, payouts, payout_methods, payout_schedules |
| **Tracker** | click_events, signup_events, conversion_events, tracker_sessions |
| **Analytics** | ClickHouse events, scheduled_reports, (insights via AI Service) |
| **AI** | conversations, generations, insights |
| **Integration** | integrations, webhook_endpoints, webhook_deliveries, email_sends, notification_preferences |
| **S3** | All objects with prefix `tenants/{tenantId}/` |

---

# 4. GDPR Compliance

## Your GDPR Checklist - What You Must Do

### Phase 1: Before Launch (Required)

| # | Task | Description | Status |
|---|------|-------------|--------|
| 1 | **Create Privacy Policy** | Document what data you collect, why, how long you keep it, who you share with | ☐ |
| 2 | **Create Terms of Service** | Legal agreement for using your platform | ☐ |
| 3 | **Create DPA Template** | Data Processing Agreement for B2B customers (they will ask) | ☐ |
| 4 | **Create Cookie Policy** | Explain cookies used by SDK and dashboard | ☐ |
| 5 | **List Sub-processors** | Document all third parties that process data (AWS, Stripe, etc.) | ☐ |
| 6 | **Set up EU hosting** | Host data in EU region (AWS Frankfurt) | ☐ |
| 7 | **Enable encryption** | Encrypt databases at rest, use HTTPS everywhere | ☐ |
| 8 | **Implement data export** | Feature for users to download their data | ☐ |
| 9 | **Implement account deletion** | Feature for users to delete account (30-day grace) | ☐ |
| 10 | **Add cookie consent** | SDK must get consent before setting tracking cookies | ☐ |

### Phase 2: Ongoing Operations (Required)

| # | Task | Frequency | Description |
|---|------|-----------|-------------|
| 1 | **Respond to data requests** | As received | Users can request access, deletion, correction |
| 2 | **Update sub-processor list** | When changed | Notify customers 30 days before adding new sub-processor |
| 3 | **Security audits** | Quarterly | Review access controls, check for vulnerabilities |
| 4 | **Data retention cleanup** | Daily (automated) | Delete data past retention period |
| 5 | **Review DPA requests** | As received | Enterprise customers will send their DPA to sign |
| 6 | **Breach monitoring** | Continuous | Monitor for security incidents |

### Phase 3: If Data Breach Occurs

| Step | Timeframe | Action |
|------|-----------|--------|
| 1 | Immediately | Contain the breach, stop ongoing access |
| 2 | Within 24h | Assess impact - what data, how many users affected |
| 3 | Within 72h | Notify supervisory authority (if high risk) |
| 4 | ASAP | Notify affected users (if high risk to their rights) |
| 5 | After | Document incident, implement fixes, update procedures |

---

## Legal Documents You Need

### 1. Privacy Policy (publish on website)

Must include:
- Your company name and contact (Data Controller)
- What personal data you collect
- Why you collect it (legal basis)
- How long you keep it
- Who you share it with (sub-processors)
- User rights (access, delete, correct, port)
- How to contact you for data requests
- Cookie usage
- International transfers (if any)

### 2. Terms of Service (publish on website)

Must include:
- Service description
- User obligations
- Payment terms
- Termination conditions
- Limitation of liability
- Governing law (likely Germany for DACH focus)

### 3. Data Processing Agreement (DPA) - provide on request

Must include:
- Subject matter and duration
- Nature and purpose of processing
- Types of personal data
- Categories of data subjects
- Your obligations as processor
- Sub-processor list and approval process
- Security measures
- Audit rights
- Data deletion upon termination
- Breach notification (72h)

### 4. Cookie Policy (publish on website)

Must include:
- What cookies you use
- Purpose of each cookie
- Duration (session vs persistent)
- How to opt-out

### 5. Sub-processor List (publish on website or provide on request)

| Sub-processor | Purpose | Location | DPA Status |
|---------------|---------|----------|------------|
| AWS (Amazon) | Cloud infrastructure, databases | EU (Frankfurt) | Signed |
| Ory | Authentication | EU | Signed |
| Stripe | Payment processing | US (EU data stays in EU) | Signed |
| PayPal | Payout processing | US | Signed |
| Wise | Payout processing | EU | Signed |
| SendGrid/AWS SES | Email delivery | US/EU | Signed |
| OpenAI | AI features | US | Signed |
| Anthropic | AI features | US | Signed |
| Cloudflare | CDN, security | Global | Signed |

---

## Data You Collect - Document This

### Tenant Admin Data (your customers)

| Data | Purpose | Legal Basis | Retention |
|------|---------|-------------|-----------|
| Email | Account, communication | Contract | Account lifetime + 30 days |
| Name | Display, communication | Contract | Account lifetime + 30 days |
| Company name | Billing, identification | Contract | Account lifetime + 7 years (tax) |
| IP address | Security, audit | Legitimate interest | 90 days |
| Payment info | Billing | Contract | Handled by Stripe |

### Referrer Data (your customers' advocates)

| Data | Purpose | Legal Basis | Retention |
|------|---------|-------------|-----------|
| Email | Identification, payouts | Legitimate interest | Account lifetime + 7 years (tax) |
| Name | Display | Legitimate interest | Account lifetime |
| Payout details | Send rewards | Contract (with tenant) | 7 years (tax requirement) |

### Visitor/Click Data (anonymous until signup)

| Data | Purpose | Legal Basis | Retention |
|------|---------|-------------|-----------|
| IP hash | Fraud prevention | Legitimate interest | 90 days |
| Country/City | Analytics | Legitimate interest | 2 years |
| Device type | Analytics | Legitimate interest | 2 years |
| Click timestamp | Attribution | Legitimate interest | 2 years |

---

## Data Retention Schedule

| Data Type | Hot Storage | Archive | Delete |
|-----------|-------------|---------|--------|
| Click events | 90 days (PostgreSQL) | 2 years (S3 Parquet) | After 2 years |
| Audit logs | 90 days (PostgreSQL) | 7 years (S3 Parquet) | After 7 years |
| Referrer data | Lifetime | - | 7 years after account deletion (tax) |
| Payout records | Lifetime | - | 7 years after last payout (tax) |
| Team member data | Lifetime | - | 30 days after removal |
| AI conversations | 30 days | - | After 30 days |
| Tracker sessions | 90 days | - | After 90 days |

---

## User Rights - How to Handle Requests

### Right to Access ("Give me my data")

| Step | Action |
|------|--------|
| 1 | Verify requester identity (email confirmation) |
| 2 | Trigger data export |
| 3 | Provide download link within 30 days (aim for 48h) |
| 4 | Log the request |

### Right to Deletion ("Delete my data")

| Step | Action |
|------|--------|
| 1 | Verify requester identity |
| 2 | Check for legal holds (pending payouts, tax records) |
| 3 | If tenant owner: 30-day grace period |
| 4 | If referrer: immediate anonymization (keep records for tax) |
| 5 | Confirm deletion via email |
| 6 | Log the request |

### Right to Rectification ("Fix my data")

| Step | Action |
|------|--------|
| 1 | Verify requester identity |
| 2 | User can self-service via profile settings |
| 3 | Or support manually updates |
| 4 | Confirm change via email |

### Right to Portability ("Let me take my data elsewhere")

| Step | Action |
|------|--------|
| 1 | Same as Right to Access |
| 2 | Provide data in machine-readable format (JSON/CSV) |

---

## SDK Cookie Consent Flow

| Step | What Happens |
|------|--------------|
| 1 | SDK loads on customer's website |
| 2 | SDK checks for existing consent |
| 3 | If no consent, show consent banner (if customer enabled it) |
| 4 | User clicks "Accept" or "Decline" |
| 5 | If Accept: Set tracking cookie, enable attribution |
| 6 | If Decline: No cookie, limited tracking (session only) |
| 7 | Store consent preference |

**Important:** Customer (tenant) is Data Controller. You are Data Processor. Customer is responsible for getting consent on their site. Your SDK provides the tools.

---

## Recommended: Hire a Lawyer

Before launch, have a German/EU lawyer review:
- Privacy Policy
- Terms of Service  
- DPA Template
- Cookie Policy

Cost: €1,000-3,000 one-time

**Why Germany?** Your primary market is DACH, German data protection authorities are strict, and German law will likely govern disputes.

---

# 5. SDK & Tracker Behavior by Account State

## How SDK/Widget Responds

| Account State | Widget Display | Tracking | Landing Pages |
|---------------|----------------|----------|---------------|
| **Active** | Normal | ✅ Works | ✅ Works |
| **Past Due** | Normal | ✅ Works | ✅ Works |
| **Restricted** | Normal | ✅ Works | ✅ Works |
| **Locked** | Hidden or fallback message | ❌ Returns 402 | ❌ Shows "Program paused" |
| **Suspended** | Hidden or fallback message | ❌ Returns 403 | ❌ Shows "Program unavailable" |
| **Pending Deletion** | Hidden | ❌ Returns 410 | ❌ Shows "Program ended" |
| **Deleted** | Hidden (config not found) | ❌ Returns 404 | ❌ 404 Not Found |

## Tracker Service Behavior

| Endpoint | Active/Past Due/Restricted | Locked | Suspended | Deleted |
|----------|---------------------------|--------|-----------|---------|
| `GET /t/c/:shortCode` (click redirect) | ✅ Track + redirect | ❌ 402 + redirect to destination (no tracking) | ❌ 403 + redirect | ❌ 404 |
| `POST /t/click` | ✅ Track | ❌ 402 | ❌ 403 | ❌ 404 |
| `POST /t/signup` | ✅ Track | ❌ 402 | ❌ 403 | ❌ 404 |
| `POST /t/conversion` | ✅ Track | ❌ 402 | ❌ 403 | ❌ 404 |
| `GET /sdk/config/:campaignId` | ✅ Return config | ⚠️ Return `{ status: 'paused' }` | ⚠️ Return `{ status: 'unavailable' }` | ❌ 404 |

## Widget SDK Behavior

| Account State | SDK Action |
|---------------|------------|
| **Active** | Show widget normally |
| **Past Due** | Show widget normally (customer shouldn't see impact) |
| **Restricted** | Show widget normally (customer shouldn't see impact) |
| **Locked** | Hide widget OR show fallback: "Referral program is temporarily paused" |
| **Suspended** | Hide widget completely |
| **Pending Deletion** | Hide widget completely |
| **Deleted** | SDK fails silently (config 404), no widget shown |

## Landing Page Behavior

| Account State | Landing Page Response |
|---------------|----------------------|
| **Active** | Normal page |
| **Locked** | "This referral program is currently paused. Please check back later." |
| **Suspended** | "This referral program is not available." |
| **Deleted** | 404 page or redirect to main site |

## Why Keep Tracking During Restricted?

**Critical:** During Past Due and Restricted states, tracking continues because:

1. **Don't break customer's product** - Their users are clicking referral links
2. **Preserve attribution** - If they pay, they don't lose referral data
3. **Avoid support burden** - Customer complaints about "broken referrals"
4. **Goodwill** - Shows we're not hostile during payment issues

Only when **Locked** (21+ days unpaid) do we stop tracking.

## CDN Cache Invalidation

When account state changes to Locked/Suspended/Deleted:

| Action | Cache Behavior |
|--------|----------------|
| Widget config | Invalidate CDN cache immediately |
| Landing pages | Invalidate CDN cache immediately |
| SDK bundle | No change (generic) |

---

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ACCOUNT STATE MACHINE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                              ┌─────────┐                                    │
│                              │ ACTIVE  │◄─────── Payment Success            │
│                              └────┬────┘                                    │
│                                   │                                         │
│              ┌────────────────────┼────────────────────┐                    │
│              │                    │                    │                    │
│              ▼                    ▼                    ▼                    │
│        ┌──────────┐        ┌───────────┐       ┌─────────────┐             │
│        │ PAST_DUE │───────►│RESTRICTED │──────►│   LOCKED    │             │
│        │ (0-7d)   │        │  (7-21d)  │       │   (21d+)    │             │
│        └──────────┘        └───────────┘       └─────────────┘             │
│              │                    │                    │                    │
│              └────────────────────┴────────────────────┘                    │
│                                   │                                         │
│                          Payment Success                                    │
│                                   │                                         │
│                                   ▼                                         │
│                              ┌─────────┐                                    │
│                              │ ACTIVE  │                                    │
│                              └─────────┘                                    │
│                                                                              │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                              │
│        ┌───────────┐                          ┌─────────────────┐           │
│        │ SUSPENDED │  (Admin action)          │PENDING_DELETION │           │
│        └───────────┘                          │    (30 days)    │           │
│              │                                └────────┬────────┘           │
│              │                                         │                    │
│         Unsuspend                              Cancel / Execute              │
│              │                                         │                    │
│              ▼                                         ▼                    │
│        ┌───────────┐                          ┌─────────────────┐           │
│        │  ACTIVE   │                          │ ACTIVE/DELETED  │           │
│        └───────────┘                          └─────────────────┘           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

**Document Version:** 1.0  
**Created:** December 2024  
**Last Updated:** December 2024
