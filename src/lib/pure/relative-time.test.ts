import { describe, expect, it } from 'vitest';
import { absoluteTime, relativeTime } from './relative-time';

const NOW = '2026-11-10T12:00:00.000Z';
const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('relativeTime (SET-3)', () => {
	it('under a minute is just now', () => {
		expect(relativeTime(ago(0), NOW)).toBe('just now');
		expect(relativeTime(ago(59_000), NOW)).toBe('just now');
	});

	it('a time ahead of the clock is just now', () => {
		expect(relativeTime(ago(-5 * MIN), NOW)).toBe('just now');
	});

	it('minutes, singular and plural', () => {
		expect(relativeTime(ago(MIN), NOW)).toBe('1 minute ago');
		expect(relativeTime(ago(59 * MIN), NOW)).toBe('59 minutes ago');
	});

	it('hours, singular and plural', () => {
		expect(relativeTime(ago(HOUR), NOW)).toBe('1 hour ago');
		expect(relativeTime(ago(23 * HOUR + 59 * MIN), NOW)).toBe('23 hours ago');
	});

	it('days, with yesterday for one', () => {
		expect(relativeTime(ago(DAY), NOW)).toBe('yesterday');
		expect(relativeTime(ago(2 * DAY), NOW)).toBe('2 days ago');
		expect(relativeTime(ago(29 * DAY), NOW)).toBe('29 days ago');
	});

	it('months, then years', () => {
		expect(relativeTime(ago(30 * DAY), NOW)).toBe('1 month ago');
		expect(relativeTime(ago(200 * DAY), NOW)).toBe('6 months ago');
		expect(relativeTime(ago(365 * DAY), NOW)).toBe('1 year ago');
		expect(relativeTime(ago(800 * DAY), NOW)).toBe('2 years ago');
	});

	it('a time that cannot be read is empty', () => {
		expect(relativeTime('not a time', NOW)).toBe('');
	});
});

describe('absoluteTime', () => {
	it('is the day and the minute, in UTC when asked', () => {
		expect(absoluteTime('2026-11-10T09:05:00.000Z', 0)).toBe('10 Nov 2026, 09:05');
	});

	it('follows the offset it is given, in minutes east of UTC', () => {
		expect(absoluteTime('2026-11-10T23:30:00.000Z', 60)).toBe('11 Nov 2026, 00:30');
	});

	it('a time that cannot be read is empty', () => {
		expect(absoluteTime('', 0)).toBe('');
	});
});
