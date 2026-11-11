import { describe, expect, it } from 'vitest';
import { runCapped, type Settled } from './run-capped';

/** A task whose end the test decides. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const tick = () => new Promise((done) => setTimeout(done, 0));

describe('runCapped', () => {
	it('VIS-8: never runs more than the cap at once', async () => {
		let running = 0;
		let most = 0;
		const results = await runCapped([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
			running += 1;
			most = Math.max(most, running);
			await tick();
			running -= 1;
			return item * 2;
		});
		expect(most).toBe(3);
		expect(results).toEqual([2, 4, 6, 8, 10, 12, 14].map((value) => ({ ok: true, value })));
	});

	it('answers in the order of the items, whatever order they finish in', async () => {
		const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
		const settled: number[] = [];
		const all = runCapped(
			gates,
			3,
			(gate) => gate.promise,
			(index) => settled.push(index)
		);
		gates[2]!.resolve('c');
		await tick();
		gates[0]!.resolve('a');
		await tick();
		gates[1]!.resolve('b');
		expect(await all).toEqual([
			{ ok: true, value: 'a' },
			{ ok: true, value: 'b' },
			{ ok: true, value: 'c' }
		]);
		expect(settled).toEqual([2, 0, 1]);
	});

	it('starts the next item as soon as one finishes', async () => {
		const gates = [deferred<number>(), deferred<number>(), deferred<number>()];
		const started: number[] = [];
		const all = runCapped(gates, 2, (gate, index) => {
			started.push(index);
			return gate.promise;
		});
		await tick();
		expect(started).toEqual([0, 1]);
		gates[1]!.resolve(1);
		await tick();
		expect(started).toEqual([0, 1, 2]);
		gates[0]!.resolve(0);
		gates[2]!.resolve(2);
		await all;
	});

	it('never rejects: a failed item is a value, and the others still run', async () => {
		const boom = new Error('boom');
		const seen: Settled<number>[] = [];
		const results = await runCapped(
			[1, 2, 3],
			1,
			(item) => {
				if (item === 2) throw boom;
				return Promise.resolve(item);
			},
			(_index, result) => seen.push(result)
		);
		expect(results).toEqual([
			{ ok: true, value: 1 },
			{ ok: false, error: boom },
			{ ok: true, value: 3 }
		]);
		expect(seen).toEqual(results);
	});

	it('survives a listener that throws', async () => {
		const results = await runCapped([1, 2], 2, async (item) => item, () => {
			throw new Error('listener');
		});
		expect(results).toHaveLength(2);
	});

	it('answers at once for no items, and treats a cap below one as one', async () => {
		expect(await runCapped([], 10, async () => 1)).toEqual([]);
		let running = 0;
		let most = 0;
		await runCapped([1, 2, 3], 0, async () => {
			running += 1;
			most = Math.max(most, running);
			await tick();
			running -= 1;
		});
		expect(most).toBe(1);
	});
});
