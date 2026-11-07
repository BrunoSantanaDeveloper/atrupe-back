import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_BASE_FILE,
  applySupportBase,
  parseSupportBase,
  readDefaultSupportBase,
} from './atendimento-base-suporte';
import { findKitDir } from './atendimento-kit';

describe('base de suporte → contexto do robô', () => {
  const markdown = readFileSync(join(findKitDir(), DEFAULT_BASE_FILE), 'utf8');
  const parsed = readDefaultSupportBase();

  it('lê a base que acompanha o código', () => {
    expect(parsed).not.toBeNull();
    expect(parsed.version).toBe(
      'Versão de 29/10/2026. Conferida com o sistema nesta data.',
    );
  });

  it('cada tópico ### vira uma pergunta e resposta', () => {
    const topics = markdown.match(/^### /gm).length;
    expect(parsed.knowledge).toHaveLength(topics);
    const setores = parsed.knowledge.find((item) => item.title === 'Setores');
    expect(setores.q).toBe(
      'Setores — como criar setor; renomear setor; desativar setor; produtos sumiram do orçamento; setor no orçamento',
    );
    expect(setores.a).toMatch(
      /^Onde fica: Configurações › Empresa e sistema › Setores/,
    );
    expect(setores.a).not.toContain('Perguntas que trazem aqui');
    expect(setores.a).not.toContain('**');
  });

  it('as regras gerais vão para as instruções, sem os tópicos', () => {
    expect(parsed.instructions).toMatch(
      /^Base de suporte do Atrupe \(Versão de 29\/10\/2026/,
    );
    for (const section of [
      'Instruções para o atendente:',
      'Quando passar para uma pessoa:',
      'O que o Start inclui:',
      'O que não faz parte do Start:',
    ]) {
      expect(parsed.instructions).toContain(section);
    }
    expect(parsed.instructions).toContain('não acessa a conta do cliente');
    expect(parsed.instructions).not.toContain('Cadastrar e editar produtos');
    expect(parsed.instructions).not.toContain('**');
  });

  it('cabe nos limites do kit (instruções, pergunta, resposta e total)', () => {
    expect(parsed.instructions.length).toBeLessThanOrEqual(20_000);
    let total = 0;
    for (const item of parsed.knowledge) {
      expect(item.q.length).toBeLessThanOrEqual(500);
      expect(item.a.length).toBeLessThanOrEqual(5_000);
      expect(item.q.trim()).not.toBe('');
      expect(item.a.trim()).not.toBe('');
      total += item.q.length + item.a.length;
    }
    expect(total).toBeLessThanOrEqual(150_000);
  });

  it('aplicar a mesma base duas vezes não duplica nada', () => {
    const empty = { knowledge: [], instructions: '' } as any;
    const first = applySupportBase(empty, parsed).settings;
    const second = applySupportBase(first, parsed);
    expect(second.settings.knowledge).toEqual(first.knowledge);
    expect(second.summary).toMatchObject({
      updated: parsed.knowledge.length,
      added: 0,
      kept: 0,
    });
  });

  it('aceita fim de linha do Windows', () => {
    const crlf = parseSupportBase(
      '## Regras\r\n\r\n- Uma\r\n\r\n### Tema\r\n\r\nTexto\r\n',
    );
    expect(crlf.instructions).toBe('Regras:\n- Uma');
    expect(crlf.knowledge).toEqual([{ title: 'Tema', q: 'Tema', a: 'Texto' }]);
  });
});
