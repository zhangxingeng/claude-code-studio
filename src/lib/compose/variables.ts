/**
 * The variable grammar + copy-output builder. As of v0.13 this is the ONE AND
 * ONLY implementation — the Rust half (`prompts/grammar.rs`) is deleted, because
 * after the schema cut nothing in the backend parses variables. There is no
 * second implementation to drift from, and so no cross-language vector table to
 * keep in sync; the vectors live in tests/prompts_smoke.mjs, one copy.
 *
 * That also means there is no safety net: nothing else will catch a mistake in
 * here. The rules are kept deliberately few so the whole grammar fits in a
 * reader's head.
 *
 * ── The grammar ──────────────────────────────────────────────────────────────
 *
 *   1. `{name}` is a variable, where name is [A-Za-z0-9_-]+ (case-sensitive).
 *      That is the WHOLE variable syntax. Every variable is a string.
 *   2. `{{` emits a literal `{`; `}}` emits a literal `}`.
 *   3. Any other braced run is prose, verbatim. `{task:write tests}` (the
 *      removed default form), `{my var}`, `{:x}`, `{a.b}`, `{"json": 1}` all
 *      stay literal — they simply fail rule 1's name test. Degrading a dropped
 *      form to visible literal text is deliberate: the user SEES the stray text
 *      and fixes it, where a silent reinterpretation would quietly swallow the
 *      default they wrote.
 *   4. One name = one variable, document-wide. First-appearance order; repeats
 *      dedupe. The model cannot tell two identically-named variables apart, so
 *      pretending they differ would be a fiction the UI maintains and the
 *      output discards.
 *   5. An unfilled variable resolves to the literal sentinel
 *      `variable not set, ask user for it` — in BOTH copy modes. A forgotten
 *      variable therefore still produces a working prompt: the model asks,
 *      rather than silently receiving a blank or a stray `{placeholder}`.
 *
 * ── Code is verbatim ─────────────────────────────────────────────────────────
 *
 * Inside a fenced code block (``` …) or an inline code span (` … `), NOTHING is
 * interpreted: no variables are parsed AND no escapes are resolved. The text
 * passes through byte for byte.
 *
 * Both halves of that rule are load-bearing, and the escape half is the subtle
 * one. A dev prompt library is full of code samples, and code is full of braces:
 * a Rust `format!("{name}")`, a JS object literal, a Handlebars `{{name}}`. If
 * escapes still resolved inside a fence, a fenced `{{name}}` would copy out as
 * `{name}` — silently corrupting the exact characters the user typed, in a way
 * they could never guess the cause of. Verbatim means verbatim, no exceptions,
 * which is also the only version of the rule anyone can hold in their head while
 * reading this scanner.
 *
 * Outside code, `{{`/`}}` remain the manual escape for a literal brace.
 */

/** What an unfilled variable becomes on copy, in both modes (rule 5). */
export const UNSET_VALUE = 'variable not set, ask user for it';

/** One distinct variable: a name, and nothing else. Every variable is a string,
 *  and none carries a default — they all collapsed into UNSET_VALUE. */
export interface Variable {
  name: string;
}

/** A lexed run. A `literal` token is ready to emit: escapes are already resolved
 *  for prose runs and deliberately NOT resolved for code runs, so by the time a
 *  token exists the verbatim rule has been applied and nothing downstream needs
 *  to know which kind of run it came from. */
type Token = { kind: 'literal'; text: string } | { kind: 'variable'; name: string };

/** A variable at the start of the slice. The absence of any `:` branch is what
 *  makes `{task:write tests}` fall through to prose (rule 3) — the removed
 *  default form needs no special case, it simply fails to match. */
const VAR_AT = /^\{([A-Za-z0-9_-]+)\}/;

/** Opens a fenced block: 3+ backticks, optionally indented (an info string such
 *  as ```rust may follow). */
const FENCE_OPEN = /^[ \t]*(`{3,})/;
/** Closes it: 3+ backticks and nothing else on the line. Demanding a bare line
 *  is what stops a ```-prefixed line *inside* a block (rare, but it happens in
 *  docs that are about Markdown) from closing it early. */
const FENCE_CLOSE = /^[ \t]*(`{3,})[ \t]*$/;

interface Segment {
  /** true = verbatim code; nothing inside is interpreted. */
  code: boolean;
  text: string;
}

/**
 * Split into fenced-code runs and prose runs, preserving every byte — the
 * concatenation of the segments always reconstructs the input exactly.
 *
 * An unterminated fence runs to the end of the document rather than being
 * abandoned. A half-typed code block must not expose its braces to the parser
 * mid-keystroke, which would make variables flicker into and out of existence
 * as the user types their way toward the closing fence.
 */
function splitFences(text: string): Segment[] {
  const segments: Segment[] = [];
  let lineStart = 0;
  let runStart = 0;
  let fenceLen = 0; // 0 = not inside a fence

  while (lineStart <= text.length) {
    const nl = text.indexOf('\n', lineStart);
    const line = text.slice(lineStart, nl === -1 ? text.length : nl);

    if (fenceLen === 0) {
      const open = FENCE_OPEN.exec(line);
      if (open) {
        // Close the prose run that ran up to this line, then open the code run.
        if (lineStart > runStart) {
          segments.push({ code: false, text: text.slice(runStart, lineStart) });
        }
        runStart = lineStart;
        fenceLen = open[1].length;
      }
    } else {
      const close = FENCE_CLOSE.exec(line);
      if (close && close[1].length >= fenceLen) {
        // The closing fence line belongs to the code run.
        const end = nl === -1 ? text.length : nl + 1;
        segments.push({ code: true, text: text.slice(runStart, end) });
        runStart = end;
        fenceLen = 0;
        lineStart = end;
        continue;
      }
    }

    if (nl === -1) break;
    lineStart = nl + 1;
  }

  // The tail. `fenceLen > 0` here means the fence was never closed, so it stays
  // code all the way to the end of the document (see the doc comment).
  if (runStart < text.length) segments.push({ code: fenceLen > 0, text: text.slice(runStart) });
  return segments;
}

/** Index of a run of EXACTLY `n` backticks at or after `from`, else -1. A longer
 *  run is not a closer — that is how ``a`b`` carries a lone backtick — so we skip
 *  past a longer run wholesale rather than matching its prefix. */
function findBacktickRun(text: string, from: number, n: number): number {
  let i = from;
  while (i < text.length) {
    if (text[i] !== '`') {
      i++;
      continue;
    }
    let len = 0;
    while (text[i + len] === '`') len++;
    if (len === n) return i;
    i += len;
  }
  return -1;
}

/** Lex one prose run: inline code spans stay verbatim, escapes resolve,
 *  `{name}` becomes a variable, everything else is literal. */
function scanProse(text: string, tokens: Token[]): void {
  let literal = '';
  const flush = (): void => {
    if (literal) {
      tokens.push({ kind: 'literal', text: literal });
      literal = '';
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === '`') {
      let n = 0;
      while (text[i + n] === '`') n++;
      const closer = findBacktickRun(text, i + n, n);
      if (closer !== -1) {
        // Verbatim, delimiters included — the span reproduces exactly.
        flush();
        tokens.push({ kind: 'literal', text: text.slice(i, closer + n) });
        i = closer + n;
        continue;
      }
      // No closer: an unpaired backtick is ordinary prose, and scanning resumes
      // normally after it — a stray ` must not swallow the rest of the document.
      literal += text.slice(i, i + n);
      i += n;
      continue;
    }

    const pair = text.slice(i, i + 2);
    if (pair === '{{' || pair === '}}') {
      literal += ch; // `{{` → `{`, `}}` → `}` (an escape consumes both chars)
      i += 2;
      continue;
    }

    if (ch === '{') {
      const m = VAR_AT.exec(text.slice(i));
      if (m) {
        flush();
        tokens.push({ kind: 'variable', name: m[1] });
        i += m[0].length;
        continue;
      }
    }

    literal += ch;
    i++;
  }
  flush();
}

/** The token stream for a document: code verbatim, prose lexed. */
function scan(text: string): Token[] {
  const tokens: Token[] = [];
  for (const segment of splitFences(text)) {
    if (segment.code) tokens.push({ kind: 'literal', text: segment.text });
    else scanProse(segment.text, tokens);
  }
  return tokens;
}

/** Distinct variables in `text`, first-appearance order (rule 4). */
export function parseVariables(text: string): Variable[] {
  const seen = new Set<string>();
  const vars: Variable[] = [];
  for (const t of scan(text)) {
    if (t.kind === 'variable' && !seen.has(t.name)) {
      seen.add(t.name);
      vars.push({ name: t.name });
    }
  }
  return vars;
}

/** A variable's effective value. An empty input reads as untouched, so it
 *  resolves to the sentinel exactly as an absent one does (rule 5). There is
 *  deliberately no way to fill a variable with the empty string — to say
 *  nothing, delete the `{name}`. */
function resolve(name: string, fills: Record<string, string>): string {
  const filled = fills[name];
  return filled !== undefined && filled !== '' ? filled : UNSET_VALUE;
}

/** XML-escape a value interpolated into the <prompt_vars> block: the wrapper
 *  form exists to be parseable, and an unescaped value containing
 *  `</prompt_var>` would inject phantom variables into what the reading LLM
 *  sees. `&` first — escaping it later would re-escape the entities just
 *  produced. Names need no escaping: rule 1's name class is attribute-safe by
 *  construction. */
function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * The Copy Prompt output.
 *
 * As-variable is a PER-VARIABLE choice (`asVars`, keyed by name); a name absent
 * from the map is ON. ON is the safe default: emitting a variable as a reference
 * never breaks a prompt, while substituting unexpected data in place can
 * silently bloat it — so the user opts OUT per variable. One document may mix
 * modes freely.
 *
 * - ON  → every occurrence becomes `<prompt_var name="x"/>`, and one appended
 *         `<prompt_vars>` block carries the value once. Block values are
 *         XML-escaped. The block lists only the ON variables, in first-
 *         appearance order.
 * - OFF → every occurrence becomes the value verbatim, as plain text — never
 *         XML-escaped: it is prose the model reads, not markup it parses.
 *
 * An unfilled variable resolves to UNSET_VALUE in BOTH modes (rule 5). That is
 * what makes a forgotten variable degrade into a working prompt rather than a
 * blank or a stray literal, regardless of how the toggle happens to be set.
 */
export function copyText(
  text: string,
  fills: Record<string, string>,
  asVars: Record<string, boolean>
): string {
  // A name absent from `asVars` is ON — the safe default (see doc comment).
  const isOn = (name: string): boolean => asVars[name] !== false;

  const out: string[] = [];
  for (const t of scan(text)) {
    if (t.kind === 'literal') out.push(t.text);
    else if (isOn(t.name)) out.push(`<prompt_var name="${t.name}"/>`);
    else out.push(resolve(t.name, fills));
  }

  const onVars = parseVariables(text).filter((v) => isOn(v.name));
  if (onVars.length) {
    const entries = onVars.map(
      (v) => `<prompt_var name="${v.name}">${escapeXml(resolve(v.name, fills))}</prompt_var>`
    );
    out.push(`\n\n<prompt_vars>\n${entries.join('\n')}\n</prompt_vars>`);
  }
  return out.join('');
}
