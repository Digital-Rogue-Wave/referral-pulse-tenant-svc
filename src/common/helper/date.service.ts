import { Injectable } from '@nestjs/common';
import moment from 'moment-timezone';

/**
 * DateService - Centralized date/time handling using moment-timezone
 * Provides consistent date operations across the application
 */
@Injectable()
export class DateService {
    private readonly defaultTimezone = 'UTC';

    /**
     * Get current timestamp in milliseconds
     */
    now(): number {
        return moment().valueOf();
    }

    /**
     * Get current date as moment object
     */
    nowMoment(timezone?: string): moment.Moment {
        return timezone ? moment().tz(timezone) : moment.utc();
    }

    /**
     * Get current date as ISO string
     */
    nowISO(timezone?: string): string {
        return this.nowMoment(timezone).toISOString();
    }

    /**
     * Parse date string or timestamp to moment
     */
    parse(date: string | number | Date, timezone?: string): moment.Moment {
        if (timezone) {
            return moment.tz(date, timezone);
        }
        return moment.utc(date);
    }

    /**
     * Format date to ISO string
     */
    toISO(date: string | number | Date | moment.Moment, timezone?: string): string {
        if (moment.isMoment(date)) {
            return timezone ? date.tz(timezone).toISOString() : date.toISOString();
        }
        return this.parse(date, timezone).toISOString();
    }

    /**
     * Format date with custom format
     */
    format(date: string | number | Date | moment.Moment, format: string, timezone?: string): string {
        if (moment.isMoment(date)) {
            return timezone ? date.tz(timezone).format(format) : date.format(format);
        }
        return this.parse(date, timezone).format(format);
    }

    /**
     * Add duration to date
     */
    add(date: string | number | Date | moment.Moment, amount: number, unit: moment.unitOfTime.DurationConstructor): moment.Moment {
        if (moment.isMoment(date)) {
            return date.clone().add(amount, unit);
        }
        return this.parse(date).add(amount, unit);
    }

    /**
     * Subtract duration from date
     */
    subtract(date: string | number | Date | moment.Moment, amount: number, unit: moment.unitOfTime.DurationConstructor): moment.Moment {
        if (moment.isMoment(date)) {
            return date.clone().subtract(amount, unit);
        }
        return this.parse(date).subtract(amount, unit);
    }

    /**
     * Check if date is before another date
     */
    isBefore(date1: string | number | Date | moment.Moment, date2: string | number | Date | moment.Moment): boolean {
        const m1 = moment.isMoment(date1) ? date1 : this.parse(date1);
        const m2 = moment.isMoment(date2) ? date2 : this.parse(date2);
        return m1.isBefore(m2);
    }

    /**
     * Check if date is after another date
     */
    isAfter(date1: string | number | Date | moment.Moment, date2: string | number | Date | moment.Moment): boolean {
        const m1 = moment.isMoment(date1) ? date1 : this.parse(date1);
        const m2 = moment.isMoment(date2) ? date2 : this.parse(date2);
        return m1.isAfter(m2);
    }

    /**
     * Get difference between two dates
     */
    diff(date1: string | number | Date | moment.Moment, date2: string | number | Date | moment.Moment, unit?: moment.unitOfTime.Diff): number {
        const m1 = moment.isMoment(date1) ? date1 : this.parse(date1);
        const m2 = moment.isMoment(date2) ? date2 : this.parse(date2);
        return m1.diff(m2, unit);
    }

    /**
     * Get start of day/week/month/year
     */
    startOf(date: string | number | Date | moment.Moment, unit: moment.unitOfTime.StartOf, timezone?: string): moment.Moment {
        if (moment.isMoment(date)) {
            return timezone ? date.clone().tz(timezone).startOf(unit) : date.clone().startOf(unit);
        }
        return this.parse(date, timezone).startOf(unit);
    }

    /**
     * Get end of day/week/month/year
     */
    endOf(date: string | number | Date | moment.Moment, unit: moment.unitOfTime.StartOf, timezone?: string): moment.Moment {
        if (moment.isMoment(date)) {
            return timezone ? date.clone().tz(timezone).endOf(unit) : date.clone().endOf(unit);
        }
        return this.parse(date, timezone).endOf(unit);
    }

    /**
     * Check if date is valid
     */
    isValid(date: string | number | Date | moment.Moment): boolean {
        if (moment.isMoment(date)) {
            return date.isValid();
        }
        return moment(date).isValid();
    }

    /**
     * Get timestamp from date
     */
    toTimestamp(date: string | number | Date | moment.Moment): number {
        if (moment.isMoment(date)) {
            return date.valueOf();
        }
        return this.parse(date).valueOf();
    }

    /**
     * Get Unix timestamp (seconds since epoch)
     */
    toUnix(date: string | number | Date | moment.Moment): number {
        if (moment.isMoment(date)) {
            return date.unix();
        }
        return this.parse(date).unix();
    }

    /**
     * Create moment from Unix timestamp
     */
    fromUnix(timestamp: number, timezone?: string): moment.Moment {
        return timezone ? moment.unix(timestamp).tz(timezone) : moment.unix(timestamp).utc();
    }

    /**
     * Get moment instance for direct manipulation
     */
    moment(date?: string | number | Date, timezone?: string): moment.Moment {
        if (date === undefined) {
            return timezone ? moment().tz(timezone) : moment.utc();
        }
        return timezone ? moment.tz(date, timezone) : moment.utc(date);
    }
}
