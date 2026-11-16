import assert from "node:assert/strict";
import test from "node:test";
import { imageMediaType, mediaFilterValues } from "../src/lib/image-media.mjs";

test("media types follow actual member metadata rather than filename extensions", () => {
  assert.equal(imageMediaType({ image: "/animated.webp", animated: true }), "animated");
  assert.equal(imageMediaType({ image: "/still.gif", animated: false }), "static");
  assert.equal(imageMediaType({ image: "/unverified.webp" }), "unknown");
  const mixed = { images: [{ src: "/one.jpg", animated: false }, { src: "/two.webp", animated: true }] };
  assert.equal(imageMediaType(mixed), "mixed");
  assert.equal(mediaFilterValues(mixed), "static animated");
  assert.equal(imageMediaType({ images: [{ src: "/one.jpg" }, { src: "/two.webp", animated: true }] }), "unknown");
});
