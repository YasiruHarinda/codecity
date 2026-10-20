/**
 * Comment removal, so commented-out imports are not counted.
 *
 * Each regex matches, left to right, EITHER a string literal (group 1) OR a comment.
 * Matching strings too is what stops `"http://x"` from being treated as a `//` comment.
 * Removed block comments keep their newlines, so line-based patterns (like C#'s `using`) still line up.
 */

// "..."  '...'  `...`  |  /* ... */  |  // ...
const C_STYLE = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

// """...""" and '''...''' (group 1)  |  "..."  '...' (group 2)  |  # ...
const PYTHON_STYLE = /("""[\s\S]*?"""|'''[\s\S]*?''')|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|#[^\n]*/g;

const onlyNewlines = (text: string) => text.replace(/[^\n]/g, "");

/**
 * For JavaScript, TypeScript and C#.
 * @param keepStrings false replaces every string with "" (useful when we only want code words)
 */
export function stripCStyleComments(source: string, keepStrings = true): string {
  return source.replace(C_STYLE, (match, string: string | undefined) => {
    if (string !== undefined) return keepStrings ? string : '""';
    return onlyNewlines(match);
  });
}

/** For Python. Triple-quoted strings (docstrings) are removed too: they often contain example code. */
export function stripPythonComments(source: string): string {
  return source.replace(PYTHON_STYLE, (match, tripleQuoted: string | undefined, string: string | undefined) => {
    if (string !== undefined) return string;
    return onlyNewlines(match); // comment or docstring
  });
}
