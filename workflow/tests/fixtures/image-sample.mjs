import sharp from "sharp";

export async function sampleImage(alternative = false) {
  const svg = alternative
    ? '<svg width="320" height="320"><rect width="320" height="320" fill="#e5dcc1"/><path d="M0 30L300 280M20 0L320 280M0 80L240 320" stroke="#153b3d" stroke-width="22"/><circle cx="230" cy="55" r="45" fill="#bd462a"/></svg>'
    : '<svg width="320" height="320"><rect width="320" height="320" fill="#fff"/><rect x="15" y="30" width="110" height="260" fill="#123942"/><circle cx="225" cy="135" r="70" fill="#b33a28"/><path d="M130 270L290 270L180 195Z" fill="#6d9471"/></svg>';
  return sharp(Buffer.from(svg)).png().toBuffer();
}
