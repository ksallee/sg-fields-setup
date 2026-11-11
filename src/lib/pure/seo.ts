/**
 * What a crawler and a link preview read. The app renders in the browser only (`+layout.ts`:
 * `ssr = false`), so `src/hooks.server.ts` writes these tags into the shell per path;
 * `/sitemap.xml` and `/llms.txt` come from here too. After sg-task-templates' `seo.ts`.
 */

export const SITE = 'https://sg-fields-setup.vercel.app';
export const REPO = 'https://github.com/ksallee/sg-fields-setup';
const NAME = 'SG Fields Setup';
const LINE = 'Turn spreadsheet columns into Flow Production Tracking fields.';

export type PageMeta = { title: string; description: string; canonical: string; index: boolean };

const HOME = `${LINE} Keep sets of field definitions, compare them with your site, read the plan, then install.`;
const CONNECT = `${LINE} Name your Flow PT site and sign in as yourself, on the site. Nothing is written before the install plan.`;

/** The paths worth a search result. A set lives in one browser: its pages are nobody else's. */
export const SITEMAP_PATHS = ['/', '/connect'];

export function pageMeta(path: string): PageMeta {
	if (path === '/') return { title: NAME, description: HOME, canonical: `${SITE}/`, index: true };
	if (path === '/connect') return { title: `Connect · ${NAME}`, description: CONNECT, canonical: `${SITE}/connect`, index: true };
	return { title: NAME, description: HOME, canonical: `${SITE}/`, index: false };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The head tags for a path. Each page's `<svelte:head>` title then keeps `document.title` in step. */
export function headFor(path: string): string {
	const m = pageMeta(path);
	const t = esc(m.title);
	const d = esc(m.description);
	const img = `${SITE}/og.png`;
	const alt = esc(`${NAME}: ${LINE}`);
	return [
		`<title>${t}</title>`,
		`<meta name="description" content="${d}" />`,
		m.index ? '' : '<meta name="robots" content="noindex" />',
		`<link rel="canonical" href="${m.canonical}" />`,
		`<meta property="og:type" content="website" />`,
		`<meta property="og:site_name" content="${NAME}" />`,
		`<meta property="og:title" content="${t}" />`,
		`<meta property="og:description" content="${d}" />`,
		`<meta property="og:url" content="${m.canonical}" />`,
		`<meta property="og:image" content="${img}" />`,
		`<meta property="og:image:width" content="1200" />`,
		`<meta property="og:image:height" content="630" />`,
		`<meta property="og:image:alt" content="${alt}" />`,
		`<meta name="twitter:card" content="summary_large_image" />`,
		`<meta name="twitter:title" content="${t}" />`,
		`<meta name="twitter:description" content="${d}" />`,
		`<meta name="twitter:image" content="${img}" />`
	]
		.filter(Boolean)
		.join('\n\t\t');
}

export function sitemapXml(): string {
	const urls = SITEMAP_PATHS.map((p) => `\t<url><loc>${SITE}${p}</loc></url>`).join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function llmsTxt(): string {
	return `# ${NAME}

> ${LINE} A web app for Flow Production Tracking (Flow PT, formerly ShotGrid). It keeps named sets of field definitions, fills them from CSV or XLSX column headers, compares them with a live site and installs them. Nothing is written before you see the plan.

## What it does

- Import: each column header of a CSV or XLSX becomes one field, with a guessed data type. No data row is stored or sent.
- Compare: per field, whether it is on the site and whether it matches.
- Plan: what will be created, updated, left alone or refused, and why.
- Install: one field at a time, with cancel, resume and retry. Per-project visibility.

## What it does not do

It does not delete fields, change a field's data type, create entity types, or undo a run. It has no server store and no accounts: sets stay in the browser.

## Pages

- [Sets](${SITE}/): the list of sets.
- [Connect](${SITE}/connect): name a Flow PT site and sign in as yourself.

## Source

- [Repository](${REPO}), MIT.
`;
}
