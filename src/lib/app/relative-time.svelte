<!--
	A time as "3 hours ago" (SET-3), the day and minute on hover. Refreshes every minute.

	    <RelativeTime time={set.changedAt} label="Changed" />
-->
<script lang="ts">
	import { absoluteTime, relativeTime } from '$lib/pure/relative-time';
	import type { Timestamp } from '$lib/pure/model';

	let {
		time,
		label,
		class: className
	}: {
		time: Timestamp;
		/** What happened then, for the tooltip: "Changed" gives "Changed 10 Nov 2026, 09:05". */
		label?: string;
		class?: string;
	} = $props();

	let now = $state(new Date().toISOString());
	$effect(() => {
		const timer = setInterval(() => (now = new Date().toISOString()), 60_000);
		return () => clearInterval(timer);
	});

	const exact = $derived(absoluteTime(time, -new Date(time).getTimezoneOffset()));
</script>

<time datetime={time} title={label ? `${label} ${exact}` : exact} class={className}>{relativeTime(time, now)}</time>
