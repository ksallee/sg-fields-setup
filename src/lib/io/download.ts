/** Hands a text to the browser as a file download. Browser only. */
export function downloadText(fileName: string, text: string, type = 'application/json'): void {
	const url = URL.createObjectURL(new Blob([text], { type }));
	const link = document.createElement('a');
	link.href = url;
	link.download = fileName;
	document.body.append(link);
	link.click();
	link.remove();
	// The click only queues the download; let it start before the URL goes.
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
