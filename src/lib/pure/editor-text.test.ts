import { describe, expect, it } from 'vitest';
import {
	assignedText,
	dataTypeChangedText,
	duplicateLabel,
	editorStatus,
	installLabel,
	resyncedText,
	RESYNC_NONE_TEXT,
	savedText,
	editorTitle,
	notSavedText,
	selectGroupLabel,
	selectRowLabel,
	RESYNC_DROPPED_TEXT,
	selectionText,
	STATUS_TEXT
} from './editor-text';

describe('editorStatus (EDT-4, EDT-47)', () => {
	it('EDT-4: saving, then unsaved changes, then saved', () => {
		expect(editorStatus({ saving: true, failed: false, dirty: true })).toBe('saving');
		expect(editorStatus({ saving: false, failed: false, dirty: true })).toBe('dirty');
		expect(editorStatus({ saving: false, failed: false, dirty: false })).toBe('saved');
	});

	it('EDT-47: a failed save reads error until the next save starts', () => {
		expect(editorStatus({ saving: false, failed: true, dirty: true })).toBe('error');
		expect(editorStatus({ saving: true, failed: true, dirty: true })).toBe('saving');
	});

	it('EDT-4: every status has its words', () => {
		expect(STATUS_TEXT).toEqual({ saving: 'Saving…', error: 'Not saved', dirty: 'Unsaved changes', saved: 'Saved' });
	});
});

describe('button labels (EDT-9, EDT-10)', () => {
	it('EDT-9: Duplicate says how many fields when rows are selected', () => {
		expect(duplicateLabel(0)).toBe('Duplicate');
		expect(duplicateLabel(1)).toBe('Duplicate 1 field');
		expect(duplicateLabel(12)).toBe('Duplicate 12 fields');
	});

	it('EDT-10: Install says how many fields when rows are selected', () => {
		expect(installLabel(0)).toBe('Install');
		expect(installLabel(3)).toBe('Install 3 fields');
	});
});

describe('selectionText (EDT-41)', () => {
	it('EDT-41: the rows a bulk action would touch, and how many more are hidden', () => {
		expect(selectionText({ selected: 3, visible: 3, hidden: 0 })).toBe('3 selected');
		expect(selectionText({ selected: 5, visible: 3, hidden: 2 })).toBe('3 selected, 2 hidden');
	});
});

describe('bulk reports (EDT-41, EDT-42)', () => {
	it('EDT-41: assign names the type and counts the computed fields it skipped', () => {
		expect(assignedText(3, 'Shot', 0)).toBe('Assigned 3 fields to Shot.');
		expect(assignedText(1, 'Shot', 2)).toBe('Assigned 1 field to Shot. Skipped 2 computed fields.');
		expect(assignedText(0, 'Shot', 1)).toBe('Skipped 1 computed field.');
	});

	it('EDT-41: change data type says how many mirror rows were skipped', () => {
		expect(dataTypeChangedText(2, 'Date', 0)).toBe('Changed 2 fields to Date.');
		expect(dataTypeChangedText(2, 'Date', 1)).toBe('Changed 2 fields to Date. Skipped 1 computed field.');
		expect(dataTypeChangedText(0, 'Date', 3)).toBe('Skipped 3 computed fields.');
	});

	it('EDT-42: re-sync reports how many were re-synced, and how many are not on the site', () => {
		expect(resyncedText(3, 3)).toBe('Re-synced 3 fields from the site.');
		expect(resyncedText(1, 4)).toBe('Re-synced 1 field from the site. 3 are not on the site.');
		expect(resyncedText(2, 3)).toBe('Re-synced 2 fields from the site. 1 is not on the site.');
	});

	it('EDT-42: none on the site is a warning of its own', () => {
		expect(RESYNC_NONE_TEXT).toBe('None of the selected fields exist on the site.');
	});
});

describe('savedText (EDT-46)', () => {
	it('EDT-46: the confirmation names the set', () => {
		expect(savedText('Lens')).toBe('Saved "Lens".');
	});
});

describe('editorTitle (EDT-1)', () => {
	it('EDT-1: the set name as typed, trimmed; a blank one reads "Untitled set"; "Set" before it loads', () => {
		expect(editorTitle(' Lens kit ')).toBe('Lens kit');
		expect(editorTitle('   ')).toBe('Untitled set');
		expect(editorTitle(null)).toBe('Set');
	});
});

describe('a re-sync whose answer came too late (EDT-42, audit M2)', () => {
	it('EDT-42: says nothing was re-synced and what to do', () => {
		expect(RESYNC_DROPPED_TEXT).toBe('The set changed while the site was read. Nothing was re-synced. Try again.');
	});
});

describe('small texts that take an argument', () => {
	it('EDT-47: a failed save says why, that the changes are kept, and what to do', () => {
		expect(notSavedText('Give the set a name.')).toBe('Give the set a name. Your changes are kept. Save again when ready.');
	});

	it('EDT-39, EDT-40: a row\'s checkbox and a group\'s are named after what they select', () => {
		expect(selectRowLabel(' Lens ')).toBe('Select Lens');
		expect(selectRowLabel('  ')).toBe('Select this field');
		expect(selectGroupLabel('Shot')).toBe('Select the fields of Shot');
	});
});
