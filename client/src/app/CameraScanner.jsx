import { useEffect, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { Modal } from "./ui.jsx";

/*
 * Camera barcode scanner. Needs https or localhost (browser rule for cameras).
 * - Asks for the back camera on phones/tablets and HD resolution (thin barcode lines need detail).
 * - Uses the browser's built-in BarcodeDetector when it exists (Android, macOS — fast and accurate),
 *   otherwise ZXing limited to shop barcode types with "try harder".
 * - Camera picker (remembered), beep + vibration on success, and a box to type the code by hand.
 */
const SCAN_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];
const CAMERA_KEY = "faatix.scanCamera";

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1400; gain.gain.value = 0.12;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => ctx.close();
  } catch { /* sound is optional */ }
  try { navigator.vibrate?.(80); } catch { /* optional */ }
}

export default function CameraScanner({ onCode, onClose }) {
  const { t } = useLanguage();
  const videoRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [cameraId, setCameraId] = useState(() => { try { return localStorage.getItem(CAMERA_KEY) || ""; } catch { return ""; } });
  const [manual, setManual] = useState("");

  useEffect(() => {
    let stopped = false;
    let stream = null;
    let controls = null;
    let raf = 0;
    const done = (text) => {
      if (stopped) return;
      stopped = true;
      beep();
      onCode(String(text).trim());
    };
    const video = { width: { ideal: 1920 }, height: { ideal: 1080 }, ...(cameraId ? { deviceId: { exact: cameraId } } : { facingMode: { ideal: "environment" } }) };

    (async () => {
      try {
        const native = "BarcodeDetector" in window
          ? (await window.BarcodeDetector.getSupportedFormats().catch(() => [])).filter((f) => SCAN_FORMATS.includes(f))
          : [];
        if (native.length) {
          // Built-in detector: our own camera stream + a detection loop.
          stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
          if (stopped) return;
          const el = videoRef.current;
          el.srcObject = stream;
          await el.play();
          const detector = new window.BarcodeDetector({ formats: native });
          const loop = async () => {
            if (stopped) return;
            try {
              const found = await detector.detect(el);
              if (found[0]?.rawValue) return done(found[0].rawValue);
            } catch { /* frame not ready */ }
            raf = requestAnimationFrame(loop);
          };
          loop();
        } else {
          // ZXing fallback (e.g. Chrome / Edge on Windows).
          const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
            BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.QR_CODE]);
          hints.set(DecodeHintType.TRY_HARDER, true);
          const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 });
          controls = await reader.decodeFromConstraints({ video, audio: false }, videoRef.current, (result) => {
            if (result) { controls?.stop(); done(result.getText()); }
          });
          if (stopped) controls.stop();
        }
        // After permission is granted the camera names are readable: offer a picker.
        const { BrowserCodeReader } = await import("@zxing/browser");
        const list = await BrowserCodeReader.listVideoInputDevices().catch(() => []);
        if (!stopped) setCameras(list);
      } catch {
        if (!stopped) setFailed(true);
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      controls?.stop();
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [onCode, cameraId]);

  const pickCamera = (id) => {
    try { if (id) localStorage.setItem(CAMERA_KEY, id); else localStorage.removeItem(CAMERA_KEY); } catch { /* optional */ }
    setFailed(false);
    setCameraId(id);
  };

  return (
    <Modal title={t("ui.pos.scanTitle")} onClose={onClose}>
      <div className="camera">
        {failed ? <p className="form-status form-status--error" role="alert">{t("ui.pos.scanNoCamera")}</p> : (
          <div className="camera__view">
            <video ref={videoRef} className="camera__video" muted playsInline autoPlay />
            <span className="camera__frame" aria-hidden="true" />
            <span className="camera__laser" aria-hidden="true" />
          </div>
        )}
        {cameras.length > 1 && (
          <label className="camera__pick">
            <span>{t("ui.pos.scanCamera")}</span>
            <select className="input" value={cameraId} onChange={(e) => pickCamera(e.target.value)}>
              <option value="">{t("ui.pos.scanAuto")}</option>
              {cameras.map((c, i) => <option key={c.deviceId} value={c.deviceId}>{c.label || `${t("ui.pos.scanCamera")} ${i + 1}`}</option>)}
            </select>
          </label>
        )}
        <p className="camera__tips"><Icon name="info" />{t("ui.pos.scanTips")}</p>
        <form className="camera__manual" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) onCode(manual.trim()); }}>
          <input className="input" value={manual} onChange={(e) => setManual(e.target.value)} placeholder={t("ui.pos.scanManual")} aria-label={t("ui.pos.scanManual")} inputMode="numeric" />
          <button type="submit" className="btn btn--primary" disabled={!manual.trim()}>{t("ui.common.add")}</button>
        </form>
      </div>
    </Modal>
  );
}
