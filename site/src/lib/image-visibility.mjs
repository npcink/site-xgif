/** @param {{ data: { draft: boolean, public: boolean } }} entry */
export function isPublicImage({ data }) {
  return !data.draft && data.public;
}
