export function createRealtimeTopic(baseTopic: string) {
  const cryptoApi = globalThis.crypto;
  const suffix =
    cryptoApi && typeof cryptoApi.randomUUID === 'function'
      ? cryptoApi.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${baseTopic}:${suffix}`;
}
