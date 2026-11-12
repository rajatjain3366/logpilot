// The Node.js versions LogPilot supports. Exclude patterns use path.matchesGlob, which Node marked
// stable in 22.20.0 (Node 22) and 24.8.0 (Node 24); before that it was experimental or missing.

/** Why LogPilot cannot run on this Node.js version, or undefined if it can. */
export function unsupportedNodeVersion(version: string): string | undefined {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  const supported = (major === 22 && minor >= 20) || (major === 24 && minor >= 8) || major >= 25;
  return supported ? undefined : `LogPilot needs Node.js 22.20 or newer (on Node 24: 24.8 or newer); this is Node.js ${version}`;
}
