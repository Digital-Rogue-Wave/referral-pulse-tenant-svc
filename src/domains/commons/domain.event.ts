export namespace CampaignEvents {
    export interface Created {
        campaignId: string;
        name: string;
        type: string;
        createdBy: string;
    }

    export interface Updated {
        campaignId: string;
        changes: Record<string, unknown>;
    }

    export interface InvitationSent {
        campaignId: string;
        invitationId: string;
        recipientEmail: string;
    }

    export interface Activated {
        campaignId: string;
        activatedAt: string;
    }
}

export namespace RewardEvents {
    export interface Granted {
        rewardId: string;
        userId: string;
        amount: number;
        reason: string;
    }

    export interface Redeemed {
        rewardId: string;
        userId: string;
        redeemedAt: string;
    }
}

export namespace AnalyticsEvents {
    export interface MetricRecorded {
        metricName: string;
        value: number;
        dimensions: Record<string, string>;
    }

    export interface ReportGenerated {
        reportId: string;
        reportType: string;
        generatedAt: string;
    }
}

