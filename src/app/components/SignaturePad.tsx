import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Icon } from '../../components/Icon';

/** Longueur de tracé minimale (px CSS) pour accepter une signature. */
export const MIN_SIGNATURE_LENGTH = 120;

/**
 * Zone de signature au doigt (ou à la souris). Le tracé est rendu sur un
 * canvas à la densité de l'écran et exporté en PNG (data URL) quand il est
 * assez long ; `onChange(null)` tant qu'il ne l'est pas.
 */
export function SignaturePad({ onChange, label }: { onChange: (png: string | null) => void; label: string }): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const length = useRef(0);
  const [empty, setEmpty] = useState(true);

  const setup = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#141414';
  }, []);

  useEffect(() => {
    setup();
  }, [setup]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return;
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    length.current += Math.hypot(p.x - last.current.x, p.y - last.current.y);
    last.current = p;
  }

  function up(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const ok = length.current >= MIN_SIGNATURE_LENGTH;
    setEmpty(length.current === 0);
    onChange(ok ? e.currentTarget.toDataURL('image/png') : null);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    length.current = 0;
    setEmpty(true);
    onChange(null);
  }

  return (
    <div className="sigpad">
      <canvas
        ref={canvasRef}
        className="sigpad-canvas"
        aria-label={label}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        data-testid="signature-pad"
      />
      {empty ? (
        <span className="sigpad-hint" aria-hidden="true">
          <Icon name="signature" />
          Signez ici avec le doigt
        </span>
      ) : null}
      <button type="button" className="btn btn-ghost btn-sm sigpad-clear" onClick={clear} disabled={empty}>
        Effacer
      </button>
    </div>
  );
}
