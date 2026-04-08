import { Token, TokenType } from './lexer';
import type {
  Node, Program, CallArg, FunctionParam, VariableDecl,
  BlockStmt, TypeAnnotation,
} from './ast';

// ── PineScript Recursive-Descent Parser ──────────────

export class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    // Filter out newlines between meaningful tokens where they don't
    // matter (we keep them for statement separation detection only at top level)
    this.tokens = tokens;
  }

  parse(): Program {
    const version = this.parseVersionDirective();
    const body = this.parseStatements();
    return { kind: 'Program', version, body };
  }

  // ── Version ──────────────────────────────────────

  private parseVersionDirective(): number | null {
    this.skipNewlines();
    if (this.check(TokenType.VersionDirective)) {
      const tok = this.advance();
      const v = parseInt(tok.value.replace('//@version=', ''), 10);
      this.skipNewlines();
      return v;
    }
    return null;
  }

  // ── Statements ───────────────────────────────────

  private parseStatements(): Node[] {
    const stmts: Node[] = [];
    this.skipNewlines();
    while (!this.isAtEnd() && !this.check(TokenType.Dedent)) {
      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);
      this.skipNewlines();
    }
    return stmts;
  }

  private parseStatement(): Node | null {
    this.skipNewlines();
    if (this.isAtEnd()) return null;

    // indicator(...) / strategy(...) / library(...)
    if (this.check(TokenType.Indicator)) return this.parseIndicatorDecl();
    if (this.check(TokenType.Strategy)) return this.parseStrategyDecl();
    if (this.check(TokenType.Library)) return this.parseLibraryDecl();

    // export
    if (this.check(TokenType.Export)) return this.parseExportedDecl();

    // method
    if (this.check(TokenType.Method)) return this.parseMethodDecl();

    // var / varip
    if (this.check(TokenType.Var) || this.check(TokenType.Varip)) return this.parseVarDecl();

    // type
    if (this.check(TokenType.Type) && this.peekNext()?.type === TokenType.Identifier) {
      return this.parseTypeDecl();
    }

    // if
    if (this.check(TokenType.If)) return this.parseIfStmt();

    // for
    if (this.check(TokenType.For)) return this.parseForStmt();

    // while
    if (this.check(TokenType.While)) return this.parseWhileStmt();

    // switch
    if (this.check(TokenType.Switch)) return this.parseSwitchStmt();

    // break / continue
    if (this.check(TokenType.Break)) { this.advance(); return { kind: 'BreakStmt' }; }
    if (this.check(TokenType.Continue)) { this.advance(); return { kind: 'ContinueStmt' }; }

    // Try to detect function declaration: `name(params) =>`
    if (this.check(TokenType.Identifier) && this.looksLikeFunctionDecl()) {
      return this.parseFunctionDecl(false);
    }

    // Expression statement (assignments, calls, etc.)
    return this.parseExpressionStatement();
  }

  // ── Indicator / Strategy / Library ────────────────

  private parseIndicatorDecl(): Node {
    this.advance(); // 'indicator'
    const args = this.parseCallArgs();
    return { kind: 'IndicatorDecl', args };
  }

  private parseStrategyDecl(): Node {
    this.advance(); // 'strategy'
    const args = this.parseCallArgs();
    return { kind: 'StrategyDecl', args };
  }

  private parseLibraryDecl(): Node {
    this.advance(); // 'library'
    const args = this.parseCallArgs();
    return { kind: 'LibraryDecl', args };
  }

  // ── Export ────────────────────────────────────────

  private parseExportedDecl(): Node {
    this.advance(); // 'export'

    if (this.check(TokenType.Type)) {
      const decl = this.parseTypeDecl();
      if (decl.kind === 'TypeDecl') decl.isExport = true;
      return decl;
    }

    if (this.check(TokenType.Method)) {
      const decl = this.parseMethodDecl();
      if (decl.kind === 'FunctionDecl') (decl as any).isExport = true;
      return decl;
    }

    // Exported function
    const decl = this.parseFunctionDecl(false);
    if (decl.kind === 'FunctionDecl') (decl as any).isExport = true;
    return decl;
  }

  // ── Method ────────────────────────────────────────

  private parseMethodDecl(): Node {
    this.advance(); // 'method'
    return this.parseFunctionDecl(true);
  }

  // ── Variable declarations ─────────────────────────

  private parseVarDecl(): Node {
    const qualifier = this.advance().value as 'var' | 'varip';
    return this.parseVariableDeclBody(qualifier);
  }

  private parseVariableDeclBody(qualifier: 'var' | 'varip' | null): VariableDecl {
    let typeAnnotation: TypeAnnotation | null = null;

    // Optional type annotation before name
    if (this.isTypeKeyword() && this.peekNext()?.type === TokenType.Identifier) {
      typeAnnotation = this.parseTypeAnnotation();
    }

    const name = this.expect(TokenType.Identifier, 'variable name').value;
    this.expect(TokenType.Assign, '=');
    const initializer = this.parseExpression();

    return {
      kind: 'VariableDecl',
      name,
      typeAnnotation,
      initializer,
      qualifier,
      isExport: false,
    };
  }

  // ── Type declaration ──────────────────────────────

  private parseTypeDecl(): Node {
    this.advance(); // 'type'
    const name = this.expect(TokenType.Identifier, 'type name').value;
    this.skipNewlines();
    const fields: Node[] = [];

    if (this.check(TokenType.Indent)) {
      this.advance(); // INDENT
      while (!this.check(TokenType.Dedent) && !this.isAtEnd()) {
        this.skipNewlines();
        if (this.check(TokenType.Dedent)) break;

        let fieldType: TypeAnnotation | null = null;
        if (this.isTypeKeyword()) {
          fieldType = this.parseTypeAnnotation();
        }
        const fieldName = this.expect(TokenType.Identifier, 'field name').value;
        let defaultValue: Node | null = null;
        if (this.match(TokenType.Assign)) {
          defaultValue = this.parseExpression();
        }
        fields.push({ kind: 'TypeField', name: fieldName, typeAnnotation: fieldType, defaultValue });
        this.skipNewlines();
      }
      if (this.check(TokenType.Dedent)) this.advance();
    }

    return { kind: 'TypeDecl', name, fields, isExport: false };
  }

  // ── Function declaration ──────────────────────────

  private looksLikeFunctionDecl(): boolean {
    // Save position, check if pattern is: IDENT '(' ... ')' '=>'
    const saved = this.pos;
    try {
      this.advance(); // name
      if (!this.check(TokenType.LParen)) return false;
      this.advance(); // '('
      let depth = 1;
      while (depth > 0 && !this.isAtEnd()) {
        if (this.check(TokenType.LParen)) depth++;
        if (this.check(TokenType.RParen)) depth--;
        this.advance();
      }
      return this.check(TokenType.FatArrow);
    } finally {
      this.pos = saved;
    }
  }

  private parseFunctionDecl(isMethod: boolean): Node {
    const name = this.expect(TokenType.Identifier, 'function name').value;
    this.expect(TokenType.LParen, '(');
    const params = this.parseFunctionParams();
    this.expect(TokenType.RParen, ')');
    this.expect(TokenType.FatArrow, '=>');
    this.skipNewlines();

    let body: Node;
    if (this.check(TokenType.Indent)) {
      body = this.parseBlock();
    } else {
      body = this.parseExpression();
    }

    return {
      kind: 'FunctionDecl',
      name,
      params,
      body,
      isExport: false,
      isMethod,
    };
  }

  private parseFunctionParams(): FunctionParam[] {
    const params: FunctionParam[] = [];
    while (!this.check(TokenType.RParen) && !this.isAtEnd()) {
      this.skipNewlines();

      let typeAnnotation: TypeAnnotation | null = null;
      if (this.isTypeKeyword() && this.peekNext()?.type === TokenType.Identifier) {
        typeAnnotation = this.parseTypeAnnotation();
      }

      const name = this.expect(TokenType.Identifier, 'parameter name').value;
      let defaultValue: Node | null = null;
      if (this.match(TokenType.Assign)) {
        defaultValue = this.parseExpression();
      }
      params.push({ name, typeAnnotation, defaultValue });

      this.skipNewlines();
      if (!this.check(TokenType.RParen)) {
        this.expect(TokenType.Comma, ',');
      }
    }
    return params;
  }

  // ── Control flow ──────────────────────────────────

  private parseIfStmt(): Node {
    this.advance(); // 'if'
    const condition = this.parseExpression();
    this.skipNewlines();
    const consequent = this.check(TokenType.Indent) ? this.parseBlock() : this.parseExpression();

    let alternate: Node | null = null;
    this.skipNewlines();
    if (this.check(TokenType.Else)) {
      this.advance();
      this.skipNewlines();
      if (this.check(TokenType.If)) {
        alternate = this.parseIfStmt();
      } else if (this.check(TokenType.Indent)) {
        alternate = this.parseBlock();
      } else {
        alternate = this.parseExpression();
      }
    }

    return { kind: 'IfStmt', condition, consequent, alternate };
  }

  private parseForStmt(): Node {
    this.advance(); // 'for'
    const variable = this.expect(TokenType.Identifier, 'loop variable').value;

    if (this.check(TokenType.In)) {
      // for x in iterable
      this.advance();
      const iterable = this.parseExpression();
      this.skipNewlines();
      const body = this.check(TokenType.Indent) ? this.parseBlock() : this.parseExpression();
      return { kind: 'ForInStmt', variable, iterable, body };
    }

    // for x = start to end [by step]
    this.expect(TokenType.Assign, '=');
    const start = this.parseExpression();
    this.expect(TokenType.To, 'to');
    const end = this.parseExpression();

    let step: Node | null = null;
    if (this.check(TokenType.By)) {
      this.advance();
      step = this.parseExpression();
    }

    this.skipNewlines();
    const body = this.check(TokenType.Indent) ? this.parseBlock() : this.parseExpression();

    return { kind: 'ForStmt', variable, start, end, step, body };
  }

  private parseWhileStmt(): Node {
    this.advance(); // 'while'
    const condition = this.parseExpression();
    this.skipNewlines();
    const body = this.check(TokenType.Indent) ? this.parseBlock() : this.parseExpression();
    return { kind: 'WhileStmt', condition, body };
  }

  private parseSwitchStmt(): Node {
    this.advance(); // 'switch'
    let expr: Node | null = null;
    if (!this.check(TokenType.Newline) && !this.check(TokenType.Indent)) {
      expr = this.parseExpression();
    }
    this.skipNewlines();

    const cases: Node[] = [];
    if (this.check(TokenType.Indent)) {
      this.advance(); // INDENT
      while (!this.check(TokenType.Dedent) && !this.isAtEnd()) {
        this.skipNewlines();
        if (this.check(TokenType.Dedent)) break;

        let condition: Node | null = null;
        if (!this.check(TokenType.FatArrow)) {
          condition = this.parseExpression();
        }
        this.expect(TokenType.FatArrow, '=>');
        this.skipNewlines();
        const body = this.check(TokenType.Indent) ? this.parseBlock() : this.parseExpression();
        cases.push({ kind: 'SwitchCase', condition, body });
        this.skipNewlines();
      }
      if (this.check(TokenType.Dedent)) this.advance();
    }

    return { kind: 'SwitchStmt', expr, cases };
  }

  // ── Block ─────────────────────────────────────────

  private parseBlock(): BlockStmt {
    this.expect(TokenType.Indent, 'INDENT');
    const body = this.parseStatements();
    if (this.check(TokenType.Dedent)) this.advance();
    return { kind: 'BlockStmt', body };
  }

  // ── Expression statement ──────────────────────────

  private parseExpressionStatement(): Node {
    const expr = this.parseExpression();

    // Check for assignment: `expr = value` or `:= value`
    if (this.check(TokenType.Assign)) {
      this.advance();
      const value = this.parseExpression();
      // Was this actually a declaration? (e.g., `float x = 5`)
      if (expr.kind === 'Identifier') {
        return {
          kind: 'VariableDecl',
          name: expr.name,
          typeAnnotation: null,
          initializer: value,
          qualifier: null,
          isExport: false,
        };
      }
      return { kind: 'AssignmentStmt', target: expr, value };
    }

    if (this.check(TokenType.ColonAssign)) {
      this.advance();
      const value = this.parseExpression();
      return { kind: 'AssignmentStmt', target: expr, value };
    }

    // Compound assignment
    const compoundOps: [TokenType, string][] = [
      [TokenType.PlusAssign, '+='],
      [TokenType.MinusAssign, '-='],
      [TokenType.StarAssign, '*='],
      [TokenType.SlashAssign, '/='],
      [TokenType.PercentAssign, '%='],
    ];
    for (const [tt, op] of compoundOps) {
      if (this.check(tt)) {
        this.advance();
        const value = this.parseExpression();
        return { kind: 'CompoundAssignStmt', operator: op as any, target: expr, value };
      }
    }

    // Check if this is a typed variable declaration: `float myVar = expr`
    // This happens when we parsed a type keyword as an identifier
    if (expr.kind === 'Identifier' && this.isTypeIdentifier(expr.name) && this.check(TokenType.Identifier)) {
      const name = this.advance().value;
      if (this.match(TokenType.Assign)) {
        const initializer = this.parseExpression();
        return {
          kind: 'VariableDecl',
          name,
          typeAnnotation: { kind: 'TypeAnnotation', baseType: expr.name, qualifier: null, isArray: false },
          initializer,
          qualifier: null,
          isExport: false,
        };
      }
    }

    return { kind: 'ExpressionStmt', expression: expr };
  }

  // ── Expressions (precedence climbing) ─────────────

  private parseExpression(): Node {
    return this.parseTernary();
  }

  private parseTernary(): Node {
    let expr = this.parseOr();
    if (this.check(TokenType.Question)) {
      this.advance();
      const consequent = this.parseExpression();
      this.expect(TokenType.Colon, ':');
      const alternate = this.parseExpression();
      return { kind: 'TernaryExpr', condition: expr, consequent, alternate };
    }
    return expr;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.check(TokenType.Or)) {
      this.advance();
      const right = this.parseAnd();
      left = { kind: 'BinaryExpr', operator: 'or', left, right };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseComparison();
    while (this.check(TokenType.And)) {
      this.advance();
      const right = this.parseComparison();
      left = { kind: 'BinaryExpr', operator: 'and', left, right };
    }
    return left;
  }

  private parseComparison(): Node {
    let left = this.parseAddition();
    const compOps = [
      TokenType.Equal, TokenType.NotEqual,
      TokenType.Greater, TokenType.GreaterEq,
      TokenType.Less, TokenType.LessEq,
    ];
    while (compOps.some(t => this.check(t))) {
      const op = this.advance().value;
      const right = this.parseAddition();
      left = { kind: 'BinaryExpr', operator: op, left, right };
    }
    return left;
  }

  private parseAddition(): Node {
    let left = this.parseMultiplication();
    while (this.check(TokenType.Plus) || this.check(TokenType.Minus)) {
      const op = this.advance().value;
      const right = this.parseMultiplication();
      left = { kind: 'BinaryExpr', operator: op, left, right };
    }
    return left;
  }

  private parseMultiplication(): Node {
    let left = this.parseUnary();
    while (this.check(TokenType.Star) || this.check(TokenType.Slash) || this.check(TokenType.Percent)) {
      const op = this.advance().value;
      const right = this.parseUnary();
      left = { kind: 'BinaryExpr', operator: op, left, right };
    }
    return left;
  }

  private parseUnary(): Node {
    if (this.check(TokenType.Not)) {
      this.advance();
      const operand = this.parseUnary();
      return { kind: 'UnaryExpr', operator: 'not', operand };
    }
    if (this.check(TokenType.Minus)) {
      this.advance();
      const operand = this.parseUnary();
      return { kind: 'UnaryExpr', operator: '-', operand };
    }
    if (this.check(TokenType.Plus)) {
      this.advance();
      return this.parseUnary();
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Node {
    let expr = this.parsePrimary();

    while (true) {
      if (this.check(TokenType.Dot)) {
        this.advance();
        const property = this.expect(TokenType.Identifier, 'property name').value;
        // Check if this is a method call: obj.method(args)
        if (this.check(TokenType.LParen)) {
          const args = this.parseCallArgs();
          expr = { kind: 'MethodCallExpr', object: expr, method: property, args };
        } else {
          expr = { kind: 'MemberExpr', object: expr, property };
        }
      } else if (this.check(TokenType.LBracket)) {
        this.advance();
        const index = this.parseExpression();
        this.expect(TokenType.RBracket, ']');
        expr = { kind: 'IndexExpr', object: expr, index };
      } else if (this.check(TokenType.LParen) && expr.kind === 'Identifier') {
        const args = this.parseCallArgs();
        expr = { kind: 'CallExpr', callee: expr, args };
      } else if (this.check(TokenType.LParen) && expr.kind === 'MemberExpr') {
        const args = this.parseCallArgs();
        expr = { kind: 'CallExpr', callee: expr, args };
      } else {
        break;
      }
    }

    return expr;
  }

  private parsePrimary(): Node {
    // Number
    if (this.check(TokenType.Number)) {
      return { kind: 'NumberLiteral', value: parseFloat(this.advance().value) };
    }

    // String
    if (this.check(TokenType.String)) {
      return { kind: 'StringLiteral', value: this.advance().value };
    }

    // Bool
    if (this.check(TokenType.Bool)) {
      return { kind: 'BoolLiteral', value: this.advance().value === 'true' };
    }

    // na
    if (this.check(TokenType.Na)) {
      this.advance();
      return { kind: 'NaLiteral' };
    }

    // Color
    if (this.check(TokenType.Color)) {
      return { kind: 'ColorLiteral', value: this.advance().value };
    }

    // Parenthesized expression
    if (this.check(TokenType.LParen)) {
      this.advance();
      const expr = this.parseExpression();
      this.expect(TokenType.RParen, ')');
      return expr;
    }

    // Array literal [a, b, c]
    if (this.check(TokenType.LBracket)) {
      return this.parseArrayLiteral();
    }

    // if expression (inline)
    if (this.check(TokenType.If)) {
      return this.parseIfStmt();
    }

    // switch expression
    if (this.check(TokenType.Switch)) {
      return this.parseSwitchStmt();
    }

    // for expression
    if (this.check(TokenType.For)) {
      return this.parseForStmt();
    }

    // Type keywords used as identifiers (e.g., `input`, `series`)
    if (this.isTypeKeyword()) {
      return { kind: 'Identifier', name: this.advance().value };
    }

    // Identifier
    if (this.check(TokenType.Identifier)) {
      return { kind: 'Identifier', name: this.advance().value };
    }

    // If we get here, skip the token and return a placeholder
    const tok = this.advance();
    return { kind: 'Identifier', name: tok.value || '__unknown__' };
  }

  private parseArrayLiteral(): Node {
    this.advance(); // '['
    const elements: Node[] = [];
    while (!this.check(TokenType.RBracket) && !this.isAtEnd()) {
      this.skipNewlines();
      elements.push(this.parseExpression());
      this.skipNewlines();
      if (!this.check(TokenType.RBracket)) this.expect(TokenType.Comma, ',');
    }
    this.expect(TokenType.RBracket, ']');
    return { kind: 'ArrayLiteral', elements };
  }

  // ── Call arguments ────────────────────────────────

  private parseCallArgs(): CallArg[] {
    this.expect(TokenType.LParen, '(');
    const args: CallArg[] = [];
    while (!this.check(TokenType.RParen) && !this.isAtEnd()) {
      this.skipNewlines();
      // Check for named argument: name=value
      // Name can be an Identifier or a keyword used as parameter name (e.g. color, type)
      let name: string | null = null;
      if ((this.check(TokenType.Identifier) || this.isTypeKeyword()) && this.peekNext()?.type === TokenType.Assign) {
        name = this.advance().value;
        this.advance(); // '='
      }
      const value = this.parseExpression();
      args.push({ name, value });
      this.skipNewlines();
      if (!this.check(TokenType.RParen)) {
        this.expect(TokenType.Comma, ',');
        this.skipNewlines();
      }
    }
    this.expect(TokenType.RParen, ')');
    return args;
  }

  // ── Type annotations ──────────────────────────────

  private parseTypeAnnotation(): TypeAnnotation {
    let qualifier: string | null = null;
    if (this.check(TokenType.Series) || this.check(TokenType.Simple) ||
        this.check(TokenType.Const) || this.check(TokenType.Input)) {
      qualifier = this.advance().value;
    }

    const baseType = this.advance().value;
    let isArray = false;
    if (this.check(TokenType.LBracket) && this.peekNext()?.type === TokenType.RBracket) {
      this.advance(); // '['
      this.advance(); // ']'
      isArray = true;
    }

    return { kind: 'TypeAnnotation', baseType, qualifier, isArray };
  }

  private isTypeKeyword(): boolean {
    return (
      this.check(TokenType.Int) || this.check(TokenType.Float) ||
      this.check(TokenType.StringType) || this.check(TokenType.BoolType) ||
      this.check(TokenType.ColorType) || this.check(TokenType.Series) ||
      this.check(TokenType.Simple) || this.check(TokenType.Const) ||
      this.check(TokenType.Input)
    );
  }

  private isTypeIdentifier(name: string): boolean {
    return ['int', 'float', 'string', 'bool', 'color', 'series', 'simple', 'array', 'matrix', 'map', 'line', 'label', 'box', 'table'].includes(name);
  }

  // ── Token helpers ─────────────────────────────────

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: TokenType.EOF, value: '', line: 0, col: 0 };
  }

  private peekNext(): Token | null {
    return this.tokens[this.pos + 1] ?? null;
  }

  private advance(): Token {
    const tok = this.peek();
    this.pos++;
    return tok;
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private match(type: TokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expect(type: TokenType, name: string): Token {
    if (this.check(type)) return this.advance();
    const tok = this.peek();
    throw new SyntaxError(
      `Expected ${name} but got ${tok.type} "${tok.value}" at line ${tok.line}:${tok.col}`,
    );
  }

  private skipNewlines(): void {
    while (this.check(TokenType.Newline)) this.advance();
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }
}
