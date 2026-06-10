/**
 * Strip a `data:image/...;base64,` prefix if present and return the raw base64
 * payload. Inputs that are already bare base64 (no `data:` prefix) are returned
 * unchanged.
 *
 * Shared by the preprocessing step and every provider that needs the raw
 * base64 bytes without the data-URL wrapper.
 */
export function stripDataUrlPrefix(input: string): string {
  const comma = input.indexOf(",");
  if (input.startsWith("data:") && comma !== -1) {
    return input.slice(comma + 1);
  }
  return input;
}
