// ── PineScript Token Types ────────────────────────────

export enum TokenType {
  // Literals
  Number = 'Number',
  String = 'String',
  Color = 'Color',
  Bool = 'Bool',
  Na = 'Na',

  // Identifiers & keywords
  Identifier = 'Identifier',
  VersionDirective = 'VersionDirective',

  // Declaration keywords
  Var = 'Var',
  Varip = 'Varip',
  Export = 'Export',
  Import = 'Import',
  Type = 'Type',
  Method = 'Method',

  // Control flow
  If = 'If',
  Else = 'Else',
  For = 'For',
  While = 'While',
  Switch = 'Switch',
  To = 'To',
  By = 'By',
  In = 'In',
  Break = 'Break',
  Continue = 'Continue',

  // Type keywords
  Int = 'Int',
  Float = 'Float',
  StringType = 'StringType',
  BoolType = 'BoolType',
  ColorType = 'ColorType',
  Series = 'Series',
  Simple = 'Simple',
  Const = 'Const',
  Input = 'Input',

  // Function / indicator
  Indicator = 'Indicator',
  Strategy = 'Strategy',
  Library = 'Library',

  // Operators
  Plus = 'Plus',
  Minus = 'Minus',
  Star = 'Star',
  Slash = 'Slash',
  Percent = 'Percent',
  Assign = 'Assign',
  ColonAssign = 'ColonAssign',
  PlusAssign = 'PlusAssign',
  MinusAssign = 'MinusAssign',
  StarAssign = 'StarAssign',
  SlashAssign = 'SlashAssign',
  PercentAssign = 'PercentAssign',
  FatArrow = 'FatArrow',
  Equal = 'Equal',
  NotEqual = 'NotEqual',
  Greater = 'Greater',
  GreaterEq = 'GreaterEq',
  Less = 'Less',
  LessEq = 'LessEq',
  And = 'And',
  Or = 'Or',
  Not = 'Not',
  Question = 'Question',
  Colon = 'Colon',

  // Delimiters
  LParen = 'LParen',
  RParen = 'RParen',
  LBracket = 'LBracket',
  RBracket = 'RBracket',
  Comma = 'Comma',
  Dot = 'Dot',

  // Whitespace / structure
  Newline = 'Newline',
  Indent = 'Indent',
  Dedent = 'Dedent',
  EOF = 'EOF',

  // Comments (usually skipped, but useful for round-trips)
  Comment = 'Comment',
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

// ── Keyword map ──────────────────────────────────────

const KEYWORDS: Record<string, TokenType> = {
  var: TokenType.Var,
  varip: TokenType.Varip,
  export: TokenType.Export,
  import: TokenType.Import,
  type: TokenType.Type,
  method: TokenType.Method,
  if: TokenType.If,
  else: TokenType.Else,
  for: TokenType.For,
  while: TokenType.While,
  switch: TokenType.Switch,
  to: TokenType.To,
  by: TokenType.By,
  in: TokenType.In,
  break: TokenType.Break,
  continue: TokenType.Continue,
  int: TokenType.Int,
  float: TokenType.Float,
  string: TokenType.StringType,
  bool: TokenType.BoolType,
  color: TokenType.ColorType,
  series: TokenType.Series,
  simple: TokenType.Simple,
  const: TokenType.Const,
  input: TokenType.Input,
  true: TokenType.Bool,
  false: TokenType.Bool,
  na: TokenType.Na,
  and: TokenType.And,
  or: TokenType.Or,
  not: TokenType.Not,
  indicator: TokenType.Indicator,
  strategy: TokenType.Strategy,
  library: TokenType.Library,
};

// ── Lexer ────────────────────────────────────────────

export class Lexer {
  private src: string;
  private pos = 0;
  private line = 1;
  private col = 1;
  private tokens: Token[] = [];
  private indentStack: number[] = [0];

  constructor(source: string) {
    this.src = source;
  }

  tokenize(): Token[] {
    this.tokens = [];
    this.pos = 0;
    this.line = 1;
    this.col = 1;
    this.indentStack = [0];

    while (this.pos < this.src.length) {
      this.scanToken();
    }

    // Emit remaining dedents
    while (this.indentStack.length > 1) {
      this.indentStack.pop();
      this.tokens.push(this.makeToken(TokenType.Dedent, ''));
    }

    this.tokens.push(this.makeToken(TokenType.EOF, ''));
    return this.tokens;
  }

  // ── Scanning ─────────────────────────────────────

  private scanToken(): void {
    const ch = this.peek();

    // Handle newlines + indentation
    if (ch === '\n') {
      this.tokens.push(this.makeToken(TokenType.Newline, '\n'));
      this.advance();
      this.handleIndentation();
      return;
    }

    // Carriage return (skip, handled with \n)
    if (ch === '\r') {
      this.advance();
      return;
    }

    // Skip spaces/tabs within a line (not at line start—those are handled by handleIndentation)
    if (ch === ' ' || ch === '\t') {
      this.advance();
      return;
    }

    // Version directive: //@version=N
    if (ch === '/' && this.peekAt(1) === '/' && this.peekAt(2) === '@') {
      this.scanVersionOrComment();
      return;
    }

    // Single-line comment
    if (ch === '/' && this.peekAt(1) === '/') {
      this.scanLineComment();
      return;
    }

    // String
    if (ch === '"' || ch === "'") {
      this.scanString(ch);
      return;
    }

    // Number
    if (this.isDigit(ch) || (ch === '.' && this.isDigit(this.peekAt(1)))) {
      this.scanNumber();
      return;
    }

    // Color literal (#RRGGBB or #RRGGBBAA)
    if (ch === '#' && this.isHex(this.peekAt(1))) {
      this.scanColor();
      return;
    }

    // Multi-char operators
    if (this.tryOperator()) return;

    // Single-char tokens
    const singleMap: Record<string, TokenType> = {
      '(': TokenType.LParen,
      ')': TokenType.RParen,
      '[': TokenType.LBracket,
      ']': TokenType.RBracket,
      ',': TokenType.Comma,
      '.': TokenType.Dot,
      '+': TokenType.Plus,
      '-': TokenType.Minus,
      '*': TokenType.Star,
      '/': TokenType.Slash,
      '%': TokenType.Percent,
      '?': TokenType.Question,
      ':': TokenType.Colon,
      '>': TokenType.Greater,
      '<': TokenType.Less,
      '=': TokenType.Assign,
    };

    if (singleMap[ch]) {
      this.tokens.push(this.makeToken(singleMap[ch], ch));
      this.advance();
      return;
    }

    // Identifier / keyword
    if (this.isIdentStart(ch)) {
      this.scanIdentifier();
      return;
    }

    // Unknown character — skip
    this.advance();
  }

  private tryOperator(): boolean {
    const ops: [string, TokenType][] = [
      [':=', TokenType.ColonAssign],
      ['+=', TokenType.PlusAssign],
      ['-=', TokenType.MinusAssign],
      ['*=', TokenType.StarAssign],
      ['/=', TokenType.SlashAssign],
      ['%=', TokenType.PercentAssign],
      ['=>', TokenType.FatArrow],
      ['==', TokenType.Equal],
      ['!=', TokenType.NotEqual],
      ['>=', TokenType.GreaterEq],
      ['<=', TokenType.LessEq],
    ];

    for (const [op, type] of ops) {
      if (this.src.startsWith(op, this.pos)) {
        this.tokens.push(this.makeToken(type, op));
        for (let i = 0; i < op.length; i++) this.advance();
        return true;
      }
    }
    return false;
  }

  // ── Indentation ──────────────────────────────────

  private handleIndentation(): void {
    let indent = 0;
    while (this.pos < this.src.length) {
      const ch = this.peek();
      if (ch === ' ') { indent++; this.advance(); }
      else if (ch === '\t') { indent += 4; this.advance(); }
      else break;
    }

    // Skip blank lines
    if (this.pos >= this.src.length || this.peek() === '\n' || this.peek() === '\r') return;
    // Skip comment-only lines for indent purposes
    if (this.peek() === '/' && this.peekAt(1) === '/') return;

    const current = this.indentStack[this.indentStack.length - 1];
    if (indent > current) {
      this.indentStack.push(indent);
      this.tokens.push(this.makeToken(TokenType.Indent, ''));
    } else {
      while (this.indentStack.length > 1 && indent < this.indentStack[this.indentStack.length - 1]) {
        this.indentStack.pop();
        this.tokens.push(this.makeToken(TokenType.Dedent, ''));
      }
    }
  }

  // ── Scanners ─────────────────────────────────────

  private scanVersionOrComment(): void {
    const start = this.pos;
    // Check for //@version=
    const match = this.src.slice(this.pos).match(/^\/\/@version=(\d+)/);
    if (match) {
      const val = match[0];
      this.tokens.push(this.makeToken(TokenType.VersionDirective, val));
      for (let i = 0; i < val.length; i++) this.advance();
      return;
    }
    // Otherwise treat as comment
    this.scanLineComment();
  }

  private scanLineComment(): void {
    const start = this.pos;
    while (this.pos < this.src.length && this.peek() !== '\n') {
      this.advance();
    }
    // We skip comments — don't push a token
    // (uncomment below to preserve comments in the token stream)
    // this.tokens.push(this.makeToken(TokenType.Comment, this.src.slice(start, this.pos)));
  }

  private scanString(quote: string): void {
    this.advance(); // opening quote
    let value = '';
    while (this.pos < this.src.length && this.peek() !== quote) {
      if (this.peek() === '\\') {
        this.advance();
        const esc = this.peek();
        const escMap: Record<string, string> = { n: '\n', t: '\t', '\\': '\\', "'": "'", '"': '"' };
        value += escMap[esc] ?? esc;
      } else {
        value += this.peek();
      }
      this.advance();
    }
    if (this.pos < this.src.length) this.advance(); // closing quote
    this.tokens.push(this.makeToken(TokenType.String, value));
  }

  private scanNumber(): void {
    const start = this.pos;
    while (this.pos < this.src.length && this.isDigit(this.peek())) this.advance();
    if (this.peek() === '.' && this.isDigit(this.peekAt(1))) {
      this.advance(); // .
      while (this.pos < this.src.length && this.isDigit(this.peek())) this.advance();
    }
    // Scientific notation
    if (this.peek() === 'e' || this.peek() === 'E') {
      this.advance();
      if (this.peek() === '+' || this.peek() === '-') this.advance();
      while (this.pos < this.src.length && this.isDigit(this.peek())) this.advance();
    }
    this.tokens.push(this.makeToken(TokenType.Number, this.src.slice(start, this.pos)));
  }

  private scanColor(): void {
    const start = this.pos;
    this.advance(); // #
    while (this.pos < this.src.length && this.isHex(this.peek())) this.advance();
    this.tokens.push(this.makeToken(TokenType.Color, this.src.slice(start, this.pos)));
  }

  private scanIdentifier(): void {
    const start = this.pos;
    while (this.pos < this.src.length && this.isIdentPart(this.peek())) this.advance();
    const value = this.src.slice(start, this.pos);
    const type = KEYWORDS[value] ?? TokenType.Identifier;
    this.tokens.push(this.makeToken(type, value));
  }

  // ── Helpers ──────────────────────────────────────

  private peek(): string {
    return this.src[this.pos] ?? '\0';
  }

  private peekAt(offset: number): string {
    return this.src[this.pos + offset] ?? '\0';
  }

  private advance(): void {
    if (this.src[this.pos] === '\n') {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    this.pos++;
  }

  private makeToken(type: TokenType, value: string): Token {
    return { type, value, line: this.line, col: this.col };
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isHex(ch: string): boolean {
    return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  private isIdentPart(ch: string): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch);
  }
}
