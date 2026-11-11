/**
 * Runs one task per item, a few at a time (VIS-8). Generic: it knows nothing of what a task does.
 *
 * - At most `cap` tasks run at once. A cap below one counts as one.
 * - The answer is in the order of the items, whatever order the tasks finish in.
 * - It never rejects. A task that throws or rejects is `{ ok: false, error }` in its place, and
 *   the other tasks still run.
 * - `onSettled` hears each result as it lands, in the order of landing. A listener that throws
 *   is ignored.
 */

export type Settled<R> = { ok: true; value: R } | { ok: false; error: unknown };

export async function runCapped<T, R>(
	items: readonly T[],
	cap: number,
	task: (item: T, index: number) => Promise<R> | R,
	onSettled?: (index: number, result: Settled<R>) => void
): Promise<Settled<R>[]> {
	const results = new Array<Settled<R>>(items.length);
	let next = 0;

	async function worker(): Promise<void> {
		while (next < items.length) {
			const index = next++;
			let result: Settled<R>;
			try {
				result = { ok: true, value: await task(items[index] as T, index) };
			} catch (error) {
				result = { ok: false, error };
			}
			results[index] = result;
			try {
				onSettled?.(index, result);
			} catch {
				/* A listener's failure is its own. */
			}
		}
	}

	const workers = Math.min(Math.max(1, Math.floor(cap) || 1), items.length);
	await Promise.all(Array.from({ length: workers }, () => worker()));
	return results;
}
