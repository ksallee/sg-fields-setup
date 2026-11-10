import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import lensSet from '../../../fixtures/field-sets/camera-report-lens.json';
import slateSet from '../../../fixtures/field-sets/camera-report-slate.json';
import vpSet from '../../../fixtures/field-sets/camera-report-virtual-production.json';
import { DEFAULT_SAMPLE_SIZE, readXlsx, type WorkbookResult } from './xlsx';

const fixture = new Uint8Array(readFileSync(new URL('../../../fixtures/source/FlowStudioDemo.xlsx', import.meta.url)));

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

interface TestSheet {
	name: string;
	/** Zip path under xl/, e.g. 'worksheets/sheet1.xml'. */
	file: string;
	/** Inner XML of <sheetData>, or a whole document when it starts with '<?xml'. */
	data: string;
}

/** A minimal workbook, sheets listed in the order given, files named as given. */
function workbook(sheets: TestSheet[], sharedStrings?: string[] | string): Uint8Array {
	const rels = sheets
		.map((s, i) => `<Relationship Id="rId${i + 10}" Type="${REL}/worksheet" Target="${s.file}"/>`)
		.join('');
	const sst = sharedStrings === undefined ? '' : `<Relationship Id="rId1" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>`;
	const files: Record<string, Uint8Array> = {
		'[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
		'_rels/.rels': strToU8(
			`<?xml version="1.0"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
		),
		'xl/workbook.xml': strToU8(
			`<?xml version="1.0"?><workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>` +
				sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 10}"/>`).join('') +
				'</sheets></workbook>'
		),
		'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="${PKG}">${sst}${rels}</Relationships>`)
	};
	for (const s of sheets) {
		const xml = s.data.startsWith('<?xml')
			? s.data
			: `<?xml version="1.0"?><worksheet xmlns="${MAIN}"><sheetData>${s.data}</sheetData></worksheet>`;
		files[`xl/${s.file}`] = strToU8(xml);
	}
	if (sharedStrings !== undefined) {
		const body =
			typeof sharedStrings === 'string' ? sharedStrings : sharedStrings.map((t) => `<si><t>${t}</t></si>`).join('');
		files['xl/sharedStrings.xml'] = strToU8(`<?xml version="1.0"?><sst xmlns="${MAIN}">${body}</sst>`);
	}
	return zipSync(files);
}

/** One sheet named Sheet1. */
function oneSheet(data: string, sharedStrings?: string[] | string): Uint8Array {
	return workbook([{ name: 'Sheet1', file: 'worksheets/sheet1.xml', data }], sharedStrings);
}

/** An inline-string cell. */
const is = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;

function sheets(result: WorkbookResult) {
	if (!result.ok) throw new Error(`expected a workbook, got ${result.reason}`);
	return result.sheets;
}

function only(result: WorkbookResult) {
	const all = sheets(result);
	expect(all).toHaveLength(1);
	return all[0].table;
}

describe('readXlsx on the real fixture (IMP-42 to IMP-45)', () => {
	const result = readXlsx(fixture);

	it('reads its one sheet with its name', () => {
		expect(sheets(result).map((s) => s.name)).toEqual(['Sheet1']);
	});

	it('reads the 72 headers in order', () => {
		const { headers } = only(result);
		expect(headers).toHaveLength(72);
		expect(headers[0]).toBe('Slates::Slate');
		expect(headers[1]).toBe('Tk Take');
		expect(headers[71]).toBe('Slates::Diagram8');
		expect(headers).toContain('Lens::Maximum Aperture');
		expect(headers).toContain('Lens::Anamorphic Desqueeze Ratio');
	});

	it('holds every header the hand-built sets record', () => {
		const { headers } = only(result);
		const recorded = [lensSet, slateSet, vpSet].flatMap((set) => set.entries.map((e) => e.source_header));
		expect(recorded.length).toBeGreaterThan(0);
		for (const header of recorded) expect(headers).toContain(header);
	});

	it('reads the 5 data rows, each as wide as the headers (IMP-44)', () => {
		const { rows } = only(result);
		expect(rows).toHaveLength(5);
		for (const row of rows) expect(row).toHaveLength(72);
	});

	it('keeps multi-line cell values intact, entities decoded (IMP-43)', () => {
		const { headers, rows } = only(result);
		const vfxWork = headers.indexOf('Slates::VFX Work');
		expect(rows[0][vfxWork]).toBe('CG Add/Replace\nWire Removal\nEnvironment Addition \nPaint Out ');
		expect(rows[0]).toContain('Ball & Chart\nClean Plate\nHDRi\nPano\nRef Photos\nWitness Cam');
	});

	it('leaves cells with no value blank, so a row with gaps lines up (IMP-44)', () => {
		const { rows } = only(result);
		// Row 2 jumps from B to J.
		expect(rows[0].slice(2, 9)).toEqual(['', '', '', '', '', '', '']);
	});

	it('keeps date cells as serial numbers, a known limit (IMP-46)', () => {
		const { headers, rows } = only(result);
		expect(rows[0][headers.indexOf('Slates::Shoot Date')]).toBe('46157');
	});
});

describe('readXlsx sheets (IMP-42, IMP-6)', () => {
	it('returns sheets in workbook order, not zip file order', () => {
		const bytes = workbook([
			{ name: 'Second file', file: 'worksheets/sheet2.xml', data: `<row r="1">${is('A1', 'b')}</row>` },
			{ name: 'First file', file: 'worksheets/sheet1.xml', data: `<row r="1">${is('A1', 'a')}</row>` }
		]);
		expect(sheets(readXlsx(bytes)).map((s) => [s.name, s.table.headers])).toEqual([
			['Second file', ['b']],
			['First file', ['a']]
		]);
	});

	it('resolves sheet files through the relationships, whatever their names', () => {
		const bytes = workbook([{ name: 'Odd', file: 'sheets/data.xml', data: `<row r="1">${is('A1', 'x')}</row>` }]);
		expect(only(readXlsx(bytes)).headers).toEqual(['x']);
	});

	it('decodes entities in sheet names', () => {
		const bytes = workbook([{ name: 'R&amp;D &lt;2&gt;', file: 'worksheets/s.xml', data: `<row r="1">${is('A1', 'x')}</row>` }]);
		expect(sheets(readXlsx(bytes))[0].name).toBe('R&D <2>');
	});

	it('drops a sheet without a header row silently (IMP-6)', () => {
		const bytes = workbook([
			{ name: 'Empty', file: 'worksheets/sheet1.xml', data: '' },
			{ name: 'Blank cells', file: 'worksheets/sheet2.xml', data: `<row r="1"><c r="A1" s="1"/>${is('B1', '  ')}</row>` },
			{ name: 'Data', file: 'worksheets/sheet3.xml', data: `<row r="1">${is('A1', 'h')}</row>` }
		]);
		expect(sheets(readXlsx(bytes)).map((s) => s.name)).toEqual(['Data']);
	});

	it('is no-header when no sheet has a header row (IMP-5)', () => {
		const bytes = workbook([
			{ name: 'A', file: 'worksheets/sheet1.xml', data: '' },
			{ name: 'B', file: 'worksheets/sheet2.xml', data: '<row r="3"><c r="A3"/></row>' }
		]);
		expect(readXlsx(bytes)).toEqual({ ok: false, reason: 'no-header' });
	});

	it('keeps a sheet that has a header and no data rows', () => {
		expect(only(readXlsx(oneSheet(`<row r="1">${is('A1', 'h')}</row>`)))).toEqual({ headers: ['h'], rows: [] });
	});
});

describe('readXlsx header row', () => {
	it('is the first row with a non-blank cell; blank rows above it are skipped', () => {
		const bytes = oneSheet(
			`<row r="1"><c r="A1" s="2"/></row><row r="2">${is('A2', ' ')}</row><row r="4">${is('B4', ' Name ')}</row><row r="5">${is('B5', 'v')}</row>`
		);
		expect(only(readXlsx(bytes))).toEqual({ headers: ['', 'Name'], rows: [['', 'v']] });
	});

	it('keeps blank headers inside the row as empty strings, drops trailing ones', () => {
		const bytes = oneSheet(`<row r="1">${is('A1', 'a')}${is('C1', 'c')}<c r="D1" s="1"/>${is('E1', ' ')}</row>`);
		expect(only(readXlsx(bytes)).headers).toEqual(['a', '', 'c']);
	});
});

describe('readXlsx cells (IMP-43, IMP-44)', () => {
	it('resolves shared strings', () => {
		const bytes = oneSheet('<row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1" t="s"><v>0</v></c></row>', ['zero', 'one']);
		expect(only(readXlsx(bytes)).headers).toEqual(['one', 'zero']);
	});

	it('concatenates rich text runs and ignores phonetic runs', () => {
		const sst =
			'<si><r><rPr><b/></rPr><t>Bold</t></r><r><t xml:space="preserve"> and plain</t></r><rPh sb="0" eb="1"><t>ボールド</t></rPh><phoneticPr fontId="1"/></si>';
		expect(only(readXlsx(oneSheet('<row r="1"><c r="A1" t="s"><v>0</v></c></row>', sst))).headers).toEqual([
			'Bold and plain'
		]);
	});

	it('reads inline strings, rich ones included', () => {
		const bytes = oneSheet(
			`<row r="1">${is('A1', 'h1')}${is('B1', 'h2')}</row><row r="2">${is('A2', 'plain')}<c r="B2" t="inlineStr"><is><r><t>ri</t></r><r><t>ch</t></r></is></c></row>`
		);
		expect(only(readXlsx(bytes)).rows).toEqual([['plain', 'rich']]);
	});

	it('reads booleans as true and false', () => {
		const bytes = oneSheet(
			`<row r="1">${is('A1', 'a')}${is('B1', 'b')}</row><row r="2"><c r="A2" t="b"><v>1</v></c><c r="B2" t="b"><v>0</v></c></row>`
		);
		expect(only(readXlsx(bytes)).rows).toEqual([['true', 'false']]);
	});

	it('reads numbers as their stored text', () => {
		const bytes = oneSheet(
			`<row r="1">${is('A1', 'a')}${is('B1', 'b')}${is('C1', 'c')}</row><row r="2"><c r="A2"><v>1.5</v></c><c r="B2" t="n"><v>-3</v></c><c r="C2"><v>1E-3</v></c></row>`
		);
		expect(only(readXlsx(bytes)).rows).toEqual([['1.5', '-3', '1E-3']]);
	});

	it('reads formula cells as their stored result', () => {
		const bytes = oneSheet(
			`<row r="1">${is('A1', 'n')}${is('B1', 's')}${is('C1', 'b')}${is('D1', 'none')}</row>` +
				'<row r="2"><c r="A2"><f>1+1</f><v>2</v></c><c r="B2" t="str"><f>"a"&amp;"b"</f><v>ab</v></c>' +
				'<c r="C2" t="b"><f>TRUE()</f><v>1</v></c><c r="D2"><f>A2</f></c></row>'
		);
		expect(only(readXlsx(bytes)).rows).toEqual([['2', 'ab', 'true', '']]);
	});

	it('keeps date cells as serial numbers, a known limit (IMP-46)', () => {
		const bytes = oneSheet(`<row r="1">${is('A1', 'Date')}</row><row r="2"><c r="A2" s="5"><v>45292</v></c></row>`);
		expect(only(readXlsx(bytes)).rows).toEqual([['45292']]);
	});

	it('places cells by column reference, past Z too', () => {
		const bytes = oneSheet(`<row r="1">${is('A1', 'a')}${is('AB1', 'ab')}</row><row r="2">${is('AB2', 'x')}</row>`);
		const table = only(readXlsx(bytes));
		expect(table.headers).toHaveLength(28);
		expect(table.headers[27]).toBe('ab');
		expect(table.rows[0][27]).toBe('x');
		expect(table.rows[0][0]).toBe('');
	});

	it('pads short data rows and cuts long ones to the header width', () => {
		const bytes = oneSheet(
			`<row r="1">${is('A1', 'a')}${is('B1', 'b')}</row><row r="2">${is('A2', '1')}</row><row r="3">${is('A3', '1')}${is('B3', '2')}${is('C3', '3')}</row>`
		);
		expect(only(readXlsx(bytes)).rows).toEqual([
			['1', ''],
			['1', '2']
		]);
	});

	it('places cells and rows without a reference one after another', () => {
		const bytes = oneSheet(
			'<row><c t="inlineStr"><is><t>a</t></is></c><c t="inlineStr"><is><t>b</t></is></c></row><row><c/><c><v>2</v></c></row>'
		);
		expect(only(readXlsx(bytes))).toEqual({ headers: ['a', 'b'], rows: [['', '2']] });
	});

	it('drops fully blank data rows, as CSV drops blank lines (IMP-38)', () => {
		const bytes = oneSheet(
			`<row r="1">${is('A1', 'a')}</row><row r="2"><c r="A2" s="1"/></row><row r="3">${is('A3', ' ')}</row><row r="7">${is('A7', 'x')}</row>`
		);
		expect(only(readXlsx(bytes)).rows).toEqual([['x']]);
	});

	it('reads raw carriage returns in text as line feeds, as XML requires; &#13; stays', () => {
		const bytes = oneSheet(`<row r="1">${is('A1', 'h')}</row><row r="2">${is('A2', 'a\r\nb\rc&#13;d')}</row>`);
		expect(only(readXlsx(bytes)).rows).toEqual([['a\nb\nc\rd']]);
	});

	it('keeps data values as read, untrimmed', () => {
		const bytes = oneSheet(`<row r="1">${is('A1', ' a ')}</row><row r="2"><c r="A2" t="inlineStr"><is><t xml:space="preserve"> v </t></is></c></row>`);
		expect(only(readXlsx(bytes))).toEqual({ headers: ['a'], rows: [[' v ']] });
	});

	it('decodes XML entities, numeric ones and Excel _xHHHH_ escapes', () => {
		const bytes = oneSheet(
			`<row r="1">${is('A1', '&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos; &#233;&#x00E9;')}</row><row r="2">${is('A2', 'line_x000D_\nnext _x005F_x0041_')}</row>`
		);
		expect(only(readXlsx(bytes))).toEqual({ headers: [`<a> & "b" 'c' éé`], rows: [['line\r\nnext _x0041_']] });
	});
});

describe('readXlsx XML scanner', () => {
	it('reads attributes in any order and either quote', () => {
		const bytes = oneSheet(
			`<row spans="1:2" r='1'><c s="1" t='inlineStr' r="B1"><is><t>b</t></is></c><c t="s" r="A1" s="2"><v>0</v></c></row>`,
			['a']
		);
		expect(only(readXlsx(bytes)).headers).toEqual(['a', 'b']);
	});

	it('reads self-closing cells as blank', () => {
		const bytes = oneSheet(`<row r="1">${is('A1', 'a')}<c r="B1"/>${is('C1', 'c')}</row><row r="2"><c r="A2" /><c r="B2"><v>1</v></c></row>`);
		expect(only(readXlsx(bytes))).toEqual({ headers: ['a', '', 'c'], rows: [['', '1', '']] });
	});

	it('reads elements under a namespace prefix', () => {
		const sheet =
			`<?xml version="1.0"?><x:worksheet xmlns:x="${MAIN}"><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c>` +
			`<x:c r="B1" t="inlineStr"><x:is><x:t>b</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>`;
		const sst = `<?xml version="1.0"?><x:sst xmlns:x="${MAIN}"><x:si><x:t>a</x:t></x:si></x:sst>`;
		const bytes = workbook([{ name: 'P', file: 'worksheets/sheet1.xml', data: sheet }], []);
		// Swap in the prefixed shared strings part.
		const files = {
			...unzipSync(bytes),
			'xl/sharedStrings.xml': strToU8(sst)
		};
		expect(only(readXlsx(zipSync(files))).headers).toEqual(['a', 'b']);
	});

	it('keeps preserved spaces in text, trims headers only', () => {
		const sst = '<si><t xml:space="preserve">  spaced  </t></si>';
		const bytes = oneSheet('<row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>0</v></c></row>', sst);
		expect(only(readXlsx(bytes))).toEqual({ headers: ['spaced'], rows: [['  spaced  ']] });
	});

	it('skips comments, processing instructions and reads CDATA as text', () => {
		const bytes = oneSheet(`<!-- <row r="9"><c r="A9"><v>9</v></c></row> --><row r="1"><c r="A1" t="inlineStr"><is><t><![CDATA[<raw> & ]]>x</t></is></c></row>`);
		expect(only(readXlsx(bytes)).headers).toEqual(['<raw> & x']);
	});

	it('reads an attribute value holding ">"', () => {
		const bytes = workbook([{ name: 'a>b', file: 'worksheets/s.xml', data: `<row r="1">${is('A1', 'x')}</row>` }]);
		expect(sheets(readXlsx(bytes))[0].name).toBe('a>b');
	});
});

describe('readXlsx sample size (IMP-45)', () => {
	const many = (n: number) =>
		oneSheet(
			`<row r="1">${is('A1', 'n')}</row>` +
				Array.from({ length: n }, (_, i) => `<row r="${i + 2}"><c r="A${i + 2}"><v>${i}</v></c></row>`).join('')
		);

	it('reads the header plus 50 data rows by default', () => {
		expect(DEFAULT_SAMPLE_SIZE).toBe(50);
		const { rows } = only(readXlsx(many(120)));
		expect(rows).toHaveLength(50);
		expect(rows[0]).toEqual(['0']);
		expect(rows[49]).toEqual(['49']);
	});

	it('takes the sample size as an option', () => {
		expect(only(readXlsx(many(120), { sampleSize: 3 })).rows).toEqual([['0'], ['1'], ['2']]);
		expect(only(readXlsx(many(120), { sampleSize: 0 })).rows).toEqual([]);
	});

	it('stops reading a sheet once the sample is full', () => {
		// Row 3 points past the shared strings, which is unreadable: a reader that went on would refuse the file.
		const bytes = oneSheet(
			`<row r="1">${is('A1', 'n')}</row><row r="2"><c r="A2"><v>1</v></c></row><row r="3"><c r="A3" t="s"><v>99</v></c></row>`,
			[]
		);
		expect(only(readXlsx(bytes, { sampleSize: 1 })).rows).toEqual([['1']]);
	});
});

describe('readXlsx refuses what is not a workbook (IMP-47, IMP-4)', () => {
	it('is unreadable for garbage bytes', () => {
		expect(readXlsx(strToU8('name,take\nA,1\n'))).toEqual({ ok: false, reason: 'unreadable' });
		expect(readXlsx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toEqual({ ok: false, reason: 'unreadable' });
		expect(readXlsx(new Uint8Array())).toEqual({ ok: false, reason: 'unreadable' });
	});

	it('is unreadable for a zip that is not a workbook', () => {
		expect(readXlsx(zipSync({ 'readme.txt': strToU8('hello') }))).toEqual({ ok: false, reason: 'unreadable' });
	});

	it('is unreadable when a listed sheet part is missing', () => {
		const files = unzipSync(oneSheet(`<row r="1">${is('A1', 'x')}</row>`));
		delete files['xl/worksheets/sheet1.xml'];
		expect(readXlsx(zipSync(files))).toEqual({ ok: false, reason: 'unreadable' });
	});

	it('is unreadable when a shared string index is out of range', () => {
		expect(readXlsx(oneSheet('<row r="1"><c r="A1" t="s"><v>4</v></c></row>', ['a']))).toEqual({
			ok: false,
			reason: 'unreadable'
		});
	});
});
