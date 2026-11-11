/**
 * Holds input off a region for a moment without taking focus from it. `inert` would do the first
 * and fail the second: the browser blurs whatever is focused inside an inert tree, and the
 * keyboard lands on the page's body.
 *
 *     <div use:blockInput={() => session.saving} aria-busy={session.saving}>
 *
 * While `blocked()` answers true, typing, pasting, cutting, dropping and clicking inside the node
 * do nothing. Tab still moves, and a key held with Ctrl, Cmd or Alt is the browser's or the
 * page's own shortcut and passes. Nothing is decided here: whoever owns the state refuses the
 * edits too.
 */
const EVENTS = ['keydown', 'beforeinput', 'paste', 'cut', 'drop', 'click', 'pointerdown', 'mousedown'] as const;

export function blockInput(node: HTMLElement, blocked: () => boolean): { destroy(): void } {
	const stop = (event: Event): void => {
		if (!blocked()) return;
		if (event instanceof KeyboardEvent && (event.key === 'Tab' || event.ctrlKey || event.metaKey || event.altKey)) return;
		event.preventDefault();
		event.stopPropagation();
	};
	for (const type of EVENTS) node.addEventListener(type, stop, true);
	return {
		destroy() {
			for (const type of EVENTS) node.removeEventListener(type, stop, true);
		}
	};
}
