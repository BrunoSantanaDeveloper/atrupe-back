import { readFileSync } from 'fs';
import { join } from 'path';
import { findKitDir } from './atendimento-kit';

import type {
  Hours,
  KnowledgeItem,
  PlatformSettings,
} from '../../../atendimento/base/shared/settings.mjs';

/**
 * A base de suporte (o texto para o agente do WhatsApp, em Markdown) vira o
 * contexto do robô:
 *
 * - as seções `##` sem subtítulos (instruções, quando passar para uma pessoa,
 *   o que o plano inclui) vão para as instruções, que entram inteiras em toda
 *   resposta;
 * - cada `###` vira uma pergunta e resposta do conhecimento: a pergunta é o
 *   título mais as "Perguntas que trazem aqui"; a resposta, o resto da seção.
 *
 * A versão de 29/10/2026 fica em `atendimento/conhecimento/` e é o ponto de
 * partida do robô até o superadmin salvar a primeira vez; versões novas entram
 * pela tela (importar a base), que mostra o resultado antes de gravar.
 */

const QUESTION_MAX = 500;
const ANSWER_MAX = 5000;
const QUESTIONS_LINE = /^\*\*Perguntas que trazem aqui:\*\*\s*(.*)$/i;

export const DEFAULT_BASE_FILE = 'conhecimento/base-suporte-start.md';

/** Horário da equipe (Regras Comerciais, 29/10/2026): seg. a sex., 08–12 e 13:30–18. */
export const TEAM_HOURS: Hours = {
  timezone: 'America/Sao_Paulo',
  days: {
    seg: [
      ['08:00', '12:00'],
      ['13:30', '18:00'],
    ],
    ter: [
      ['08:00', '12:00'],
      ['13:30', '18:00'],
    ],
    qua: [
      ['08:00', '12:00'],
      ['13:30', '18:00'],
    ],
    qui: [
      ['08:00', '12:00'],
      ['13:30', '18:00'],
    ],
    sex: [
      ['08:00', '12:00'],
      ['13:30', '18:00'],
    ],
    sab: [],
    dom: [],
  },
  holidays: [],
};

export interface ParsedSupportBase {
  version: string | null;
  instructions: string;
  knowledge: Array<KnowledgeItem & { title: string }>;
}

/** O WhatsApp não mostra Markdown: tira o negrito e deixa o resto. */
const plain = (text: string) => text.replace(/\*\*(.+?)\*\*/g, '$1');

function clip(text: string, max: number, separator = ' '): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(separator);
  return (at > max / 2 ? cut.slice(0, at) : cut).trim();
}

const tidy = (lines: string[]) =>
  lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export function parseSupportBase(markdown: string): ParsedSupportBase {
  const lines = String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  let version: string | null = null;
  const instructions: string[] = [];
  const knowledge: ParsedSupportBase['knowledge'] = [];

  let section: { title: string; body: string[] } | null = null;
  let item: { title: string; body: string[]; questions: string } | null = null;

  const closeItem = () => {
    if (!item) return;
    const answer = clip(plain(tidy(item.body)), ANSWER_MAX, '\n');
    if (answer) {
      const question = item.questions
        ? `${item.title} — ${item.questions}`
        : item.title;
      knowledge.push({
        title: item.title,
        q: clip(question, QUESTION_MAX, ';'),
        a: answer,
      });
    }
    item = null;
  };
  const closeSection = () => {
    closeItem();
    if (section) {
      const body = plain(tidy(section.body));
      if (body) instructions.push(`${section.title}:\n${body}`);
    }
    section = null;
  };

  for (const line of lines) {
    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    const h2 = !h3 && /^##\s+(.+?)\s*$/.exec(line);
    const h1 = !h3 && !h2 && /^#\s+(.+?)\s*$/.exec(line);
    if (h1) continue;
    if (h2) {
      closeSection();
      section = { title: h2[1], body: [] };
      continue;
    }
    if (h3) {
      closeItem();
      item = { title: h3[1], body: [], questions: '' };
      continue;
    }
    if (item) {
      const questions = QUESTIONS_LINE.exec(line.trim());
      if (questions) item.questions = questions[1].trim();
      else item.body.push(line);
      continue;
    }
    if (section) {
      section.body.push(line);
      continue;
    }
    if (!version && line.trim()) version = plain(line.trim());
  }
  closeSection();

  return {
    version,
    instructions: [
      version ? `Base de suporte do Atrupe (${version})` : '',
      ...instructions,
    ]
      .filter(Boolean)
      .join('\n\n'),
    knowledge,
  };
}

/** A base que acompanha o código, ou nula se o arquivo não estiver lá. */
export function readDefaultSupportBase(): ParsedSupportBase | null {
  try {
    return parseSupportBase(
      readFileSync(join(findKitDir(), DEFAULT_BASE_FILE), 'utf8'),
    );
  } catch {
    return null;
  }
}

export interface ImportSummary {
  version: string | null;
  updated: number;
  added: number;
  kept: number;
}

/**
 * Aplica uma versão da base sobre a camada da plataforma, sem gravar: troca
 * as instruções, troca as perguntas da base pelo título (as que o superadmin
 * aprovou a partir das conversas ficam) e acrescenta as novas.
 */
export function applySupportBase(
  current: PlatformSettings,
  parsed: ParsedSupportBase,
): { settings: PlatformSettings; summary: ImportSummary } {
  const byTitle = new Map(
    parsed.knowledge.map((entry) => [entry.title, entry]),
  );
  const titleOf = (question: string) =>
    [...byTitle.keys()].find(
      (title) => question === title || question.startsWith(`${title} — `),
    );
  const used = new Set<string>();
  let updated = 0;
  let kept = 0;
  const knowledge: KnowledgeItem[] = [];
  for (const entry of current.knowledge ?? []) {
    const title = titleOf(String(entry.q ?? ''));
    if (title && !used.has(title)) {
      const fresh = byTitle.get(title);
      knowledge.push({ q: fresh.q, a: fresh.a });
      used.add(title);
      updated += 1;
    } else if (!title) {
      knowledge.push(entry);
      kept += 1;
    }
  }
  let added = 0;
  for (const entry of parsed.knowledge) {
    if (used.has(entry.title)) continue;
    knowledge.push({ q: entry.q, a: entry.a });
    added += 1;
  }
  return {
    settings: {
      ...current,
      instructions: parsed.instructions,
      knowledge,
    },
    summary: { version: parsed.version, updated, added, kept },
  };
}
