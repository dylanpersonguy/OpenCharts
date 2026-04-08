// ── PineScript Abstract Syntax Tree ──────────────────

export type Node =
  | Program
  | VersionDirective
  | IndicatorDecl
  | StrategyDecl
  | LibraryDecl
  | VariableDecl
  | AssignmentStmt
  | CompoundAssignStmt
  | IfStmt
  | ForStmt
  | ForInStmt
  | WhileStmt
  | SwitchStmt
  | SwitchCase
  | FunctionDecl
  | TypeDecl
  | TypeField
  | ReturnExpr
  | BreakStmt
  | ContinueStmt
  | ExpressionStmt
  | BlockStmt
  | BinaryExpr
  | UnaryExpr
  | TernaryExpr
  | CallExpr
  | MethodCallExpr
  | MemberExpr
  | IndexExpr
  | NumberLiteral
  | StringLiteral
  | BoolLiteral
  | ColorLiteral
  | NaLiteral
  | Identifier
  | ArrayLiteral
  | TypeAnnotation;

// ── Root ─────────────────────────────────────────────

export interface Program {
  kind: 'Program';
  version: number | null;
  body: Node[];
}

// ── Declarations ─────────────────────────────────────

export interface VersionDirective {
  kind: 'VersionDirective';
  version: number;
}

export interface IndicatorDecl {
  kind: 'IndicatorDecl';
  args: CallArg[];
}

export interface StrategyDecl {
  kind: 'StrategyDecl';
  args: CallArg[];
}

export interface LibraryDecl {
  kind: 'LibraryDecl';
  args: CallArg[];
}

export interface VariableDecl {
  kind: 'VariableDecl';
  name: string;
  typeAnnotation: TypeAnnotation | null;
  initializer: Node;
  qualifier: 'var' | 'varip' | null;
  isExport: boolean;
}

export interface AssignmentStmt {
  kind: 'AssignmentStmt';
  target: Node;
  value: Node;
}

export interface CompoundAssignStmt {
  kind: 'CompoundAssignStmt';
  operator: '+=' | '-=' | '*=' | '/=' | '%=';
  target: Node;
  value: Node;
}

export interface FunctionDecl {
  kind: 'FunctionDecl';
  name: string;
  params: FunctionParam[];
  body: Node;
  isExport: boolean;
  isMethod: boolean;
}

export interface FunctionParam {
  name: string;
  typeAnnotation: TypeAnnotation | null;
  defaultValue: Node | null;
}

export interface TypeDecl {
  kind: 'TypeDecl';
  name: string;
  fields: TypeField[];
  isExport: boolean;
}

export interface TypeField {
  kind: 'TypeField';
  name: string;
  typeAnnotation: TypeAnnotation | null;
  defaultValue: Node | null;
}

export interface TypeAnnotation {
  kind: 'TypeAnnotation';
  baseType: string;
  qualifier: string | null; // 'series', 'simple', 'const', 'input'
  isArray: boolean;
}

// ── Control Flow ─────────────────────────────────────

export interface IfStmt {
  kind: 'IfStmt';
  condition: Node;
  consequent: Node;
  alternate: Node | null;
}

export interface ForStmt {
  kind: 'ForStmt';
  variable: string;
  start: Node;
  end: Node;
  step: Node | null;
  body: Node;
}

export interface ForInStmt {
  kind: 'ForInStmt';
  variable: string;
  iterable: Node;
  body: Node;
}

export interface WhileStmt {
  kind: 'WhileStmt';
  condition: Node;
  body: Node;
}

export interface SwitchStmt {
  kind: 'SwitchStmt';
  expr: Node | null;
  cases: SwitchCase[];
}

export interface SwitchCase {
  kind: 'SwitchCase';
  condition: Node | null; // null = default
  body: Node;
}

export interface BreakStmt {
  kind: 'BreakStmt';
}

export interface ContinueStmt {
  kind: 'ContinueStmt';
}

// ── Expressions ──────────────────────────────────────

export interface ExpressionStmt {
  kind: 'ExpressionStmt';
  expression: Node;
}

export interface BlockStmt {
  kind: 'BlockStmt';
  body: Node[];
}

export interface ReturnExpr {
  kind: 'ReturnExpr';
  value: Node | null;
}

export interface BinaryExpr {
  kind: 'BinaryExpr';
  operator: string;
  left: Node;
  right: Node;
}

export interface UnaryExpr {
  kind: 'UnaryExpr';
  operator: string;
  operand: Node;
}

export interface TernaryExpr {
  kind: 'TernaryExpr';
  condition: Node;
  consequent: Node;
  alternate: Node;
}

export interface CallExpr {
  kind: 'CallExpr';
  callee: Node;
  args: CallArg[];
}

export interface MethodCallExpr {
  kind: 'MethodCallExpr';
  object: Node;
  method: string;
  args: CallArg[];
}

export interface CallArg {
  name: string | null; // named arg: `title="RSI"` → name="title"
  value: Node;
}

export interface MemberExpr {
  kind: 'MemberExpr';
  object: Node;
  property: string;
}

export interface IndexExpr {
  kind: 'IndexExpr';
  object: Node;
  index: Node;
}

// ── Literals ─────────────────────────────────────────

export interface NumberLiteral {
  kind: 'NumberLiteral';
  value: number;
}

export interface StringLiteral {
  kind: 'StringLiteral';
  value: string;
}

export interface BoolLiteral {
  kind: 'BoolLiteral';
  value: boolean;
}

export interface ColorLiteral {
  kind: 'ColorLiteral';
  value: string; // e.g. "#FF0000"
}

export interface NaLiteral {
  kind: 'NaLiteral';
}

export interface Identifier {
  kind: 'Identifier';
  name: string;
}

export interface ArrayLiteral {
  kind: 'ArrayLiteral';
  elements: Node[];
}
