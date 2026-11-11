import { describe, expect, it } from 'vitest';
import { makeLiveField } from './fixtures/make-live-field';
import { createMatcher, indexLiveFields, matchLiveField } from './import-match';

const lensHeight = makeLiveField('Shot', 'sg_tk_lens_height_start', { displayName: 'Tk Lens Height (Start)' });
const fps = makeLiveField('Shot', 'sg_fps', { displayName: 'Frame Rate' });
const code = makeLiveField('Shot', 'code', { displayName: 'Shot Code' });
const description = makeLiveField('Shot', 'description', { displayName: 'Description' });

describe('matchLiveField (IMP-27, IMP-28)', () => {
	const index = indexLiveFields([lensHeight, fps, code, description]);

	it('IMP-27: matches a display name after normalising both sides', () => {
		expect(matchLiveField(index, 'tk_lens_height_start')).toBe(lensHeight);
		expect(matchLiveField(index, '  TK LENS HEIGHT  start ')).toBe(lensHeight);
		expect(matchLiveField(index, 'frame-rate')).toBe(fps);
	});

	it('IMP-28: falls back to programmatic names when no display name matches', () => {
		expect(matchLiveField(index, 'sg_fps')).toBe(fps);
		expect(matchLiveField(index, 'SG FPS')).toBe(fps);
		expect(matchLiveField(index, 'code')).toBe(code);
	});

	it('IMP-28: a display name match beats a programmatic name match on another field', () => {
		const byName = makeLiveField('Shot', 'frame_rate', { displayName: 'Legacy FR' });
		const byDisplay = makeLiveField('Shot', 'sg_frame_rate_2', { displayName: 'Frame Rate' });
		const both = indexLiveFields([byName, byDisplay]);
		expect(matchLiveField(both, 'Frame Rate')).toBe(byDisplay);
	});

	it('IMP-28: exact equality only, no fuzzy matching', () => {
		expect(matchLiveField(index, 'Frame Rat')).toBeNull();
		expect(matchLiveField(index, 'Frame Rates')).toBeNull();
		expect(matchLiveField(index, 'sg fps 2')).toBeNull();
	});

	it('IMP-28: a blank name, or one with nothing alphanumeric, matches nothing', () => {
		const blank = makeLiveField('Shot', 'sg_blank', { displayName: '   ' });
		const withBlank = indexLiveFields([blank]);
		expect(matchLiveField(withBlank, '')).toBeNull();
		expect(matchLiveField(withBlank, '   ')).toBeNull();
		expect(matchLiveField(index, '()')).toBeNull();
	});

	it('several fields sharing a normalised display name: the first in listing order wins', () => {
		const first = makeLiveField('Shot', 'sg_notes_a', { displayName: 'Notes' });
		const second = makeLiveField('Shot', 'sg_notes_b', { displayName: 'notes ' });
		expect(matchLiveField(indexLiveFields([first, second]), 'NOTES')).toBe(first);
		expect(matchLiveField(indexLiveFields([second, first]), 'NOTES')).toBe(second);
	});

	it('no fields matches nothing', () => {
		expect(matchLiveField(indexLiveFields([]), 'Frame Rate')).toBeNull();
	});
});

describe('createMatcher (IMP-28, IMP-29)', () => {
	const lensAperture = makeLiveField('CustomEntity19', 'sg_maximum_aperture', { displayName: 'Maximum Aperture' });
	const fieldsByType = new Map([
		['Shot', [lensHeight, fps]],
		['CustomEntity19', [lensAperture]]
	]);

	it('IMP-28: compares only with the live fields of the resolved type', () => {
		const match = createMatcher(fieldsByType);
		expect(match('Shot', 'Frame Rate')).toBe(fps);
		expect(match('CustomEntity19', 'Frame Rate')).toBeNull();
		expect(match('CustomEntity19', 'maximum aperture')).toBe(lensAperture);
	});

	it('a type with no listing, or an empty type, matches nothing', () => {
		const match = createMatcher(fieldsByType);
		expect(match('Asset', 'Frame Rate')).toBeNull();
		expect(match('', 'Frame Rate')).toBeNull();
	});

	it('builds each type index once, however many columns ask', () => {
		let reads = 0;
		const counting = new Map(fieldsByType);
		const original = counting.get.bind(counting);
		counting.get = (key: string) => {
			reads += 1;
			return original(key);
		};
		const match = createMatcher(counting);
		for (let i = 0; i < 5; i += 1) match('Shot', `column ${i}`);
		match('CustomEntity19', 'x');
		match('CustomEntity19', 'y');
		expect(reads).toBe(2);
	});
});
