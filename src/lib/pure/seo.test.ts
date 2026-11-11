import { describe, expect, it } from 'vitest';
import { headFor, llmsTxt, pageMeta, SITE, SITEMAP_PATHS, sitemapXml } from './seo';

describe('pageMeta', () => {
	it('indexes the list and the connect page, each canonical to its own path', () => {
		expect(pageMeta('/')).toMatchObject({ title: 'SG Fields Setup', canonical: `${SITE}/`, index: true });
		expect(pageMeta('/connect')).toMatchObject({ title: 'Connect · SG Fields Setup', canonical: `${SITE}/connect`, index: true });
	});

	it('keeps a set out of the index: it lives in one browser', () => {
		expect(pageMeta('/sets/abc')).toMatchObject({ canonical: `${SITE}/`, index: false });
		expect(pageMeta('/sets/abc/install').index).toBe(false);
	});
});

describe('headFor', () => {
	it('writes the title, description, canonical, Open Graph and Twitter tags', () => {
		const h = headFor('/connect');
		expect(h).toContain('<title>Connect · SG Fields Setup</title>');
		expect(h).toContain('<meta name="description" content="');
		expect(h).toContain(`<link rel="canonical" href="${SITE}/connect" />`);
		expect(h).toContain(`<meta property="og:url" content="${SITE}/connect" />`);
		expect(h).toContain(`<meta property="og:image" content="${SITE}/og.png" />`);
		expect(h).toContain('<meta property="og:image:width" content="1200" />');
		expect(h).toContain('<meta property="og:image:height" content="630" />');
		expect(h).toContain('<meta name="twitter:card" content="summary_large_image" />');
		expect(h).not.toContain('noindex');
	});

	it('marks a set page noindex', () => {
		expect(headFor('/sets/abc')).toContain('<meta name="robots" content="noindex" />');
	});

	it('never lets a path into the tags', () => {
		expect(headFor('/sets/"><script>alert(1)</script>')).not.toContain('<script>');
	});
});

describe('sitemapXml and llmsTxt', () => {
	it('lists every sitemap path once, absolute', () => {
		const xml = sitemapXml();
		for (const path of SITEMAP_PATHS) expect(xml).toContain(`<loc>${SITE}${path}</loc>`);
		expect(xml.match(/<url>/g)).toHaveLength(SITEMAP_PATHS.length);
	});

	it('names the app, the pages and the source', () => {
		const text = llmsTxt();
		expect(text.startsWith('# SG Fields Setup')).toBe(true);
		expect(text).toContain(`${SITE}/connect`);
		expect(text).toContain('github.com/ksallee/sg-fields-setup');
	});
});
