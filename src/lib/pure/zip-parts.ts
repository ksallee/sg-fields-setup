/**
 * A zip's parts, read one at a time and only as far as asked.
 *
 * `fflate`'s `unzipSync` inflates a whole part into a buffer of the size the zip's header
 * declares, and a kilobyte of deflate can hold a megabyte. This reads the directory without
 * inflating anything, then inflates one part in slices, counting what really comes out, so a
 * caller can refuse on the declared size first and stop on the real one.
 *
 * Bytes in, bytes out. The inflate is fflate's.
 */
import { Inflate } from 'fflate';

export class ZipError extends Error {}

export interface ZipEntry {
	name: string;
	/** 0 is stored, 8 is deflate. Nothing else is read. */
	method: number;
	compressedSize: number;
	/** The inflated size the directory declares. A hostile file can lie. */
	size: number;
	/** Where the entry's local header starts. */
	offset: number;
}

const END_OF_DIRECTORY = 0x06054b50;
const ZIP64_END = 0x06064b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const UINT32_MAX = 0xffffffff;

/** Deflate gives at most 1032 bytes for one, so a slice this size inflates to 17 MB at most. */
const INPUT_SLICE = 16 * 1024;

function view(data: Uint8Array): DataView {
	return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function u64(v: DataView, at: number): number {
	return v.getUint32(at, true) + v.getUint32(at + 4, true) * 2 ** 32;
}

/** The zip's entries by name, in directory order. A name listed twice keeps its last entry. */
export function zipDirectory(data: Uint8Array): Map<string, ZipEntry> {
	try {
		return readDirectory(data);
	} catch (error) {
		if (error instanceof ZipError) throw error;
		// A read past the end of the bytes: the directory points outside the file.
		throw new ZipError('damaged zip directory');
	}
}

function readDirectory(data: Uint8Array): Map<string, ZipEntry> {
	const v = view(data);
	let end = data.length - 22;
	// The end record is the last thing in the file, before a comment of 65535 bytes at most.
	for (const lowest = Math.max(0, data.length - 22 - 0xffff); ; end--) {
		if (end < lowest) throw new ZipError('not a zip');
		if (v.getUint32(end, true) === END_OF_DIRECTORY) break;
	}
	let count = v.getUint16(end + 8, true);
	let at = v.getUint32(end + 16, true);
	let zip64 = false;
	if (at === UINT32_MAX || count === 0xffff) {
		const record = v.getUint32(end - 12, true);
		zip64 = v.getUint32(record, true) === ZIP64_END;
		if (zip64) {
			count = u64(v, record + 32);
			at = u64(v, record + 48);
		}
	}

	const names = new TextDecoder();
	const entries = new Map<string, ZipEntry>();
	for (let i = 0; i < count; i++) {
		if (v.getUint32(at, true) !== DIRECTORY_ENTRY) throw new ZipError('damaged zip directory');
		const nameLength = v.getUint16(at + 28, true);
		const extraLength = v.getUint16(at + 30, true);
		const commentLength = v.getUint16(at + 32, true);
		const name = names.decode(data.subarray(at + 46, at + 46 + nameLength));
		let compressedSize = v.getUint32(at + 20, true);
		let size = v.getUint32(at + 24, true);
		let offset = v.getUint32(at + 42, true);
		if (zip64 && compressedSize === UINT32_MAX) {
			// The zip64 extra field carries the three as 64-bit numbers.
			let extra = at + 46 + nameLength;
			const extraEnd = extra + extraLength;
			while (v.getUint16(extra, true) !== 1) {
				extra += 4 + v.getUint16(extra + 2, true);
				if (extra >= extraEnd) throw new ZipError('damaged zip directory');
			}
			size = u64(v, extra + 4);
			compressedSize = u64(v, extra + 12);
			offset = u64(v, extra + 20);
		}
		entries.set(name, { name, method: v.getUint16(at + 10, true), compressedSize, size, offset });
		at += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

/**
 * One part, inflated as far as asked. `onBytes` hears of every chunk as it comes out, with the
 * part's running total, and may throw to stop the read.
 */
export class ZipPartReader {
	private readonly input: Uint8Array;
	private readonly inflate: Inflate | null = null;
	private chunks: Uint8Array[] = [];
	private consumed = 0;
	private total = 0;
	private ended = false;

	constructor(
		data: Uint8Array,
		private readonly entry: ZipEntry,
		private readonly onBytes: (added: number, total: number) => void = () => {}
	) {
		let start: number;
		try {
			const v = view(data);
			if (v.getUint32(entry.offset, true) !== LOCAL_HEADER) throw new ZipError(`damaged entry ${entry.name}`);
			start = entry.offset + 30 + v.getUint16(entry.offset + 26, true) + v.getUint16(entry.offset + 28, true);
		} catch {
			throw new ZipError(`damaged entry ${entry.name}`);
		}
		if (start + entry.compressedSize > data.length) throw new ZipError(`damaged entry ${entry.name}`);
		this.input = data.subarray(start, start + entry.compressedSize);
		if (entry.method === 8) {
			this.inflate = new Inflate((chunk) => this.take(chunk));
		} else if (entry.method !== 0) {
			throw new ZipError(`unknown compression ${entry.method}`);
		}
	}

	/** True once the whole part is out. */
	get done(): boolean {
		return this.ended;
	}

	/** Bytes out so far. */
	get size(): number {
		return this.total;
	}

	private take(chunk: Uint8Array): void {
		if (chunk.length === 0) return;
		this.chunks.push(chunk);
		this.total += chunk.length;
		// The directory's size is what a caller was told before reading. More than that is a lie.
		if (this.total > this.entry.size) throw new ZipError(`${this.entry.name} is larger than declared`);
		this.onBytes(chunk.length, this.total);
	}

	/** Inflate until at least `target` bytes are out, or the part ends. */
	fill(target: number): void {
		while (!this.ended && this.total < target) {
			if (this.inflate === null) {
				this.ended = true;
				this.take(this.input);
				return;
			}
			const next = Math.min(this.consumed + INPUT_SLICE, this.input.length);
			const last = next === this.input.length;
			const slice = this.input.subarray(this.consumed, next);
			this.consumed = next;
			if (last) this.ended = true;
			try {
				this.inflate.push(slice, last);
			} catch (error) {
				this.ended = true;
				throw error;
			}
		}
	}

	/** What is out so far, as one array. */
	bytes(): Uint8Array {
		if (this.chunks.length !== 1) {
			const joined = new Uint8Array(this.total);
			let at = 0;
			for (const chunk of this.chunks) {
				joined.set(chunk, at);
				at += chunk.length;
			}
			this.chunks = [joined];
		}
		return this.chunks[0];
	}
}
