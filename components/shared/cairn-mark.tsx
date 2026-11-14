/**
 * CairnMark — the app mark (left-to-right dependency graph of organic stones),
 * inlined as JSX so it rides along with the components (no network fetch,
 * recolorable via currentColor, crisp at any size). 72×24 viewBox (3:1).
 */
export function CairnMark({ className = "" }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 72 24"
			fill="currentColor"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			aria-hidden="true"
		>
			{/* S-curve dependency arcs (left to right) */}
			<path d="M9.5 14.2 C 15.5 14.2, 16.5 7.2, 23.0 7.0" fill="none" strokeWidth="1.1" opacity="0.68" />
			<path d="M9.5 15.0 C 16.5 16.0, 20.5 18.0, 29.0 17.5" fill="none" strokeWidth="1.1" opacity="0.62" />
			<path d="M27.5 7.2 C 33.5 7.4, 35.0 11.4, 42.0 11.5" fill="none" strokeWidth="1.1" opacity="0.68" />
			<path d="M33.5 17.2 C 38.0 16.5, 39.0 12.6, 42.5 12.0" fill="none" strokeWidth="1.1" opacity="0.68" />
			<path d="M47.0 11.6 C 52.5 11.5, 53.5 7.4, 60.5 7.4" fill="none" strokeWidth="1.1" opacity="0.68" />
			<path d="M47.0 12.2 C 53.0 13.0, 54.5 16.8, 62.5 16.6" fill="none" strokeWidth="1.1" opacity="0.62" />
			{/* Stone 1: broad anchor stone */}
			<path stroke="none" d="M2.0 14.6 C 2.0 12.6, 4.1 11.5, 6.8 11.6 C 9.2 11.7, 10.6 13.0, 10.4 14.8 C 10.2 16.4, 8.6 17.6, 5.8 17.5 C 3.4 17.4, 2.0 16.2, 2.0 14.6 Z" />
			{/* Stone 2: tilted river pebble */}
			<path stroke="none" d="M21.2 7.2 C 21.4 5.5, 23.2 4.3, 25.5 4.4 C 27.6 4.5, 28.8 5.6, 28.5 7.2 C 28.2 8.7, 26.2 9.4, 24.0 9.1 C 22.1 8.8, 21.0 8.2, 21.2 7.2 Z" />
			{/* Stone 3: flat elongated slate stone */}
			<path stroke="none" d="M27.0 17.4 C 27.2 15.8, 29.0 15.0, 31.6 15.2 C 34.0 15.4, 35.4 16.4, 35.0 17.8 C 34.6 19.2, 32.4 19.7, 29.8 19.4 C 27.8 19.2, 26.9 18.4, 27.0 17.4 Z" />
			{/* Stone 4: center-right bridge stone */}
			<path stroke="none" d="M40.6 11.8 C 40.7 10.0, 42.3 9.0, 44.8 9.1 C 47.0 9.2, 48.6 10.4, 48.4 12.2 C 48.2 13.8, 46.4 14.6, 43.9 14.3 C 41.7 14.0, 40.5 13.1, 40.6 11.8 Z" />
			{/* Stone 5: compact upper-right pebble */}
			<path stroke="none" d="M59.2 7.3 C 59.3 5.8, 60.8 4.8, 63.0 4.9 C 64.9 5.0, 66.2 6.0, 66.0 7.4 C 65.8 8.8, 64.1 9.5, 62.0 9.3 C 60.2 9.1, 59.1 8.3, 59.2 7.3 Z" />
			{/* Stone 6: wide angled lower-right stone */}
			<path stroke="none" d="M61.0 16.5 C 61.2 14.8, 63.2 13.9, 65.8 14.1 C 68.1 14.3, 69.2 15.5, 68.8 17.1 C 68.4 18.6, 66.3 19.1, 63.8 18.8 C 61.8 18.5, 60.9 17.6, 61.0 16.5 Z" />
		</svg>
	);
}
