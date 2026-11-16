import sharp from "sharp";
import sharpService from "astro/assets/services/sharp";

export default {
  ...sharpService,
  async transform(input, options, config) {
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
