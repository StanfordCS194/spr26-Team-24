/**
 * Extract a single JSON object from a model response.
 *
 * Language models frequently wrap their JSON in markdown code fences
 * (```json … ```) or surround it with prose. This helper strips the fences,
 * locates the outermost `{ … }`, and parses it — the shared extraction logic
 * used by every stage of the classify pipeline so the parsing behavior stays
 * identical across providers.
 *
 * Type-specific validation (field coercion, `Array.isArray` guards, etc.) is
 * intentionally left to the caller: this returns the raw parsed object.
 *
 * @param raw - The model's text response, possibly fenced or padded with prose.
 * @param what - Noun used in the thrown error message (default `"model"`),
 *   e.g. `"observation"` to read "No JSON object in observation response".
 * @throws {SyntaxError} When no `{ … }` object can be located in `raw`.
 */
export function extractJsonObject<T>(raw: string, what = "model"): T {
  const text = raw
    .trim()
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new SyntaxError(`No JSON object in ${what} response`);
  }
  return JSON.parse(text.slice(start, end + 1)) as T;
}
