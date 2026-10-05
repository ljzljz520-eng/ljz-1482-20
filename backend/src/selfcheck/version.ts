export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemVer(input: string): SemVer | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(input.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function isCompatible(clientRaw: string | undefined, min: string): boolean {
  if (!clientRaw) return false;
  const client = parseSemVer(clientRaw);
  const floor = parseSemVer(min);
  if (!client || !floor) return false;
  if (client.major !== floor.major) return client.major > floor.major;
  if (client.minor !== floor.minor) return client.minor > floor.minor;
  return client.patch >= floor.patch;
}
