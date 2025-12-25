import { createHash } from 'crypto';

export function computeKeyFingerprint(apiKey: string): string {
  const hash = createHash('sha256').update(apiKey).digest('hex');
  return `${hash.slice(0, 6)}…${hash.slice(-6)}`;
}
