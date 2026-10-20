/**
 * Counts lines of code: every line that is not empty or only whitespace.
 * Handles Windows (\r\n), Unix (\n) and old Mac (\r) line endings.
 */
export function countLoc(text: string): number {
  let count = 0;
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.trim() !== "") count++;
  }
  return count;
}

/**
 * Guesses whether a file is binary (image, exe, zip...) by looking for a zero byte
 * in its first 8 KB. Text files almost never contain one; binary files almost always do.
 * This is the same trick git uses.
 */
export function isBinary(content: Buffer): boolean {
  return content.subarray(0, 8000).includes(0);
}
