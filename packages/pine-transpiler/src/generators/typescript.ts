// ── TypeScript Code Generator ────────────────────────
// Walks a PineScript AST and emits TypeScript source code.

import type { Node, CallArg, Program } from '../ast';
import { resolveBuiltin, applyTemplate } from '../builtins';

// PineScript built-in series that map to OHLCV arrays
const SERIES_VARS: Record<string, string> = {
  open: 'open', high: 'high', low: 'low', close: 'close', volume: 'volume',
  hl2: 'hl2', hlc3: 'hlc3', ohlc4: 'ohlc4', hlcc4: 'hlcc4',
  bar_index: 'bar_index', time: 'time', timenow: 'timenow',
};

export class TypeScriptGenerator {
  private indent = 0;
  private imports = new Set<string>();

  generate(program: Program): string {
    const bodyLines = program.body.map(n => this.emitNode(n)).filter(Boolean);

    const sections: string[] = [];

    // Header
    sections.push('// Auto-generated from PineScript');
    if (program.version) {
      sections.push(`// PineScript v${program.version}`);
    }

    // Imports
    if (this.imports.size) {
      sections.push('');
      for (const imp of this.imports) sections.push(imp);
    }

    // Series helper variables
    sections.push('');
    sections.push('// OHLCV data arrays (provide these externally)');
    sections.push('declare const open: number[];');
    sections.push('declare const high: number[];');
    sections.push('declare const low: number[];');
    sections.push('declare const close: number[];');
    sections.push('declare const volume: number[];');
    sections.push('');
    sections.push('// Computed series');
    sections.push('const hl2 = close.map((_, i) => (high[i] + low[i]) / 2);');
    sections.push('const hlc3 = close.map((_, i) => (high[i] + low[i] + close[i]) / 3);');
    sections.push('const ohlc4 = close.map((_, i) => (open[i] + high[i] + low[i] + close[i]) / 4);');

    // Body
    sections.push('');
    sections.push(bodyLines.join('\n'));

    return sections.join('\n') + '\n';
  }

  // ── Node dispatcher ────────────────────────────────

  private emitNode(node: Node): string {
    switch (node.kind) {
      case 'Program': return this.generate(node);
      case 'VariableDecl': return this.emitVarDecl(node);
      case 'AssignmentStmt': return `${this.pad()}${this.emitExpr(node.target)} = ${this.emitExpr(node.value)};`;
      case 'CompoundAssignStmt': return `${this.pad()}${this.emitExpr(node.target)} ${node.operator} ${this.emitExpr(node.value)};`;
      case 'ExpressionStmt': return `${this.pad()}${this.emitExpr(node.expression)};`;
      case 'IndicatorDecl': return this.emitIndicator(node);
      case 'StrategyDecl': return this.emitStrategy(node);
      case 'LibraryDecl': return this.emitLibrary(node);
      case 'FunctionDecl': return this.emitFunctionDecl(node);
      case 'TypeDecl': return this.emitTypeDecl(node);
      case 'IfStmt': return this.emitIf(node);
      case 'ForStmt': return this.emitFor(node);
      case 'ForInStmt': return this.emitForIn(node);
      case 'WhileStmt': return this.emitWhile(node);
      case 'SwitchStmt': return this.emitSwitch(node);
      case 'BlockStmt': return node.body.map(n => this.emitNode(n)).join('\n');
      case 'BreakStmt': return `${this.pad()}break;`;
      case 'ContinueStmt': return `${this.pad()}continue;`;
      default: return `${this.pad()}${this.emitExpr(node)};`;
    }
  }

  // ── Declarations ────────────────────────────────────

  private emitVarDecl(node: Node & { kind: 'VariableDecl' }): string {
    const kw = node.qualifier === 'varip' ? 'let' : node.qualifier === 'var' ? 'let' : 'const';
    const init = this.emitExpr(node.initializer);
    const exp = node.isExport ? 'export ' : '';
    return `${this.pad()}${exp}${kw} ${node.name} = ${init};`;
  }

  private emitIndicator(node: Node & { kind: 'IndicatorDecl' }): string {
    const title = this.findNamedArg(node.args, 'title') ?? this.findPositionalArg(node.args, 0);
    return `${this.pad()}// indicator(${title ? this.emitExpr(title) : ''})`;
  }

  private emitStrategy(node: Node & { kind: 'StrategyDecl' }): string {
    const title = this.findNamedArg(node.args, 'title') ?? this.findPositionalArg(node.args, 0);
    return `${this.pad()}// strategy(${title ? this.emitExpr(title) : ''})`;
  }

  private emitLibrary(node: Node & { kind: 'LibraryDecl' }): string {
    const title = this.findNamedArg(node.args, 'title') ?? this.findPositionalArg(node.args, 0);
    return `${this.pad()}// library(${title ? this.emitExpr(title) : ''})`;
  }

  private emitFunctionDecl(node: Node & { kind: 'FunctionDecl' }): string {
    const params = node.params.map(p => {
      const def = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : '';
      const type = p.typeAnnotation ? `: ${this.mapType(p.typeAnnotation)}` : '';
      return `${p.name}${type}${def}`;
    }).join(', ');

    const exp = node.isExport ? 'export ' : '';
    const lines: string[] = [];
    lines.push(`${this.pad()}${exp}function ${node.name}(${params}) {`);
    this.indent++;

    if (node.body.kind === 'BlockStmt') {
      const bodyStmts = (node.body as any).body as Node[];
      for (let si = 0; si < bodyStmts.length; si++) {
        const isLast = si === bodyStmts.length - 1;
        if (isLast && bodyStmts[si].kind === 'ExpressionStmt') {
          // PineScript: last expression is implicit return
          lines.push(`${this.pad()}return ${this.emitExpr((bodyStmts[si] as any).expression)};`);
        } else {
          lines.push(this.emitNode(bodyStmts[si]));
        }
      }
    } else {
      lines.push(`${this.pad()}return ${this.emitExpr(node.body)};`);
    }

    this.indent--;
    lines.push(`${this.pad()}}`);
    return lines.join('\n');
  }

  private emitTypeDecl(node: Node & { kind: 'TypeDecl' }): string {
    const exp = node.isExport ? 'export ' : '';
    const lines: string[] = [];
    lines.push(`${this.pad()}${exp}interface ${node.name} {`);
    this.indent++;
    for (const f of node.fields) {
      if (f.kind !== 'TypeField') continue;
      const type = f.typeAnnotation ? this.mapType(f.typeAnnotation) : 'any';
      const def = f.defaultValue ? ` // default: ${this.emitExpr(f.defaultValue)}` : '';
      lines.push(`${this.pad()}${f.name}: ${type};${def}`);
    }
    this.indent--;
    lines.push(`${this.pad()}}`);
    return lines.join('\n');
  }

  // ── Control flow ────────────────────────────────────

  private emitIf(node: Node & { kind: 'IfStmt' }): string {
    const lines: string[] = [];
    lines.push(`${this.pad()}if (${this.emitExpr(node.condition)}) {`);
    this.indent++;
    lines.push(this.emitNode(node.consequent));
    this.indent--;
    if (node.alternate) {
      if (node.alternate.kind === 'IfStmt') {
        lines.push(`${this.pad()}} else ${this.emitIf(node.alternate as any).trimStart()}`);
      } else {
        lines.push(`${this.pad()}} else {`);
        this.indent++;
        lines.push(this.emitNode(node.alternate));
        this.indent--;
        lines.push(`${this.pad()}}`);
      }
    } else {
      lines.push(`${this.pad()}}`);
    }
    return lines.join('\n');
  }

  private emitFor(node: Node & { kind: 'ForStmt' }): string {
    const start = this.emitExpr(node.start);
    const end = this.emitExpr(node.end);
    const step = node.step ? this.emitExpr(node.step) : '1';
    const lines: string[] = [];
    lines.push(`${this.pad()}for (let ${node.variable} = ${start}; ${node.variable} <= ${end}; ${node.variable} += ${step}) {`);
    this.indent++;
    lines.push(this.emitNode(node.body));
    this.indent--;
    lines.push(`${this.pad()}}`);
    return lines.join('\n');
  }

  private emitForIn(node: Node & { kind: 'ForInStmt' }): string {
    const lines: string[] = [];
    lines.push(`${this.pad()}for (const ${node.variable} of ${this.emitExpr(node.iterable)}) {`);
    this.indent++;
    lines.push(this.emitNode(node.body));
    this.indent--;
    lines.push(`${this.pad()}}`);
    return lines.join('\n');
  }

  private emitWhile(node: Node & { kind: 'WhileStmt' }): string {
    const lines: string[] = [];
    lines.push(`${this.pad()}while (${this.emitExpr(node.condition)}) {`);
    this.indent++;
    lines.push(this.emitNode(node.body));
    this.indent--;
    lines.push(`${this.pad()}}`);
    return lines.join('\n');
  }

  private emitSwitch(node: Node & { kind: 'SwitchStmt' }): string {
    const lines: string[] = [];
    if (node.expr) {
      lines.push(`${this.pad()}switch (${this.emitExpr(node.expr)}) {`);
    } else {
      // No expression — PineScript switch acts like if/else chain
      // Emit as if/else chain
      return this.emitSwitchAsIfElse(node.cases);
    }
    this.indent++;
    for (const c of node.cases) {
      if (c.kind !== 'SwitchCase') continue;
      if (c.condition) {
        lines.push(`${this.pad()}case ${this.emitExpr(c.condition)}:`);
      } else {
        lines.push(`${this.pad()}default:`);
      }
      this.indent++;
      lines.push(this.emitNode(c.body));
      lines.push(`${this.pad()}break;`);
      this.indent--;
    }
    this.indent--;
    lines.push(`${this.pad()}}`);
    return lines.join('\n');
  }

  private emitSwitchAsIfElse(cases: Node[]): string {
    const lines: string[] = [];
    let first = true;
    for (const c of cases) {
      if (c.kind !== 'SwitchCase') continue;
      if (c.condition) {
        const kw = first ? 'if' : '} else if';
        lines.push(`${this.pad()}${kw} (${this.emitExpr(c.condition)}) {`);
        first = false;
      } else {
        lines.push(`${this.pad()}} else {`);
      }
      this.indent++;
      lines.push(this.emitNode(c.body));
      this.indent--;
    }
    if (!first) lines.push(`${this.pad()}}`);
    return lines.join('\n');
  }

  // ── Expression emitter ──────────────────────────────

  private emitExpr(node: Node): string {
    switch (node.kind) {
      case 'NumberLiteral': return String(node.value);
      case 'StringLiteral': return JSON.stringify(node.value);
      case 'BoolLiteral': return String(node.value);
      case 'NaLiteral': return 'NaN';
      case 'ColorLiteral': return JSON.stringify(node.value);
      case 'Identifier': return SERIES_VARS[node.name] ?? node.name;
      case 'ArrayLiteral': return `[${node.elements.map(e => this.emitExpr(e)).join(', ')}]`;

      case 'BinaryExpr': {
        const op = node.operator === 'and' ? '&&' : node.operator === 'or' ? '||' : node.operator;
        return `(${this.emitExpr(node.left)} ${op} ${this.emitExpr(node.right)})`;
      }
      case 'UnaryExpr': {
        const op = node.operator === 'not' ? '!' : node.operator;
        return `${op}(${this.emitExpr(node.operand)})`;
      }
      case 'TernaryExpr':
        return `(${this.emitExpr(node.condition)} ? ${this.emitExpr(node.consequent)} : ${this.emitExpr(node.alternate)})`;

      case 'CallExpr': return this.emitCall(node);
      case 'MethodCallExpr': return this.emitMethodCall(node as any);
      case 'MemberExpr': return `${this.emitExpr(node.object)}.${node.property}`;
      case 'IndexExpr': return `${this.emitExpr(node.object)}[${this.emitExpr(node.index)}]`;
      case 'ReturnExpr': return `return ${node.value ? this.emitExpr(node.value) : ''}`;

      case 'IfStmt': {
        // Inline if expression
        if (node.alternate) {
          return `(${this.emitExpr(node.condition)} ? ${this.emitExpr(node.consequent)} : ${this.emitExpr(node.alternate)})`;
        }
        return `(${this.emitExpr(node.condition)} ? ${this.emitExpr(node.consequent)} : undefined)`;
      }

      default: return `/* unhandled: ${node.kind} */`;
    }
  }

  private emitCall(node: Node & { kind: 'CallExpr' }): string {
    // Resolve the full callee name for built-in lookup
    const calleeName = this.resolveCalleeName(node.callee);
    const mapping = calleeName ? resolveBuiltin(calleeName) : undefined;

    if (mapping) {
      const argStrs = node.args.map(a => this.emitExpr(a.value));
      if (mapping.ts.module !== '__builtin' && mapping.ts.module !== '__inline') {
        this.imports.add(`import { ${mapping.ts.template.split('.')[0]} } from '${mapping.ts.module}';`);
      }
      return applyTemplate(mapping.ts.template, argStrs);
    }

    // Regular function call
    const args = node.args.map(a => {
      if (a.name) return `/* ${a.name}= */ ${this.emitExpr(a.value)}`;
      return this.emitExpr(a.value);
    }).join(', ');
    return `${this.emitExpr(node.callee)}(${args})`;
  }

  private emitMethodCall(node: Node & { kind: 'MethodCallExpr' }): string {
    // Try to resolve as a built-in (e.g. ta.sma → SMA.calculate)
    const objName = this.resolveCalleeName(node.object);
    const fullName = objName ? `${objName}.${node.method}` : null;
    const mapping = fullName ? resolveBuiltin(fullName) : undefined;

    if (mapping) {
      const argStrs = node.args.map(a => this.emitExpr(a.value));
      if (mapping.ts.module !== '__builtin' && mapping.ts.module !== '__inline') {
        this.imports.add(`import { ${mapping.ts.template.split('.')[0]} } from '${mapping.ts.module}';`);
      }
      return applyTemplate(mapping.ts.template, argStrs);
    }

    const args = node.args.map(a => this.emitExpr(a.value)).join(', ');
    return `${this.emitExpr(node.object)}.${node.method}(${args})`;
  }

  private resolveCalleeName(node: Node): string | null {
    if (node.kind === 'Identifier') return node.name;
    if (node.kind === 'MemberExpr') {
      const objName = this.resolveCalleeName(node.object);
      return objName ? `${objName}.${node.property}` : null;
    }
    return null;
  }

  // ── Helpers ─────────────────────────────────────────

  private mapType(ta: Node & { kind: 'TypeAnnotation' }): string {
    const map: Record<string, string> = {
      int: 'number', float: 'number', bool: 'boolean',
      string: 'string', color: 'string', label: 'any',
      line: 'any', box: 'any', table: 'any',
    };
    let ts = map[ta.baseType] ?? ta.baseType;
    if (ta.isArray) ts += '[]';
    return ts;
  }

  private findNamedArg(args: CallArg[], name: string): Node | null {
    return args.find(a => a.name === name)?.value ?? null;
  }

  private findPositionalArg(args: CallArg[], index: number): Node | null {
    const positional = args.filter(a => !a.name);
    return positional[index]?.value ?? null;
  }

  private pad(): string {
    return '  '.repeat(this.indent);
  }
}
