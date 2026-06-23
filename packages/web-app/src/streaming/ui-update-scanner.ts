export class UiUpdateScanner {
  readonly #bufferParts: string[] = [];
  #activeObjectStart = -1;
  #cursor = 0;
  #depth = 0;
  #escape = false;
  #inString = false;
  #insideUpdatesArray = false;
  #searchStart = 0;

  push(chunk: string): unknown[] {
    this.#bufferParts.push(chunk);
    const buffer = this.#bufferParts.join("");
    const updates: unknown[] = [];

    if (!this.#insideUpdatesArray) {
      const markerIndex = buffer.indexOf('"updates"', this.#searchStart);
      if (markerIndex === -1) {
        this.#searchStart = Math.max(0, buffer.length - '"updates"'.length);
        return updates;
      }

      const arrayStart = buffer.indexOf("[", markerIndex + '"updates"'.length);
      if (arrayStart === -1) {
        this.#searchStart = markerIndex;
        return updates;
      }

      this.#insideUpdatesArray = true;
      this.#cursor = arrayStart + 1;
    }

    for (; this.#cursor < buffer.length; this.#cursor += 1) {
      const char = buffer[this.#cursor];

      if (this.#activeObjectStart === -1) {
        if (char === "]") {
          this.#insideUpdatesArray = false;
          this.#cursor += 1;
          break;
        }
        if (char === "{") {
          this.#activeObjectStart = this.#cursor;
          this.#depth = 1;
          this.#inString = false;
          this.#escape = false;
        }
        continue;
      }

      if (this.#inString) {
        if (this.#escape) {
          this.#escape = false;
          continue;
        }
        if (char === "\\") {
          this.#escape = true;
          continue;
        }
        if (char === '"') {
          this.#inString = false;
        }
        continue;
      }

      if (char === '"') {
        this.#inString = true;
        continue;
      }

      if (char === "{") {
        this.#depth += 1;
        continue;
      }

      if (char === "}") {
        this.#depth -= 1;
        if (this.#depth === 0) {
          const objectText = buffer.slice(this.#activeObjectStart, this.#cursor + 1);
          updates.push(JSON.parse(objectText));
          this.#activeObjectStart = -1;
        }
      }
    }

    return updates;
  }
}

export function extractEnvelopeUpdates(text: string): unknown[] {
  const scanner = new UiUpdateScanner();
  return scanner.push(text);
}
