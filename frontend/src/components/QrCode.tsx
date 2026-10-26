import { useMemo } from "react";
import qrcode from "qrcode-generator";

/** QR code rendered locally as SVG (nothing leaves the browser). */
export default function QrCode({ value, label, size = 168 }: { value: string; label: string; size?: number }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value, "Byte");
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [value]);
  return <div className="qr" role="img" aria-label={label} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
