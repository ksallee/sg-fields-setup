import { llmsTxt } from '$lib/pure/seo';

export const prerender = true;

export const GET = (): Response => new Response(llmsTxt(), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
