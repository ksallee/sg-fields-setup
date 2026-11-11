/**
 * The site comparison's categories (CMP-8). Each entry falls in exactly one. The comparison
 * computes them; the editor reads them through a lookup.
 */

/**
 * The categories in display order: on site, new, needs attention (EDT-36). The on-site-first sort
 * and the status filter (EDT-35) follow this order.
 */
export const ENTRY_CATEGORIES = ['on_site', 'new', 'needs_attention'] as const;

/** One entry's category against the site (CMP-8). Without a site, a complete unique entry is `new` (CMP-3). */
export type EntryCategory = (typeof ENTRY_CATEGORIES)[number];
