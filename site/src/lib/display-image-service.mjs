import sharp from "sharp";
import sharpService from "astro/assets/services/sharp";

export default {
  ...sharpService,
  propertiesToHash: ["src", "width", "height", "format", "quality", "fit", "position", "background", "firstFrame"],
  getURL(options, config) {
    const url = sharpService.getURL(options, config);
    return options.firstFrame ? `${url}&firstFrame=1` : url;
  },
  parseURL(url, config) {
    const options = sharpService.parseURL(url, config);
    return options && { ...options, firstFrame: url.searchParams.get("firstFrame") === "1" };
  },
  async transform(input, options, config) {
    // Posters have a separate cache identity; never replace the animated asset.
    if (options.firstFrame) {
      const poster = await sharp(input, { pages: 1 }).rotate().png().toBuffer();
      return sharpService.transform(poster, options, config);
    }
    // Astro defaults GIF→WebP to infinite looping; retain the source loop count.
    const metadata = await sharp(input, { animated: true }).metadata();
    const webp = metadata.format === "gif" && metadata.loop !== undefined
      ? { ...config.service.config.webp, loop: metadata.loop }
      : config.service.config.webp;
    return sharpService.transform(input, options, {
      ...config,
      service: { ...config.service, config: { ...config.service.config, webp } },
    });
  },
};
