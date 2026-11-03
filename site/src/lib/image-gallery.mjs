export const MAX_GALLERY_IMAGES = 12;

/** Read legacy single images and ordered galleries through the same interface. */
export function galleryImages(data) {
  if (Array.isArray(data.images) && data.images.length) return data.images.filter((image) => image && typeof image.src === "string");
  return data.image ? [{ src: data.image, width: data.width, height: data.height, altText: data.altText }] : [];
}

export function validateGalleryImages(images) {
  const fail = (message) => { throw Object.assign(new Error(message), { statusCode: 422 }); };
  if (!Array.isArray(images) || images.length < 1 || images.length > MAX_GALLERY_IMAGES) {
    fail(`图集需要 1 至 ${MAX_GALLERY_IMAGES} 张图片。`);
  }
  const seen = new Set();
  return images.map((image) => {
    const src = image?.src;
    if (typeof src !== "string" || !(src.startsWith("/images/") || /^https?:\/\//u.test(src))) {
      fail("图集图片地址无效。");
    }
    if (seen.has(src)) fail("图集中不能包含重复图片。");
    seen.add(src);
    return {
      src,
      ...(Number.isInteger(image.width) && image.width > 0 ? { width: image.width } : {}),
      ...(Number.isInteger(image.height) && image.height > 0 ? { height: image.height } : {}),
      ...(typeof image.altText === "string" ? { altText: image.altText.trim().slice(0, 160) } : {}),
    };
  });
}
