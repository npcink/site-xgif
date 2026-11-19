export function cardImageSizes(layout) {
  if (layout === "home") return "(max-width: 600px) calc(100vw - 34px), (max-width: 700px) calc(90vw - 2px), calc(min(45vw, 600px) - 12px)";
  const containerThird = layout === "search" ? "400px" : "440px";
  return `(max-width: 600px) calc(90vw - 2px), (max-width: 900px) calc(45vw - 12px), calc(min(33.333vw, ${containerThird}) - 3.333vw - 15.334px)`;
}
