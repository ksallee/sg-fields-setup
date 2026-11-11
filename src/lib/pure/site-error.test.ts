import { describe, expect, it } from 'vitest';
import { siteErrorDetail, siteErrorMessage } from './site-error';

function refusal(status: number, detail: string): Error {
	return Object.assign(new Error('Bad Request'), { status, body: { errors: [{ status, title: 'Bad Request', detail }] } });
}

describe('siteErrorMessage', () => {
	it('prefers what the server said: the detail, else the title', () => {
		expect(siteErrorMessage(refusal(400, "API schema_field_update(): The 'visible' property requires a project to be updated."))).toBe(
			"API schema_field_update(): The 'visible' property requires a project to be updated."
		);
		expect(siteErrorMessage(Object.assign(new Error('Not Found'), { body: { errors: [{ title: 'Not Found', detail: "Field 'Version.sg_x' does not exist." }] } }))).toBe(
			"Field 'Version.sg_x' does not exist."
		);
		expect(siteErrorMessage({ body: { errors: [{ title: 'Forbidden', detail: ' ' }] } })).toBe('Forbidden');
	});

	it('gives the message of whatever was thrown', () => {
		expect(siteErrorMessage(new Error('A.'))).toBe('A.');
		expect(siteErrorMessage({ message: 'B.' })).toBe('B.');
		expect(siteErrorMessage('C.')).toBe('C.');
		expect(siteErrorMessage(new Error('Failed to fetch'))).toBe('Failed to fetch');
	});

	it('falls back to a plain line when nothing was said', () => {
		expect(siteErrorMessage(undefined)).toBe('Unknown error.');
		expect(siteErrorMessage(null)).toBe('Unknown error.');
		expect(siteErrorMessage(new Error(''))).toBe('Unknown error.');
		expect(siteErrorMessage({ message: '  ' })).toBe('Unknown error.');
		expect(siteErrorMessage({ body: { errors: [] } })).toBe('Unknown error.');
	});

	it('takes the caller\'s fallback', () => {
		expect(siteErrorMessage(null, 'The step failed.')).toBe('The step failed.');
		expect(siteErrorMessage(new Error(''), 'The step failed.')).toBe('The step failed.');
	});
});

describe('siteErrorDetail', () => {
	it('reads the first error\'s detail from a reply body', () => {
		expect(siteErrorDetail({ errors: [{ title: 'Not Found', detail: "Entity type 'X' does not exist." }] })).toBe("Entity type 'X' does not exist.");
	});

	it('answers null when the body carries none', () => {
		expect(siteErrorDetail({ errors: [{ title: 'Not Found' }] })).toBeNull();
		expect(siteErrorDetail({ errors: [{ detail: '' }] })).toBeNull();
		expect(siteErrorDetail({ errors: 'no' })).toBeNull();
		expect(siteErrorDetail('<html>')).toBeNull();
		expect(siteErrorDetail(null)).toBeNull();
	});
});
