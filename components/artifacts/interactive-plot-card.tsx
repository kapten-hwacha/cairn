"use client";
/* eslint-disable @next/next/no-img-element -- The verified PNG is a local data URL in the desktop app. */
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ChatActionsContext } from "@/components/chat/chat";
import { Toggle } from "@/components/settings/controls";
import { InvertDiscIcon } from "./invert-disc";
import { downloadFile, slugFilename } from "./download";
import { noteStudyInput, checkStudyFocus } from "@/components/practice/study-tracker";
import { PLOT3D_DEADLINE_MS, type Plot3DResult } from "@/src/core";
export function InteractivePlotCard({
  result,
  messageId,
  initialInverted = false,
}: {
  result: Plot3DResult;
  messageId?: string;
  initialInverted?: boolean;
}) {
  const actions = useContext(ChatActionsContext);
  const [phase, setPhase] = useState<"preview" | "loading" | "ready" | "error">(
    "preview",
  );
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  const [inverted, setInverted] = useState(initialInverted),
    [expanded, setExpanded] = useState(false);
  const [bounds, setBounds] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const wrapper = useRef<HTMLDivElement>(null),
    placeholder = useRef<HTMLDivElement>(null),
    iframe = useRef<HTMLIFrameElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null),
    inlineHeight = useRef(0),
    isExpanded = useRef(false);
  const srcDoc = useMemo(() => result.html, [result.html]);
  const close = useCallback(() => {
    setExpanded(false);
    isExpanded.current = false;
    requestAnimationFrame(() => returnFocus.current?.focus());
  }, []);
  const send = useCallback(
    (type: string, extra: Record<string, unknown> = {}) =>
      iframe.current?.contentWindow?.postMessage({ type, ...extra }, "*"),
    [],
  );
  useEffect(() => {
    function message(event: MessageEvent) {
      if (
        !iframe.current ||
        event.source !== iframe.current.contentWindow ||
        event.data?.type !== "lh:plot3d-view"
      )
        return;
      switch (event.data.event) {
        case "ready":
          setPhase("ready");
          send("lh:plot3d-configure", { expanded: isExpanded.current });
          break;
        case "error":
          setError(String(event.data.error || "3D viewer failed"));
          setPhase("error");
          close();
          break;
        case "escape":
          close();
          break;
        case "input":
          noteStudyInput();
          break;
        case "blur":
          checkStudyFocus();
          break;
      }
    }
    window.addEventListener("message", message);
    return () => window.removeEventListener("message", message);
  }, [close, send]);
  useEffect(() => {
    if (phase !== "loading") return;
    const timer = setTimeout(() => {
      setError(
        "The 3D viewer did not become ready. The verified preview is still available.",
      );
      setPhase("error");
    }, PLOT3D_DEADLINE_MS);
    return () => clearTimeout(timer);
  }, [phase, generation]);
  useEffect(() => {
    if (!expanded) return;
    const scope = placeholder.current?.closest<HTMLElement>(
      "[data-session-artifact-scope]",
    );
    function measure() {
      const r = scope?.getBoundingClientRect();
      setBounds(
        r
          ? {
              left: Math.max(0, r.left),
              top: Math.max(0, r.top),
              width: Math.min(r.width, window.innerWidth - r.left),
              height: Math.min(r.height, window.innerHeight - r.top),
            }
          : {
              left: 0,
              top: 0,
              width: window.innerWidth,
              height: window.innerHeight,
            },
      );
    }
    measure();
    const observer = new ResizeObserver(measure);
    if (scope) observer.observe(scope);
    window.addEventListener("resize", measure);
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      if (event.key === "Tab") {
        const nodes = Array.from(
          wrapper.current?.querySelectorAll<HTMLElement>(
            "button:not([disabled]),iframe",
          ) ?? [],
        );
        const first = nodes[0],
          last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    window.addEventListener("keydown", key);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("keydown", key);
    };
  }, [expanded, close]);
  useEffect(() => {
    if (phase === "ready") send("lh:plot3d-configure", { expanded });
  }, [expanded, phase, send]);
  function activate() {
    setError("");
    setGeneration((n) => n + 1);
    setPhase("loading");
  }
  function expand() {
    inlineHeight.current = wrapper.current?.getBoundingClientRect().height ?? 0;
    returnFocus.current = document.activeElement as HTMLElement;
    isExpanded.current = true;
    setExpanded(true);
    requestAnimationFrame(() =>
      wrapper.current
        ?.querySelector<HTMLButtonElement>("[data-plot3d-close]")
        ?.focus(),
    );
  }
  function invert(next: boolean) {
    setInverted(next);
    if (actions?.chatId && messageId)
      void fetch(`/api/chats/${actions.chatId}/artifact-ui`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { messageId, inverted: next } }),
      }).catch(() => {});
  }
  function downloadPng() {
    const bytes = Uint8Array.from(atob(result.preview.dataUrl.slice(22)), (c) =>
      c.charCodeAt(0),
    );
    downloadFile(`${slugFilename(result.title)}.png`, bytes, "image/png");
  }
  const active = phase === "loading" || phase === "ready";
  const style: CSSProperties = expanded
    ? {
        position: "fixed",
        zIndex: 40,
        left: bounds?.left ?? 0,
        top: bounds?.top ?? 0,
        width: bounds?.width ?? "100vw",
        height: bounds?.height ?? "100vh",
        padding: 16,
      }
    : {};
  const filter = inverted ? "invert(1) hue-rotate(180deg)" : undefined;
  return (
    <div
      ref={placeholder}
      className="my-4 w-full"
      style={expanded ? { height: inlineHeight.current } : undefined}
      data-testid="interactive-plot-card"
      data-phase={phase}
    >
      <div
        ref={wrapper}
        className="flex w-full flex-col rounded-lg bg-background"
        style={style}
        role={expanded ? "dialog" : undefined}
        aria-modal={expanded ? true : undefined}
        aria-label={expanded ? result.title : undefined}
        data-plot3d-expanded={expanded}
      >
        <div
          className="relative min-h-0 w-full overflow-hidden rounded-lg bg-white"
          style={expanded ? { flex: 1 } : { aspectRatio: "900 / 650" }}
        >
          {active && (
            <iframe
              key={generation}
              ref={iframe}
              title={`Interactive 3D: ${result.title}`}
              sandbox="allow-scripts"
              srcDoc={srcDoc}
              scrolling="no"
              className="absolute inset-0 h-full w-full border-0"
              style={{ filter }}
              data-testid="plot3d-iframe"
            />
          )}
          {phase !== "ready" && (
            <img
              src={result.preview.dataUrl}
              width={900}
              height={650}
              alt={result.title}
              className="absolute inset-0 h-full w-full object-contain"
              style={{ filter }}
              data-testid="plot3d-preview"
            />
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="font-medium uppercase tracking-wide">3D plot</span>
          <div className="flex flex-wrap items-center gap-3">
            {phase === "preview" && (
              <button type="button" onClick={activate}>
                Interact
              </button>
            )}
            {phase === "loading" && <span role="status">Loading 3D…</span>}
            {phase === "error" && (
              <button type="button" onClick={activate}>
                Retry
              </button>
            )}
            {phase === "ready" && (
              <>
                <button type="button" onClick={() => send("lh:plot3d-reset")}>
                  Reset view
                </button>
                {expanded ? (
                  <button type="button" onClick={close} data-plot3d-close>
                    Close
                  </button>
                ) : (
                  <button type="button" onClick={expand}>
                    Expand
                  </button>
                )}
              </>
            )}
            <Toggle
              checked={inverted}
              onChange={invert}
              label="Invert plot brightness"
              title="Invert colors"
              discIcon={<InvertDiscIcon className="size-3" />}
            />
            <button
              type="button"
              aria-label="Download plot as HTML"
              onClick={() =>
                downloadFile(
                  `${slugFilename(result.title)}.html`,
                  result.html,
                  "text/html",
                )
              }
            >
              HTML
            </button>
            <button
              type="button"
              aria-label="Download plot as PNG"
              onClick={downloadPng}
            >
              PNG
            </button>
          </div>
        </div>
        {phase === "error" && (
          <p role="alert" className="mt-2 text-sm text-muted-foreground">
            Interactive view unavailable: {error} Showing the verified static
            preview.
          </p>
        )}
      </div>
    </div>
  );
}
