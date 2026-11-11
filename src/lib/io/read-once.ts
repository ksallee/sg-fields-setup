/**
 * A read asked once a session and shared: the project list (VIS-3), the trash page address
 * (RUN-21). Callers that ask while it runs wait on the same read. An answer that `failed` judges
 * a failure is forgotten, so the next ask reads again. The schema cache (`./schema`) keeps its
 * own rule: it holds one read per type and keeps a 404.
 */
import type { ProjectsRead } from '$lib/pure/visibility-scope';

export function readOnce<T>(read: () => Promise<T>, failed: (answer: T) => boolean): () => Promise<T> {
	let held: Promise<T> | null = null;
	return async () => {
		const mine = (held ??= read());
		const answer = await mine;
		// A newer read may have taken this one's place: leave that one alone.
		if (failed(answer) && held === mine) held = null;
		return answer;
	};
}

/** The project list, read once, and again after a read that failed (VIS-3). */
export function onceLoaded(read: () => Promise<ProjectsRead>): () => Promise<ProjectsRead> {
	return readOnce(read, (answer) => answer.status === 'failed');
}
