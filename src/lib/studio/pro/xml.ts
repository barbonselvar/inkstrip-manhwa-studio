/** XML1.0 cannot encode nulls, lone surrogates or prohibited control characters.
 * Reject explicitly at export instead of changing the editable source text.
 */
export function escapeXml(value: string) {
  for (const char of value) {
    const cp = char.codePointAt(0)!;
    if (
      (cp < 32 && cp !== 9 && cp !== 10 && cp !== 13) ||
      (cp >= 0xd800 && cp <= 0xdfff) ||
      cp === 0xfffe ||
      cp === 0xffff
    )
      throw Error(
        "SVG cannot encode an invalid Unicode/control character in this document. Correct the text or use native/PNG export; source data was not changed.",
      );
  }
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
}
