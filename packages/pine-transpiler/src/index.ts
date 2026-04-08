// ── PineScript Transpiler ─────────────────────────────
// Public API: parse PineScript source and generate TypeScript or Python.

export { Lexer, TokenType } from './lexer';
export type { Token } from './lexer';
export { Parser } from './parser';
export type { Node, Program } from './ast';
export { TypeScriptGenerator } from './generators/typescript';
export { PythonGenerator } from './generators/python';
export { BUILTINS, resolveBuiltin, applyTemplate } from './builtins';

import { Lexer } from './lexer';
import { Parser } from './parser';
import { TypeScriptGenerator } from './generators/typescript';
import { PythonGenerator } from './generators/python';

export type TargetLanguage = 'typescript' | 'python';

export interface TranspileResult {
  /** Generated source code */
  code: string;
  /** Detected PineScript version (null if absent) */
  version: number | null;
  /** Target language used */
  target: TargetLanguage;
}

/**
 * Transpile PineScript source code to the chosen target language.
 *
 * @param source  - PineScript source code
 * @param target  - Target language: 'typescript' | 'python'
 * @returns TranspileResult with the generated code
 * @throws SyntaxError on parse failure
 */
export function transpile(source: string, target: TargetLanguage): TranspileResult {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();

  const parser = new Parser(tokens);
  const ast = parser.parse();

  let code: string;
  switch (target) {
    case 'typescript':
      code = new TypeScriptGenerator().generate(ast);
      break;
    case 'python':
      code = new PythonGenerator().generate(ast);
      break;
    default:
      throw new Error(`Unsupported target language: ${target}`);
  }

  return { code, version: ast.version, target };
}
