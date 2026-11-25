export function cardImageSizes(layout) {
  if (layout === "recommendation") return "(max-width: 480px) 45vw, 240px";
  if (layout === "home") return "(max-width: 519px) calc(100vw - 32px), (max-width: 600px) calc(50vw - 26px), calc(min(45vw, 600px) - 10px)";
  const containerThird = layout === "search" ? "400px" : "440px";
  return `(max-width: 600px) calc(100vw - 32px), (max-width: 900px) calc(45vw - 8px), calc(min(33.333vw, ${containerThird}) - 3.333vw - 10.667px)`;
}
