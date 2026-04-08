// ── Python Code Generator ────────────────────────────
// Walks a PineScript AST and emits Python source code.

import type { Node, CallArg, Program } from '../ast';
import { resolveBuiltin, applyTemplate } from '../builtins';

const SERIES_VARS: Record<string, string> = {
  open: 'open_', high: 'high_', low: 'low_', close: 'close_', volume: 'volume_',
  hl2: 'hl2', hlc3: 'hlc3', ohlc4: 'ohlc4', hlcc4: 'hlcc4',
  bar_index: 'bar_index', time: 'time_', timenow: 'timenow',
};

const PY_RESERVED = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
  'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
  'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
  'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
  'try', 'while', 'with', 'yield',
]);

export class PythonGenerator {
  private indent = 0;
  private imports = new Set<string>();

  generate(program: Program): string {
    const bodyLines = program.body.map(n => this.emitNode(n)).filter(Boolean);

    const sections: string[] = [];

    // Header
    sections.push('# Auto-generated from PineScript');
    if (program.version) {
      sections.push(`# PineScript v${program.version}`);
    }
    sections.push('');

    // Standard imports
    this.imports.add('import numpy as np');
    this.imports.add('import pandas as pd');

    for (const imp of this.imports) sections.push(imp);
    sections.push('');

    // Series comment
    sections.push('# OHLCV data — provide these externally as pd.Series or np.ndarray');
    sections.push('# open_, high_, low_, close_, volume_ = ...');
    sections.push('');
    sections.push('hl2 = (high_ + low_) / 2');
    sections.push('hlc3 = (high_ + low_ + close_) / 3');
    sections.push('ohlc4 = (open_ + high_ + low_ + close_) / 4');
    sections.push('');

    // Body
    sections.push(bodyLines.join('\n'));

    return sections.join('\n') + '\n';
  }

  // ── Node dispatcher ────────────────────────────────

  private emitNode(node: Node): string {
    switch (node.kind) {
      case 'Program': return this.generate(node);
      case 'VariableDecl': return this.emitVarDecl(node);
      case 'AssignmentStmt': return `${this.pad()}${this.emitExpr(node.target)} = ${this.emitExpr(node.value)}`;
      case 'CompoundAssignStmt': return `${this.pad()}${this.emitExpr(node.target)} ${node.operator} ${this.emitExpr(node.value)}`;
      case 'ExpressionStmt': return `${this.pad()}${this.emitExpr(node.expression)}`;
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
      case 'BreakStmt': return `${this.pad()}break`;
      case 'ContinueStmt': return `${this.pad()}continue`;
      default: return `${this.pad()}${this.emitExpr(node)}`;
    }
  }

  // ── Declarations ────────────────────────────────────

  private emitVarDecl(node: Node & { kind: 'VariableDecl' }): string {
    const name = this.safeName(node.name);
    return `${this.pad()}${name} = ${this.emitExpr(node.initializer)}`;
  }

  private emitIndicator(node: Node & { kind: 'IndicatorDecl' }): string {
    const title = this.findNamedArg(node.args, 'title') ?? this.findPositionalArg(node.args, 0);
    return `${this.pad()}# indicator(${title ? this.emitExpr(title) : ''})`;
  }

  private emitStrategy(node: Node & { kind: 'StrategyDecl' }): string {
    const title = this.findNamedArg(node.args, 'title') ?? this.findPositionalArg(node.args, 0);
    return `${this.pad()}# strategy(${title ? this.emitExpr(title) : ''})`;
  }

  private emitLibrary(node: Node & { kind: 'LibraryDecl' }): string {
    const title = this.findNamedArg(node.args, 'title') ?? this.findPositionalArg(node.args, 0);
    return `${this.pad()}# library(${title ? this.emitExpr(title) : ''})`;
  }

  private emitFunctionDecl(node: Node & { kind: 'FunctionDecl' }): string {
    const params = node.params.map(p => {
      const name = this.safeName(p.name);
      const def = p.defaultValue ? `=${this.emitExpr(p.defaultValue)}` : '';
      return `${name}${def}`;
    }).join(', ');

    const lines: string[] = [];
    lines.push(`${this.pad()}def ${this.safeName(node.name)}(${params}):`);
    this.indent++;

    if (node.body.kind === 'BlockStmt') {
      const bodyStmts = (node.body as any).body as Node[];
      if (bodyStmts.length === 0) {
        lines.push(`${this.pad()}pass`);
      } else {
        for (let si = 0; si < bodyStmts.length; si++) {
          const isLast = si === bodyStmts.length - 1;
          if (isLast && bodyStmts[si].kind === 'ExpressionStmt') {
            lines.push(`${this.pad()}return ${this.emitExpr((bodyStmts[si] as any).expression)}`);
          } else {
            lines.push(this.emitNode(bodyStmts[si]));
          }
        }
      }
    } else {
      lines.push(`${this.pad()}return ${this.emitExpr(node.body)}`);
    }

    this.indent--;
    return lines.join('\n');
  }

  private emitTypeDecl(node: Node & { kind: 'TypeDecl' }): string {
    this.imports.add('from dataclasses import dataclass');
    const lines: string[] = [];
    lines.push(`${this.pad()}@dataclass`);
    lines.push(`${this.pad()}class ${node.name}:`);
    this.indent++;
    if (node.fields.length === 0) {
      lines.push(`${this.pad()}pass`);
    } else {
      for (const f of node.fields) {
        if (f.kind !== 'TypeField') continue;
        const type = f.typeAnnotation ? this.mapType(f.typeAnnotation) : 'Any';
        const def = f.defaultValue ? ` = ${this.emitExpr(f.defaultValue)}` : '';
        lines.push(`${this.pad()}${this.safeName(f.name)}: ${type}${def}`);
      }
    }
    this.indent--;
    return lines.join('\n');
  }

  // ── Control flow ────────────────────────────────────

  private emitIf(node: Node & { kind: 'IfStmt' }): string {
    const lines: string[] = [];
    lines.push(`${this.pad()}if ${this.emitExpr(node.condition)}:`);
    this.indent++;
    lines.push(this.emitNode(node.consequent));
    this.indent--;
    if (node.alternate) {
      if (node.alternate.kind === 'IfStmt') {
        lines.push(`${this.pad()}el${this.emitIf(node.alternate as any).trimStart()}`);
      } else {
        lines.push(`${this.pad()}else:`);
        this.indent++;
        lines.push(this.emitNode(node.alternate));
        this.indent--;
      }
    }
    return lines.join('\n');
  }

  private emitFor(node: Node & { kind: 'ForStmt' }): string {
    const start = this.emitExpr(node.start);
    const end = this.emitExpr(node.end);
    const step = node.step ? `, ${this.emitExpr(node.step)}` : '';
    const lines: string[] = [];
    lines.push(`${this.pad()}for ${this.safeName(node.variable)} in range(${start}, ${end} + 1${step}):`);
    this.indent++;
    lines.push(this.emitNode(node.body));
    this.indent--;
    return lines.join('\n');
  }

  private emitForIn(node: Node & { kind: 'ForInStmt' }): string {
    const lines: string[] = [];
    lines.push(`${this.pad()}for ${this.safeName(node.variable)} in ${this.emitExpr(node.iterable)}:`);
    this.indent++;
    lines.push(this.emitNode(node.body));
    this.indent--;
    return lines.join('\n');
  }

  private emitWhile(node: Node & { kind: 'WhileStmt' }): string {
    const lines: string[] = [];
    lines.push(`${this.pad()}while ${this.emitExpr(node.condition)}:`);
    this.indent++;
    lines.push(this.emitNode(node.body));
    this.indent--;
    return lines.join('\n');
  }

  private emitSwitch(node: Node & { kind: 'SwitchStmt' }): string {
    // Python 3.10+ match/case, but safer as if/elif/else
    const lines: string[] = [];
    let first = true;
    for (const c of node.cases) {
      if (c.kind !== 'SwitchCase') continue;
      if (c.condition) {
        if (node.expr) {
          const kw = first ? 'if' : 'elif';
          lines.push(`${this.pad()}${kw} ${this.emitExpr(node.expr)} == ${this.emitExpr(c.condition)}:`);
        } else {
          const kw = first ? 'if' : 'elif';
          lines.push(`${this.pad()}${kw} ${this.emitExpr(c.condition)}:`);
        }
        first = false;
      } else {
        lines.push(`${this.pad()}else:`);
      }
      this.indent++;
      lines.push(this.emitNode(c.body));
      this.indent--;
    }
    return lines.join('\n');
  }

  // ── Expression emitter ──────────────────────────────

  private emitExpr(node: Node): string {
    switch (node.kind) {
      case 'NumberLiteral': return String(node.value);
      case 'StringLiteral': return JSON.stringify(node.value);
      case 'BoolLiteral': return node.value ? 'True' : 'False';
      case 'NaLiteral': return 'np.nan';
      case 'ColorLiteral': return JSON.stringify(node.value);
      case 'Identifier': return SERIES_VARS[node.name] ?? this.safeName(node.name);
      case 'ArrayLiteral': return `[${node.elements.map(e => this.emitExpr(e)).join(', ')}]`;

      case 'BinaryExpr': {
        const op = node.operator === '==' ? '==' :
                   node.operator === '!=' ? '!=' :
                   node.operator === '&&' ? 'and' :
                   node.operator === '||' ? 'or' :
                   node.operator;
        return `(${this.emitExpr(node.left)} ${op} ${this.emitExpr(node.right)})`;
      }
      case 'UnaryExpr': {
        const op = node.operator === '!' ? 'not ' : node.operator;
        return `${op}(${this.emitExpr(node.operand)})`;
      }
      case 'TernaryExpr':
        return `(${this.emitExpr(node.consequent)} if ${this.emitExpr(node.condition)} else ${this.emitExpr(node.alternate)})`;

      case 'CallExpr': return this.emitCall(node);
      case 'MethodCallExpr': return this.emitMethodCall(node as any);
      case 'MemberExpr': return `${this.emitExpr(node.object)}.${node.property}`;
      case 'IndexExpr': return `${this.emitExpr(node.object)}[${this.emitExpr(node.index)}]`;
      case 'ReturnExpr': return `return ${node.value ? this.emitExpr(node.value) : ''}`;

      case 'IfStmt': {
        if (node.alternate) {
          return `(${this.emitExpr(node.consequent)} if ${this.emitExpr(node.condition)} else ${this.emitExpr(node.alternate)})`;
        }
        return `(${this.emitExpr(node.consequent)} if ${this.emitExpr(node.condition)} else None)`;
      }

      default: return `# unhandled: ${node.kind}`;
    }
  }

  private emitCall(node: Node & { kind: 'CallExpr' }): string {
    const calleeName = this.resolveCalleeName(node.callee);
    const mapping = calleeName ? resolveBuiltin(calleeName) : undefined;

    if (mapping) {
      const argStrs = node.args.map(a => this.emitExpr(a.value));
      if (mapping.py.module !== '__builtin' && mapping.py.module !== '__inline') {
        this.imports.add(`import ${mapping.py.module}`);
      }
      return applyTemplate(mapping.py.template, argStrs);
    }

    // Regular function call
    const args = node.args.map(a => {
      if (a.name) return `${a.name}=${this.emitExpr(a.value)}`;
      return this.emitExpr(a.value);
    }).join(', ');
    return `${this.emitExpr(node.callee)}(${args})`;
  }

  private emitMethodCall(node: Node & { kind: 'MethodCallExpr' }): string {
    // Try to resolve as a built-in (e.g. ta.sma → .ta.sma())
    const objName = this.resolveCalleeName(node.object);
    const fullName = objName ? `${objName}.${node.method}` : null;
    const mapping = fullName ? resolveBuiltin(fullName) : undefined;

    if (mapping) {
      const argStrs = node.args.map(a => this.emitExpr(a.value));
      if (mapping.py.module !== '__builtin' && mapping.py.module !== '__inline') {
        this.imports.add(`import ${mapping.py.module}`);
      }
      return applyTemplate(mapping.py.template, argStrs);
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
      int: 'int', float: 'float', bool: 'bool',
      string: 'str', color: 'str', label: 'Any',
      line: 'Any', box: 'Any', table: 'Any',
    };
    let py = map[ta.baseType] ?? ta.baseType;
    if (ta.isArray) py = `list[${py}]`;
    return py;
  }

  private safeName(name: string): string {
    if (PY_RESERVED.has(name)) return `${name}_`;
    return name;
  }

  private findNamedArg(args: CallArg[], name: string): Node | null {
    return args.find(a => a.name === name)?.value ?? null;
  }

  private findPositionalArg(args: CallArg[], index: number): Node | null {
    const positional = args.filter(a => !a.name);
    return positional[index]?.value ?? null;
  }

  private pad(): string {
    return '    '.repeat(this.indent);
  }
}
