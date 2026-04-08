import { describe, it, expect } from 'vitest';
import { Lexer, TokenType } from '../lexer';

describe('Lexer', () => {
  it('tokenizes a version directive', () => {
    const tokens = new Lexer('//@version=5').tokenize();
    expect(tokens[0].type).toBe(TokenType.VersionDirective);
    expect(tokens[0].value).toBe('//@version=5');
  });

  it('tokenizes numbers', () => {
    const tokens = new Lexer('42 3.14 1e10').tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.Number, value: '42' });
    expect(tokens[1]).toMatchObject({ type: TokenType.Number, value: '3.14' });
    expect(tokens[2]).toMatchObject({ type: TokenType.Number, value: '1e10' });
  });

  it('tokenizes strings', () => {
    const tokens = new Lexer('"hello" \'world\'').tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.String, value: 'hello' });
    expect(tokens[1]).toMatchObject({ type: TokenType.String, value: 'world' });
  });

  it('tokenizes booleans and na', () => {
    const tokens = new Lexer('true false na').tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.Bool, value: 'true' });
    expect(tokens[1]).toMatchObject({ type: TokenType.Bool, value: 'false' });
    expect(tokens[2]).toMatchObject({ type: TokenType.Na, value: 'na' });
  });

  it('tokenizes colors', () => {
    const tokens = new Lexer('#FF0000 #00FF00AA').tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.Color, value: '#FF0000' });
    expect(tokens[1]).toMatchObject({ type: TokenType.Color, value: '#00FF00AA' });
  });

  it('tokenizes keywords', () => {
    const tokens = new Lexer('var varip if else for while').tokenize();
    expect(tokens[0].type).toBe(TokenType.Var);
    expect(tokens[1].type).toBe(TokenType.Varip);
    expect(tokens[2].type).toBe(TokenType.If);
    expect(tokens[3].type).toBe(TokenType.Else);
    expect(tokens[4].type).toBe(TokenType.For);
    expect(tokens[5].type).toBe(TokenType.While);
  });

  it('tokenizes operators', () => {
    const tokens = new Lexer(':= += == != >= <=').tokenize();
    expect(tokens[0].type).toBe(TokenType.ColonAssign);
    expect(tokens[1].type).toBe(TokenType.PlusAssign);
    expect(tokens[2].type).toBe(TokenType.Equal);
    expect(tokens[3].type).toBe(TokenType.NotEqual);
    expect(tokens[4].type).toBe(TokenType.GreaterEq);
    expect(tokens[5].type).toBe(TokenType.LessEq);
  });

  it('handles indentation', () => {
    const src = 'if true\n    x = 1\n    y = 2\n';
    const tokens = new Lexer(src).tokenize();
    const types = tokens.map(t => t.type);
    expect(types).toContain(TokenType.Indent);
    expect(types).toContain(TokenType.Dedent);
  });

  it('skips line comments', () => {
    const tokens = new Lexer('x = 1 // comment\ny = 2').tokenize();
    const identifiers = tokens.filter(t => t.type === TokenType.Identifier);
    expect(identifiers).toHaveLength(2);
    expect(identifiers[0].value).toBe('x');
    expect(identifiers[1].value).toBe('y');
  });

  it('produces EOF', () => {
    const tokens = new Lexer('x').tokenize();
    expect(tokens[tokens.length - 1].type).toBe(TokenType.EOF);
  });
});
