export function stripPrivate(text: string): string {
  return text.replace(/<private>[\s\S]*?<\/private>/gi, "[REDACTED]");
}

export function findSecret(text: string, patterns: string[]): string | null {
  for (const p of patterns) {
    try {
      const re = new RegExp(p);
      if (re.test(text)) return p;
    } catch {
      // ignore malformed regex
    }
  }
  return null;
}

export function redact(
  text: string,
  patterns: string[],
): { content: string; hadSecret: boolean; matchedPattern: string | null } {
  const stripped = stripPrivate(text);
  const matched = findSecret(stripped, patterns);
  return { content: stripped, hadSecret: matched !== null, matchedPattern: matched };
}
