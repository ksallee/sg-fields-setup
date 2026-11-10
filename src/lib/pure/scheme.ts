/**
 * Whether the page is dark, from the picked mode and the system's scheme. The one rule
 * `$lib/theme` and the navbar both read, so the switch's icon follows the OS in `system` mode.
 */
export type Mode = 'light' | 'dark' | 'system';

export function resolveDark(mode: Mode, systemDark: boolean): boolean {
	return mode === 'dark' || (mode === 'system' && systemDark);
}
