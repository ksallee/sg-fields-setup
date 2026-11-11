/**
 * A set file into the store (D1): decode it, then create the set with the file's origin and
 * entries. A name that is taken takes the next free copy name (`copyName`, as SET-20), so an
 * import never fails for its name. Throws only what the store throws (`SetStoreError`).
 */
import { copyName } from '$lib/pure/copy-name';
import { decodeSetFile, exceedsSetFileCap, refusalMessage as fileRefusalMessage, setFileTooLargeText } from '$lib/pure/set-file';
import { refusalMessage } from '$lib/pure/set-plan';
import type { ImportedSummary } from '$lib/pure/set-text';
import type { SetStore } from './set-store';

export type ImportSetFileResult =
	| ({ ok: true; id: string } & ImportedSummary)
	/** `message` is plain and ready to show. Nothing was stored. */
	| { ok: false; message: string };

export async function importSetFile(store: SetStore, text: string): Promise<ImportSetFileResult> {
	const decoded = decodeSetFile(text);
	if (!decoded.ok) return { ok: false, message: fileRefusalMessage(decoded.refusal) };
	const { name: askedName, description, origin, originDetails, entries, duplicatesDropped } = decoded.set;

	// Each refusal names one more taken name; `copyName` then gives the lowest name free of all
	// those seen. It ends: every round learns a name it did not know.
	const taken: string[] = [];
	let name = askedName;
	for (;;) {
		const result = await store.createSet({ name, description, origin, originDetails, entries });
		if (result.ok) {
			return { ok: true, id: result.set.id, name: result.set.name, askedName, entryCount: result.entries.length, duplicatesDropped };
		}
		if (result.reason !== 'name_taken') return { ok: false, message: refusalMessage(result) };
		taken.push(result.clashing.name);
		name = copyName(askedName, taken);
	}
}

/** The part of a `File` this reads. */
export type SetFileSource = Pick<File, 'name' | 'size' | 'text'>;

/** A picked file into the store. A file over the size cap is refused before a byte is read. */
export async function importSetFileFrom(store: SetStore, file: SetFileSource): Promise<ImportSetFileResult> {
	if (exceedsSetFileCap(file.size)) return { ok: false, message: setFileTooLargeText(file.name) };
	return importSetFile(store, await file.text());
}
