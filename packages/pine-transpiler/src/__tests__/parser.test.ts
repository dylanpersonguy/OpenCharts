import { describe, it, expect } from 'vitest';
import { Lexer } from '../lexer';
import { Parser } from '../parser';

function parse(source: string) {
  const tokens = new Lexer(source).tokenize();
  return new Parser(tokens).parse();
}

describe('Parser', () => {
  it('parses version directive', () => {
    const ast = parse('//@version=5\n');
    expect(ast.version).toBe(5);
  });

  it('parses indicator declaration', () => {
    const ast = parse('//@version=5\nindicator("My RSI", overlay=false)\n');
    expect(ast.body[0].kind).toBe('IndicatorDecl');
  });

  it('parses variable declarations', () => {
    const ast = parse('x = 42\n');
    expect(ast.body[0].kind).toBe('VariableDecl');
    const decl = ast.body[0] as any;
    expect(decl.name).toBe('x');
    expect(decl.initializer.kind).toBe('NumberLiteral');
    expect(decl.initializer.value).toBe(42);
  });

  it('parses var qualifier', () => {
    const ast = parse('var x = 0\n');
    const decl = ast.body[0] as any;
    expect(decl.qualifier).toBe('var');
  });

  it('parses function declarations', () => {
    const ast = parse('myFunc(a, b) =>\n    a + b\n');
    const fn = ast.body[0] as any;
    expect(fn.kind).toBe('FunctionDecl');
    expect(fn.name).toBe('myFunc');
    expect(fn.params).toHaveLength(2);
  });

  it('parses if/else', () => {
    const ast = parse('if x > 0\n    y = 1\nelse\n    y = 2\n');
    const ifStmt = ast.body[0] as any;
    expect(ifStmt.kind).toBe('IfStmt');
    expect(ifStmt.alternate).not.toBeNull();
  });

  it('parses for loop', () => {
    const ast = parse('for i = 0 to 10\n    x = i\n');
    const forStmt = ast.body[0] as any;
    expect(forStmt.kind).toBe('ForStmt');
    expect(forStmt.variable).toBe('i');
  });

  it('parses while loop', () => {
    const ast = parse('while x > 0\n    x = x - 1\n');
    const whileStmt = ast.body[0] as any;
    expect(whileStmt.kind).toBe('WhileStmt');
  });

  it('parses function calls', () => {
    const ast = parse('plot(close)\n');
    const stmt = ast.body[0] as any;
    expect(stmt.kind).toBe('ExpressionStmt');
    expect(stmt.expression.kind).toBe('CallExpr');
  });

  it('parses named arguments', () => {
    const ast = parse('plot(close, title="Close", color=#FF0000)\n');
    const call = (ast.body[0] as any).expression;
    expect(call.args[1].name).toBe('title');
    expect(call.args[2].name).toBe('color');
  });

  it('parses member expressions', () => {
    const ast = parse('x = ta.sma(close, 14)\n');
    const decl = ast.body[0] as any;
    expect(decl.initializer.kind).toBe('MethodCallExpr');
    expect(decl.initializer.method).toBe('sma');
  });

  it('parses ternary expressions', () => {
    const ast = parse('x = a > b ? a : b\n');
    const decl = ast.body[0] as any;
    expect(decl.initializer.kind).toBe('TernaryExpr');
  });

  it('parses binary operators with precedence', () => {
    const ast = parse('x = 1 + 2 * 3\n');
    const decl = ast.body[0] as any;
    // Should be 1 + (2 * 3), so top-level is addition
    expect(decl.initializer.kind).toBe('BinaryExpr');
    expect(decl.initializer.operator).toBe('+');
    expect(decl.initializer.right.operator).toBe('*');
  });

  it('parses array literal', () => {
    const ast = parse('x = [1, 2, 3]\n');
    const decl = ast.body[0] as any;
    expect(decl.initializer.kind).toBe('ArrayLiteral');
    expect(decl.initializer.elements).toHaveLength(3);
  });
});
