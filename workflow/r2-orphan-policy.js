const DAY_MS = 24 * 60 * 60 * 1_000;

export function updateOrphanObservations({
  current = {},
  orphanRows = [],
  now = new Date(),
  minimumAgeDays = 30,
} = {}) {
  const nowIso = now.toISOString();
  const activeKeys = new Set(orphanRows.map((row) => row.objectKey).filter(Boolean));
  const observations = {};

  for (const row of orphanRows) {
    if (!row.objectKey) continue;
    const existing = current[row.objectKey];
    const firstSeenAt = existing?.firstSeenAt || nowIso;
    observations[row.objectKey] = {
      objectKey: row.objectKey,
      publicUrl: row.publicUrl,
      firstSeenAt,
      lastSeenAt: nowIso,
    };
  }

  const eligible = Object.values(observations)
    .filter((row) => activeKeys.has(row.objectKey))
    .filter((row) => now.getTime() - new Date(row.firstSeenAt).getTime() >= minimumAgeDays * DAY_MS)
    .sort((a, b) => a.objectKey.localeCompare(b.objectKey));

  return { observations, eligible, minimumAgeDays };
}
