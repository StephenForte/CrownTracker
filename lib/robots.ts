/**
 * Match a robots.txt path rule without compiling the rule as a regular
 * expression. Robots rules support `*` as a wildcard and a terminal `$` as an
 * end-of-path anchor; every other character is literal.
 */
export function matchesRobotsPath(pattern: string, path: string) {
  const anchoredAtEnd = pattern.endsWith("$");
  const rule = anchoredAtEnd ? pattern.slice(0, -1) : pattern;
  const segments = rule.split("*");
  let offset = 0;
  let segmentIndex = 0;

  if (!rule.startsWith("*")) {
    const first = segments[0];
    if (!path.startsWith(first)) return false;
    offset = first.length;
    segmentIndex = 1;
  }

  for (; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    if (!segment) continue;
    const position = path.indexOf(segment, offset);
    if (position === -1) return false;
    offset = position + segment.length;
  }

  return !anchoredAtEnd || rule.endsWith("*") || offset === path.length;
}
