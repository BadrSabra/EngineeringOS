/**
 * Safe condition evaluator for workflow phase advancement conditions.
 *
 * Replaces `new Function(...)` (audit finding R-001 / W-001) with a
 * whitelist-based recursive-descent parser/evaluator. Only a restricted
 * grammar is accepted:
 *
 *   Variables : qualityScore | currentPhase | completedPhases
 *   Properties: completedPhases.length
 *   Methods   : completedPhases.includes(string)
 *   Operators : >= | <= | > | < | === | !== | == | !=
 *   Logical   : && | || | !
 *   Literals  : number | string | boolean | null
 *   Grouping  : ( expr )
 *
 * Any token or construct outside this set causes an EvalError with a
 * descriptive message, making the failure mode explicit (→ HTTP 400) rather
 * than silently executing arbitrary server-side code.
 */

export interface ConditionContext {
  qualityScore: number | null;
  currentPhase: string;
  completedPhases: string[];
}

// ── Tokenizer ─────────────────────────────────────────────────────────────────

type Token =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "null" }
  | { kind: "ident"; name: string }
  | { kind: "dot" }
  | { kind: "comma" }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "op"; value: string }
  | { kind: "and" }
  | { kind: "or" }
  | { kind: "not" };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i++; continue; }

    // Three-char operators (must be checked before two-char)
    if (input.slice(i, i + 3) === "===") { tokens.push({ kind: "op", value: "===" }); i += 3; continue; }
    if (input.slice(i, i + 3) === "!==") { tokens.push({ kind: "op", value: "!==" }); i += 3; continue; }

    // Two-char operators
    if (input.slice(i, i + 2) === ">=") { tokens.push({ kind: "op", value: ">=" }); i += 2; continue; }
    if (input.slice(i, i + 2) === "<=") { tokens.push({ kind: "op", value: "<=" }); i += 2; continue; }
    if (input.slice(i, i + 2) === "==") { tokens.push({ kind: "op", value: "==" }); i += 2; continue; }
    if (input.slice(i, i + 2) === "!=") { tokens.push({ kind: "op", value: "!=" }); i += 2; continue; }
    if (input.slice(i, i + 2) === "&&") { tokens.push({ kind: "and" }); i += 2; continue; }
    if (input.slice(i, i + 2) === "||") { tokens.push({ kind: "or" }); i += 2; continue; }

    // Single-char tokens
    if (ch === ">") { tokens.push({ kind: "op", value: ">" }); i++; continue; }
    if (ch === "<") { tokens.push({ kind: "op", value: "<" }); i++; continue; }
    if (ch === "!") { tokens.push({ kind: "not" }); i++; continue; }
    if (ch === "(") { tokens.push({ kind: "lparen" }); i++; continue; }
    if (ch === ")") { tokens.push({ kind: "rparen" }); i++; continue; }
    if (ch === ".") { tokens.push({ kind: "dot" }); i++; continue; }
    if (ch === ",") { tokens.push({ kind: "comma" }); i++; continue; }

    // Number literal
    if (ch >= "0" && ch <= "9") {
      let num = "";
      while (i < input.length && ((input[i] >= "0" && input[i] <= "9") || input[i] === ".")) {
        num += input[i++];
      }
      const parsed = Number(num);
      if (isNaN(parsed)) throw new EvalError(`Invalid number literal: ${num}`);
      tokens.push({ kind: "num", value: parsed });
      continue;
    }

    // String literal (single or double quotes)
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let str = "";
      while (i < input.length && input[i] !== quote) {
        if (input[i] === "\\" && i + 1 < input.length) {
          i++;
          const esc = input[i++];
          if (esc === "n") str += "\n";
          else if (esc === "t") str += "\t";
          else str += esc;
        } else {
          str += input[i++];
        }
      }
      if (i >= input.length) throw new EvalError("Unterminated string literal");
      i++; // consume closing quote
      tokens.push({ kind: "str", value: str });
      continue;
    }

    // Identifier / keyword
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      let ident = "";
      while (i < input.length) {
        const c = input[i];
        if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_") {
          ident += c; i++;
        } else break;
      }
      if (ident === "true")  { tokens.push({ kind: "bool", value: true  }); continue; }
      if (ident === "false") { tokens.push({ kind: "bool", value: false }); continue; }
      if (ident === "null")  { tokens.push({ kind: "null" }); continue; }
      tokens.push({ kind: "ident", name: ident });
      continue;
    }

    throw new EvalError(`Unexpected character '${ch}' at position ${i} in condition`);
  }

  return tokens;
}

// ── Evaluator ─────────────────────────────────────────────────────────────────

const ALLOWED_VARS    = new Set(["qualityScore", "currentPhase", "completedPhases"]);
const ALLOWED_METHODS = new Set(["includes"]);
const ALLOWED_PROPS   = new Set(["length"]);

class ConditionEvaluator {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly ctx: ConditionContext,
  ) {}

  private peek(): Token | undefined { return this.tokens[this.pos]; }

  private consume(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new EvalError("Unexpected end of condition expression");
    this.pos++;
    return t;
  }

  evaluate(): boolean {
    const result = this.parseOr();
    if (this.pos < this.tokens.length) {
      const extra = this.peek();
      throw new EvalError(
        `Unexpected token after condition expression: ${JSON.stringify(extra)}`,
      );
    }
    return Boolean(result);
  }

  // expr := or_expr
  // or_expr := and_expr ('||' and_expr)*
  private parseOr(): unknown {
    let left = this.parseAnd();
    while (this.peek()?.kind === "or") {
      this.consume();
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  // and_expr := not_expr ('&&' not_expr)*
  private parseAnd(): unknown {
    let left = this.parseNot();
    while (this.peek()?.kind === "and") {
      this.consume();
      const right = this.parseNot();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  // not_expr := '!' not_expr | comparison
  private parseNot(): unknown {
    if (this.peek()?.kind === "not") {
      this.consume();
      return !Boolean(this.parseNot());
    }
    return this.parseComparison();
  }

  // comparison := '(' or_expr ')' | primary (op primary)?
  private parseComparison(): unknown {
    if (this.peek()?.kind === "lparen") {
      this.consume();
      const inner = this.parseOr();
      if (this.peek()?.kind !== "rparen") {
        throw new EvalError("Missing closing ')' in condition expression");
      }
      this.consume();
      return inner;
    }

    const left = this.parsePrimary();
    const op = this.peek();
    if (op?.kind === "op") {
      this.consume();
      const right = this.parsePrimary();
      return this.applyOp(left, op.value, right);
    }
    return left;
  }

  // primary := literal | ident ('.' member)*
  private parsePrimary(): unknown {
    const t = this.peek();
    if (!t) throw new EvalError("Unexpected end of expression — expected a value");

    if (t.kind === "num")  { this.consume(); return t.value; }
    if (t.kind === "str")  { this.consume(); return t.value; }
    if (t.kind === "bool") { this.consume(); return t.value; }
    if (t.kind === "null") { this.consume(); return null; }

    if (t.kind === "ident") {
      this.consume();
      if (!ALLOWED_VARS.has(t.name)) {
        throw new EvalError(
          `Unknown variable '${t.name}'. Available variables: ${[...ALLOWED_VARS].join(", ")}`,
        );
      }
      let value: unknown = this.ctx[t.name as keyof ConditionContext];

      // Chained .property / .method() access
      while (this.peek()?.kind === "dot") {
        this.consume(); // consume '.'
        const memberTok = this.peek();
        if (memberTok?.kind !== "ident") {
          throw new EvalError("Expected property or method name after '.'");
        }
        this.consume();
        const memberName = memberTok.name;

        if (this.peek()?.kind === "lparen") {
          // Method call
          if (!ALLOWED_METHODS.has(memberName)) {
            throw new EvalError(
              `Method '${memberName}' is not allowed. Allowed: ${[...ALLOWED_METHODS].join(", ")}`,
            );
          }
          this.consume(); // consume '('
          const args: unknown[] = [];
          while (this.peek()?.kind !== "rparen") {
            if (!this.peek()) throw new EvalError("Unterminated method call — missing ')'");
            if (args.length > 0) {
              if (this.peek()?.kind !== "comma") {
                throw new EvalError("Expected ',' between method arguments");
              }
              this.consume(); // ','
            }
            args.push(this.parsePrimary());
          }
          this.consume(); // consume ')'

          if (memberName === "includes") {
            if (!Array.isArray(value)) {
              throw new EvalError("'.includes()' can only be called on completedPhases");
            }
            if (args.length !== 1) {
              throw new EvalError(`'.includes()' takes exactly 1 argument, got ${args.length}`);
            }
            value = (value as unknown[]).includes(args[0]);
          }
        } else {
          // Property access
          if (!ALLOWED_PROPS.has(memberName)) {
            throw new EvalError(
              `Property '${memberName}' is not allowed. Allowed: ${[...ALLOWED_PROPS].join(", ")}`,
            );
          }
          if (memberName === "length") {
            if (!Array.isArray(value) && typeof value !== "string") {
              throw new EvalError("'.length' can only be accessed on completedPhases");
            }
            value = (value as unknown[] | string).length;
          }
        }
      }
      return value;
    }

    throw new EvalError(`Unexpected token in condition: ${JSON.stringify(t)}`);
  }

  private applyOp(left: unknown, op: string, right: unknown): boolean {
    switch (op) {
      case "===": return left === right;
      case "!==": return left !== right;
      // Allow == / != for null checks: `qualityScore == null`
      // eslint-disable-next-line eqeqeq
      case "==":  return left == right;
      // eslint-disable-next-line eqeqeq
      case "!=":  return left != right;
      case ">":   return (left as number) >  (right as number);
      case "<":   return (left as number) <  (right as number);
      case ">=":  return (left as number) >= (right as number);
      case "<=":  return (left as number) <= (right as number);
      default:    throw new EvalError(`Unknown operator '${op}'`);
    }
  }
}

/**
 * Safely evaluate a workflow phase advance condition.
 *
 * Returns `true` if the condition is met (advance is allowed) or if the
 * condition string is empty/absent (unconditional advance).
 *
 * Throws `EvalError` on syntax or constraint violations. Callers should
 * catch `EvalError` and return HTTP 400.
 *
 * @example
 *   evaluateCondition('qualityScore >= 80 && completedPhases.includes("review")', {
 *     qualityScore: 85,
 *     currentPhase: "deploy",
 *     completedPhases: ["scan", "review"],
 *   }); // → true
 */
export function evaluateCondition(condition: string, ctx: ConditionContext): boolean {
  const trimmed = condition.trim();
  if (!trimmed) return true;

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return true;

  return new ConditionEvaluator(tokens, ctx).evaluate();
}
