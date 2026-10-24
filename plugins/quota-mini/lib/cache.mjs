export function createQuotaCache(read, { now = Date.now, ttlMs = 30000, retryMs = 30000 } = {}) {
  let snapshot = null;
  let attemptedAt = -Infinity;
  let failed = null;
  let pending = null;
  return async function getQuota() {
    const age = now() - attemptedAt;
    if (age < (failed ? retryMs : ttlMs)) {
      if (failed) return { ...(snapshot ?? {}), status: snapshot ? 'stale' : 'error', message: failed };
      if (snapshot) return snapshot;
    }
    if (pending) return pending;
    pending = (async () => {
      attemptedAt = now();
      try {
        snapshot = await read();
        failed = null;
        return snapshot;
      } catch (error) {
        // Only our fixed user-facing messages are allowed across the UI boundary.
        failed = error?.name === 'QuotaError' ? error.message : '暂时无法读取额度，稍后会自动重试。';
        return { ...(snapshot ?? {}), status: snapshot ? 'stale' : 'error', message: failed };
      } finally { pending = null; }
    })();
    return pending;
  };
}
