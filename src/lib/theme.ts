/**
 * Light or dark. One theme in this app (sg-widgets' default, in `app.css`); only the scheme
 * switches, from the navbar. `system` follows the OS until the person picks one explicitly.
 *
 * The scheme lands as the `.dark` class on `<html>`, which is what the token sheet keys on.
 * `app.html` applies it before the first paint from the same storage key, so there is no flash.
 */
import { resolveDark, type Mode } from '$lib/pure/scheme';

export type { Mode };

export const MODES: ReadonlyArray<{ value: Mode; label: string }> = [
	{ value: 'light', label: 'Light' },
	{ value: 'dark', label: 'Dark' },
	{ value: 'system', label: 'System' }
];

export const KEYS = { mode: 'sg-fields-setup:mode' } as const;

function read(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		/* A remembered look is a convenience. */
	}
}

export function mode(): Mode {
	const value = read(KEYS.mode);
	return MODES.some((option) => option.value === value) ? (value as Mode) : 'system';
}

/** Whether the page is dark now, given the mode and the system. */
export function isDark(current: Mode = mode()): boolean {
	return resolveDark(current, matchMedia('(prefers-color-scheme: dark)').matches);
}

/** Put the scheme on the document. The same rule as the inline script in `app.html`. */
export function apply(next: Mode = mode()): void {
	const root = document.documentElement;
	root.classList.toggle('dark', isDark(next));
	root.style.colorScheme = isDark(next) ? 'dark' : 'light';
}

export function setMode(next: Mode): void {
	write(KEYS.mode, next);
	apply(next);
}
