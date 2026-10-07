import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Pos } from "./App";

/**
 * What a guest's booking QR code holds: "ZYRES:" and the booking number
 * (BookingPage.tsx). A number typed or scanned bare is taken as well.
 */
export function bookingReferenceFrom(text: string): string | null {
  const value = text.trim().toUpperCase().replace(/^ZYRES:/, "").replace(/\s+/g, "");
  return /^[A-Z0-9]{4,12}$/.test(value) ? value : null;
}

/** What a code read at the door is: a booking to check in, or a member's code ("ZYMEM:" and their account) for the first visit's points. */
export type Scanned = { kind: "booking"; reference: string } | { kind: "member"; id: string };

export function scannedFrom(text: string): Scanned | null {
  const member = /^ZYMEM:([A-Za-z0-9-]{8,64})$/.exec(text.trim());
  if (member) return { kind: "member", id: member[1]! };
  const reference = bookingReferenceFrom(text);
  return reference ? { kind: "booking", reference } : null;
}

type Detect = (video: HTMLVideoElement) => Promise<string | null>;

/** The browser's own barcode reader where it has one (Chrome on Android); jsQR otherwise. */
async function detector(): Promise<Detect> {
  const Native = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
  if (Native) {
    const reader = new Native({ formats: ["qr_code"] });
    return async (video) => (await reader.detect(video))[0]?.rawValue ?? null;
  }
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    if (!context || !video.videoWidth) return null;
    // A third of full size reads a phone screen's QR code and costs a ninth.
    const scale = Math.min(1, 480 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data ?? null;
  };
}

/**
 * Checking a booking in at the door: the camera reads the QR code on the
 * guest's phone, or the waiter types the booking number under it. Either way
 * the number goes to `onFound`; the floor does the rest. A member's code
 * (the booking page shows it to a guest short of points) goes there too.
 */
export function BookingScanner({ pos, onFound, onClose }: { pos: Pos; onFound: (scanned: Scanned) => void; onClose: () => void }) {
  const { t } = pos;
  const video = useRef<HTMLVideoElement>(null);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [typed, setTyped] = useState("");
  const found = useRef(false);
  // The latest handler, without restarting the camera when the floor re-renders.
  const handler = useRef(onFound);
  handler.current = onFound;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped) return;
        const element = video.current;
        if (!element) return;
        element.srcObject = stream;
        await element.play();
        const read = await detector();
        const tick = async () => {
          if (stopped || found.current) return;
          const text = await read(element).catch(() => null);
          const scanned = text ? scannedFrom(text) : null;
          if (scanned && !found.current) {
            found.current = true;
            navigator.vibrate?.(60);
            handler.current(scanned);
            return;
          }
          frame = window.setTimeout(() => void tick(), 180);
        };
        void tick();
      } catch {
        if (!stopped) setCameraFailed(true);
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const reference = bookingReferenceFrom(typed);
    if (reference) onFound({ kind: "booking", reference });
  }

  return <div className="pos-scan" role="dialog" aria-modal="true" aria-label={t("scanBooking")} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="pos-scan-card">
      <header>
        <h2>{t("scanBooking")}</h2>
        <button type="button" className="pos-quiet" onClick={onClose} aria-label={t("close")}>×</button>
      </header>
      {cameraFailed
        ? <p className="pos-scan-note">{t("scanNoCamera")}</p>
        : <div className="pos-scan-view"><video ref={video} muted playsInline /><i aria-hidden="true" /></div>}
      {!cameraFailed && <p className="pos-scan-note">{t("scanHint")}</p>}
      <form className="pos-scan-manual" onSubmit={submit}>
        <input id="posScanReference" value={typed} onChange={(event) => setTyped(event.target.value.toUpperCase())} placeholder={t("scanTypeReference")}
          autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={14} aria-label={t("scanTypeReference")} />
        <button type="submit" className="pos-primary" disabled={!bookingReferenceFrom(typed)}>{t("scanCheckIn")}</button>
      </form>
    </section>
  </div>;
}
