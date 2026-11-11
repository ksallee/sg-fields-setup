// Everything the page reads comes from the browser: the session is in localStorage and the
// site is called from there (see `$lib/live`), so there is nothing for the server to render.
export const ssr = false;
