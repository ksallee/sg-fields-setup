import { describe, expect, it } from 'vitest';
import { onceLoaded, readOnce } from './read-once';

describe('readOnce', () => {
	it('shares one read between callers that ask at the same time', async () => {
		let reads = 0;
		const read = readOnce(async () => ++reads, () => false);
		expect(await Promise.all([read(), read()])).toEqual([1, 1]);
		expect(await read()).toBe(1);
	});

	it('reads again after an answer judged a failure', async () => {
		let reads = 0;
		const read = readOnce(async () => ++reads, (answer) => answer === 1);
		expect(await read()).toBe(1);
		expect(await read()).toBe(2);
		expect(await read()).toBe(2);
	});
});

describe('onceLoaded (VIS-3)', () => {
	it('reads the project list once, and again after a read that failed', async () => {
		let reads = 0;
		const answers = [{ status: 'failed' as const, message: 'No.' }, { status: 'loaded' as const, projects: [] }];
		const load = onceLoaded(async () => answers[Math.min(reads++, 1)]!);
		expect((await load()).status).toBe('failed');
		expect((await load()).status).toBe('loaded');
		expect((await load()).status).toBe('loaded');
		expect(reads).toBe(2);
	});
});
