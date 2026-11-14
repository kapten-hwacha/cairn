"use client";

import { useEffect, useState } from "react";
import { PencilIcon, XIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	clearSavedPencilDrawing,
	loadSavedPencilDrawing,
	openPencilDrawer,
} from "@/lib/pencilkit";

export interface PencilScratchpadBarProps {
	drawingKey: string;
	attachmentName?: string;
	disabled?: boolean;
	attachedFiles?: readonly { name: string; mimeType: string; data: string }[];
	onAttach: (attachment: { name: string; mimeType: "image/png"; data: string }) => void;
	onRemoveAttachment?: (name: string) => void;
}

export function PencilScratchpadBar({
	drawingKey,
	attachmentName = "scratchpad.png",
	disabled = false,
	attachedFiles = [],
	onAttach,
	onRemoveAttachment,
}: PencilScratchpadBarProps) {
	const [opening, setOpening] = useState(false);
	const [hasSavedStrokes, setHasSavedStrokes] = useState(false);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void loadSavedPencilDrawing(drawingKey).then((data) => {
			if (!cancelled) {
				setHasSavedStrokes(Boolean(data && data.length > 0));
			}
		});
		return () => {
			cancelled = true;
		};
	}, [drawingKey]);

	const handleOpen = async () => {
		if (opening || disabled) return;
		setOpening(true);
		setStatusMessage(null);
		try {
			const res = await openPencilDrawer({ key: drawingKey });
			setHasSavedStrokes(res.hasDrawing);
			if (!res.cancelled && res.pngBase64) {
				onAttach({
					name: attachmentName,
					mimeType: "image/png",
					data: res.pngBase64,
				});
				setStatusMessage("Attached scratchpad");
			} else if (!res.cancelled && !res.pngBase64) {
				onRemoveAttachment?.(attachmentName);
				setStatusMessage("Scratchpad is empty");
			}
		} catch (err) {
			setStatusMessage(err instanceof Error ? err.message : "Failed to open scratchpad");
		} finally {
			setOpening(false);
		}
	};

	const handleClear = async () => {
		await clearSavedPencilDrawing(drawingKey);
		setHasSavedStrokes(false);
		onRemoveAttachment?.(attachmentName);
		setStatusMessage(null);
	};

	return (
		<div
			data-testid="pencil-scratchpad-bar"
			className="flex flex-col gap-1.5 rounded-lg border border-border/50 bg-accent/20 px-3 py-2 text-xs"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-1.5 font-medium text-muted-foreground">
					<PencilIcon className="size-3.5 text-primary" />
					<span>Apple Pencil Scratchpad</span>
				</div>

				<div className="flex flex-wrap items-center gap-1.5">
					<Button
						type="button"
						size="sm"
						variant="outline"
						data-testid="pencil-scratchpad-open-button"
						disabled={disabled || opening}
						onClick={handleOpen}
						className="h-7 gap-1 px-2 text-xs font-normal"
					>
						{opening ? (
							<Loader2Icon className="size-3 animate-spin" />
						) : (
							<PencilIcon className="size-3" />
						)}
						{hasSavedStrokes ? "Edit Scratchpad" : "Open Scratchpad"}
					</Button>

					{hasSavedStrokes && (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							disabled={disabled || opening}
							onClick={handleClear}
							className="h-7 px-2 text-xs font-normal text-muted-foreground"
						>
							Reset
						</Button>
					)}
				</div>
			</div>

			{statusMessage && (
				<div className="text-[11px] text-muted-foreground">{statusMessage}</div>
			)}

			{attachedFiles.length > 0 && (
				<div className="flex flex-wrap gap-1.5 pt-1">
					{attachedFiles.map((file) => (
						<div
							key={file.name}
							className="flex items-center gap-1.5 rounded border border-border/60 bg-background/80 px-2 py-1 text-[11px]"
						>
							{file.mimeType.startsWith("image/") && (
								// eslint-disable-next-line @next/next/no-img-element
								<img
									src={`data:${file.mimeType};base64,${file.data}`}
									alt={file.name}
									className="size-6 rounded object-cover"
								/>
							)}
							<span className="max-w-[140px] truncate">{file.name}</span>
							{onRemoveAttachment && (
								<button
									type="button"
									onClick={() => onRemoveAttachment(file.name)}
									aria-label={`Remove ${file.name}`}
									className="text-muted-foreground hover:text-foreground"
								>
									<XIcon className="size-3" />
								</button>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
