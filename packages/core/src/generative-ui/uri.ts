const URI_SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:/;
const INVALID_PERCENT_ESCAPE = /%(?![\dA-Fa-f]{2})/;

export function isCatalogUri(value: string): boolean {
  if (!URI_SCHEME.test(value) || /\s/.test(value) || INVALID_PERCENT_ESCAPE.test(value)) {
    return false;
  }
  const schemeEnd = value.indexOf(":");
  if (schemeEnd === value.length - 1) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
