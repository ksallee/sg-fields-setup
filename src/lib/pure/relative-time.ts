/**
 * Times as a person reads them: how long ago (SET-3), and the day and minute for a tooltip.
 * Pure: "now" and the time zone offset are arguments. English only, fixed wording, so the text
 * is the same in every browser.
 */
import type { Timestamp } from './model';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(count: number, unit: string): string {
	return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

/**
 * How long before `now` the time `then` was: "just now" under a minute, then minutes, hours,
 * "yesterday", days up to 29, months of 30 days, years of 365. A time ahead of `now` (a clock
 * that moved) is "just now". A time that cannot be read is ''.
 */
export function relativeTime(then: Timestamp, now: Timestamp): string {
	const elapsed = Date.parse(now) - Date.parse(then);
	if (Number.isNaN(elapsed)) return '';
	if (elapsed < MINUTE) return 'just now';
	if (elapsed < HOUR) return ago(Math.floor(elapsed / MINUTE), 'minute');
	if (elapsed < DAY) return ago(Math.floor(elapsed / HOUR), 'hour');
	const days = Math.floor(elapsed / DAY);
	if (days === 1) return 'yesterday';
	if (days < 30) return ago(days, 'day');
	if (days < 365) return ago(Math.floor(days / 30), 'month');
	return ago(Math.floor(days / 365), 'year');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const two = (n: number): string => String(n).padStart(2, '0');

/**
 * The day and the minute, as "10 Nov 2026, 09:05", on a clock `offsetMinutes` east of UTC (the
 * browser's is `-new Date(time).getTimezoneOffset()`). A time that cannot be read is ''.
 */
export function absoluteTime(time: Timestamp, offsetMinutes: number): string {
	const ms = Date.parse(time);
	if (Number.isNaN(ms)) return '';
	const local = new Date(ms + offsetMinutes * MINUTE);
	return `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()}, ${two(local.getUTCHours())}:${two(local.getUTCMinutes())}`;
}
