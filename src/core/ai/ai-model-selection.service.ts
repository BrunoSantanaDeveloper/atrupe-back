import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { PrismaService } from 'nestjs-prisma';
import { UpdateAiModelConfigDto } from './dto/ai-model-config.dto';
import { zeroDataRetentionRequired } from './providers/openrouter-data-policy';

const CONFIG_KEY = 'ai_model_config';
const CANDIDATES_KEY = 'ai_model_candidates';
const STANDARD_INPUT_TOKENS = 4000;
const STANDARD_OUTPUT_TOKENS = 1000;
const STANDARD_CALLS_WITH_TOOLS = 2;

export interface AiModelConfig {
  activeModel: string;
  autoSelectionEnabled: boolean;
  allowlist: string[];
  blacklist: string[];
  minContext: number;
  degradedModels?: Record<
    string,
    {
      lastFailureAt: string;
      reason: string;
      statusCode?: number;
      consecutiveFailures: number;
    }
  >;
  lastEvaluationAt?: string;
  lastSwitchAt?: string;
  lastSwitchReason?: string;
}

export interface AiModelCandidate {
  id: string;
  name?: string;
  contextLength: number;
  promptPrice: number;
  completionPrice: number;
  estimatedQuestionCost: number;
  score: number;
  reasons: string[];
}

interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  supported_parameters?: string[];
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  architecture?: {
    output_modalities?: string[];
  };
  output_modalities?: string[];
}

interface OpenRouterEndpoint {
  model_id?: string;
  supported_parameters?: string[];
}

@Injectable()
export class AiModelSelectionService {
  private readonly logger = new Logger(AiModelSelectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getActiveModel(): Promise<string> {
    const modelConfig = await this.getConfig();
    return modelConfig.activeModel || this.config.get<string>('ai.model');
  }

  async getConfig(): Promise<AiModelConfig> {
    const existing = await this.prisma.systemSetting.findUnique({
      where: { key: CONFIG_KEY },
    });

    if (existing?.value) {
      return {
        ...this.defaultConfig(),
        ...(existing.value as unknown as Partial<AiModelConfig>),
      };
    }

    return this.defaultConfig();
  }

  async updateConfig(dto: UpdateAiModelConfigDto): Promise<AiModelConfig> {
    const current = await this.getConfig();
    const next: AiModelConfig = {
      ...current,
      ...dto,
      allowlist: this.normalizeList(dto.allowlist || current.allowlist),
      blacklist: this.normalizeList(dto.blacklist || current.blacklist),
      activeModel: dto.activeModel || current.activeModel,
      minContext: dto.minContext || current.minContext,
    };

    const saved = await this.prisma.systemSetting.upsert({
      where: { key: CONFIG_KEY },
      update: { value: next as any },
      create: { key: CONFIG_KEY, value: next as any },
    });

    return saved.value as unknown as AiModelConfig;
  }

  async recordModelFailure(
    model: string,
    reason: string,
    statusCode?: number,
  ): Promise<void> {
    if (!model) return;

    const current = await this.getConfig();
    const previous = current.degradedModels?.[model];
    const next: AiModelConfig = {
      ...current,
      degradedModels: {
        ...(current.degradedModels || {}),
        [model]: {
          lastFailureAt: new Date().toISOString(),
          reason,
          statusCode,
          consecutiveFailures: (previous?.consecutiveFailures || 0) + 1,
        },
      },
    };

    await this.prisma.systemSetting.upsert({
      where: { key: CONFIG_KEY },
      update: { value: next as any },
      create: { key: CONFIG_KEY, value: next as any },
    });
  }

  async recordModelSuccess(model: string): Promise<void> {
    if (!model) return;

    const current = await this.getConfig();
    if (!current.degradedModels?.[model]) return;

    const degradedModels = { ...current.degradedModels };
    delete degradedModels[model];

    await this.prisma.systemSetting.upsert({
      where: { key: CONFIG_KEY },
      update: { value: { ...current, degradedModels } as any },
      create: {
        key: CONFIG_KEY,
        value: { ...current, degradedModels } as any,
      },
    });
  }

  async getCandidates(): Promise<AiModelCandidate[]> {
    const existing = await this.prisma.systemSetting.findUnique({
      where: { key: CANDIDATES_KEY },
    });
    return ((existing?.value as any)?.candidates || []) as AiModelCandidate[];
  }

  @Cron('0 4 * * 1')
  async evaluateScheduled() {
    const modelConfig = await this.getConfig();
    if (!modelConfig.autoSelectionEnabled) return;

    try {
      await this.evaluateAndMaybeSwitch('scheduled');
    } catch (error) {
      this.logger.warn(
        `Falha ao avaliar modelos OpenRouter: ${error?.message || error}`,
      );
    }
  }

  async evaluateAndMaybeSwitch(trigger: 'manual' | 'scheduled' = 'manual') {
    const modelConfig = await this.getConfig();
    const models = await this.fetchOpenRouterModels();
    const zeroRetention = await this.fetchZeroRetentionModels();
    const candidates = this.rankCandidates(models, modelConfig, zeroRetention);
    const best = candidates[0] || null;
    const current = candidates.find(
      (item) => item.id === modelConfig.activeModel,
    );
    const decision = this.decideSwitch(modelConfig, current, best, trigger);

    const evaluatedAt = new Date().toISOString();

    await this.prisma.systemSetting.upsert({
      where: { key: CANDIDATES_KEY },
      update: {
        value: {
          evaluatedAt,
          trigger,
          candidates,
          decision,
        } as any,
      },
      create: {
        key: CANDIDATES_KEY,
        value: {
          evaluatedAt,
          trigger,
          candidates,
          decision,
        } as any,
      },
    });

    let nextConfig: AiModelConfig = {
      ...modelConfig,
      lastEvaluationAt: evaluatedAt,
    };

    if (decision.shouldSwitch && best) {
      nextConfig = {
        ...nextConfig,
        activeModel: best.id,
        lastSwitchAt: evaluatedAt,
        lastSwitchReason: decision.reason,
      };
    }

    await this.prisma.systemSetting.upsert({
      where: { key: CONFIG_KEY },
      update: { value: nextConfig as any },
      create: { key: CONFIG_KEY, value: nextConfig as any },
    });

    return {
      currentModel: modelConfig.activeModel,
      selectedModel: nextConfig.activeModel,
      switched: decision.shouldSwitch,
      reason: decision.reason,
      candidates,
    };
  }

  private defaultConfig(): AiModelConfig {
    return {
      activeModel: this.config.get<string>('ai.model') || 'openai/gpt-oss-120b',
      autoSelectionEnabled:
        this.config.get<boolean>('ai.modelAutoSelectionEnabled') !== false,
      allowlist: this.normalizeList(
        this.config.get<string[]>('ai.modelAllowlist') || [],
      ),
      blacklist: this.normalizeList(
        this.config.get<string[]>('ai.modelBlacklist') || [],
      ),
      minContext: this.config.get<number>('ai.modelMinContext') || 128000,
    };
  }

  private async fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
    const baseUrl = this.config.get<string>('ai.baseUrl');
    const apiKey = this.config.get<string>('ai.apiKey');

    const response = await axios.get(`${baseUrl}/models`, {
      params: { supported_parameters: 'tools' },
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      timeout: 30000,
    });

    return response.data?.data || [];
  }

  // Modelos com ao menos um endpoint de retenção zero que aceita
  // ferramentas: fora deles a chamada do assistente é recusada pelo
  // provedor. `null` quando a política está desligada
  private async fetchZeroRetentionModels(): Promise<Set<string> | null> {
    if (!zeroDataRetentionRequired(this.config)) return null;

    const baseUrl = this.config.get<string>('ai.baseUrl');
    const apiKey = this.config.get<string>('ai.apiKey');

    const response = await axios.get(`${baseUrl}/endpoints/zdr`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      timeout: 30000,
    });

    const endpoints: OpenRouterEndpoint[] = response.data?.data || [];
    return new Set(
      endpoints
        .filter((endpoint) => {
          const parameters = endpoint.supported_parameters || [];
          return (
            parameters.includes('tools') && parameters.includes('tool_choice')
          );
        })
        .map((endpoint) => endpoint.model_id)
        .filter(Boolean),
    );
  }

  private rankCandidates(
    models: OpenRouterModel[],
    modelConfig: AiModelConfig,
    zeroRetention: Set<string> | null,
  ): AiModelCandidate[] {
    const allowed = new Set(modelConfig.allowlist);
    const blocked = new Set(modelConfig.blacklist);
    const candidates = models
      .filter((model) =>
        this.isEligible(model, allowed, blocked, modelConfig, zeroRetention),
      )
      .map((model) => this.toCandidate(model, !!zeroRetention));

    const cheapest = Math.min(
      ...candidates.map((candidate) => candidate.estimatedQuestionCost),
    );

    return candidates
      .map((candidate) => ({
        ...candidate,
        ...this.applyDegradationPenalty(
          candidate,
          this.scoreCandidate(candidate, cheapest, modelConfig.minContext),
          modelConfig,
        ),
      }))
      .sort((a, b) => b.score - a.score);
  }

  private isEligible(
    model: OpenRouterModel,
    allowed: Set<string>,
    blocked: Set<string>,
    modelConfig: AiModelConfig,
    zeroRetention: Set<string> | null,
  ) {
    if (!model.id || !allowed.has(model.id)) return false;
    if (blocked.has(model.id)) return false;
    if (zeroRetention && !zeroRetention.has(model.id)) return false;
    if (model.id.endsWith(':free') && !allowed.has(model.id)) return false;
    if ((model.context_length || 0) < modelConfig.minContext) return false;

    const parameters = model.supported_parameters || [];
    if (!parameters.includes('tools') || !parameters.includes('tool_choice')) {
      return false;
    }

    const outputModalities =
      model.output_modalities || model.architecture?.output_modalities || [];
    if (outputModalities.length && !outputModalities.includes('text')) {
      return false;
    }

    return !!model.pricing?.prompt && !!model.pricing?.completion;
  }

  private toCandidate(
    model: OpenRouterModel,
    zeroRetention: boolean,
  ): AiModelCandidate {
    const promptPrice = Number(model.pricing.prompt);
    const completionPrice = Number(model.pricing.completion);
    const estimatedQuestionCost =
      (promptPrice * STANDARD_INPUT_TOKENS +
        completionPrice * STANDARD_OUTPUT_TOKENS) *
      STANDARD_CALLS_WITH_TOOLS;

    return {
      id: model.id,
      name: model.name,
      contextLength: model.context_length || 0,
      promptPrice,
      completionPrice,
      estimatedQuestionCost,
      score: 0,
      reasons: [
        'Modelo permitido na allowlist',
        'Suporta tools e tool_choice',
        `Contexto ${model.context_length || 0}`,
        ...(zeroRetention ? ['Tem provedor de retenção zero'] : []),
      ],
    };
  }

  private scoreCandidate(
    candidate: AiModelCandidate,
    cheapestCost: number,
    minContext: number,
  ) {
    const costScore =
      candidate.estimatedQuestionCost > 0
        ? cheapestCost / candidate.estimatedQuestionCost
        : 0;
    const contextScore = Math.min(candidate.contextLength / minContext, 2) / 2;
    const toolScore = 1;
    const stabilityScore = 1;

    return (
      costScore * 0.45 +
      contextScore * 0.25 +
      toolScore * 0.2 +
      stabilityScore * 0.1
    );
  }

  private applyDegradationPenalty(
    candidate: AiModelCandidate,
    score: number,
    modelConfig: AiModelConfig,
  ) {
    const degradation = modelConfig.degradedModels?.[candidate.id];
    if (!degradation || !this.isRecentFailure(degradation.lastFailureAt)) {
      return { score, reasons: candidate.reasons };
    }

    const penalty = Math.min(0.5, 0.1 * degradation.consecutiveFailures);
    return {
      score: score * (1 - penalty),
      reasons: [
        ...candidate.reasons,
        `Falha recente registrada: ${degradation.reason}`,
      ],
    };
  }

  private isRecentFailure(lastFailureAt: string) {
    const elapsedMs = Date.now() - new Date(lastFailureAt).getTime();
    return elapsedMs < 24 * 60 * 60 * 1000;
  }

  private decideSwitch(
    modelConfig: AiModelConfig,
    current: AiModelCandidate | undefined,
    best: AiModelCandidate | null,
    trigger: 'manual' | 'scheduled',
  ) {
    if (!best)
      return { shouldSwitch: false, reason: 'Nenhum candidato válido.' };
    if (best.id === modelConfig.activeModel) {
      return { shouldSwitch: false, reason: 'Modelo ativo já é o melhor.' };
    }
    if (!modelConfig.autoSelectionEnabled && trigger !== 'manual') {
      return { shouldSwitch: false, reason: 'Seleção automática desativada.' };
    }
    if (!this.cooldownElapsed(modelConfig.lastSwitchAt)) {
      return { shouldSwitch: false, reason: 'Cooldown de troca ainda ativo.' };
    }
    if (current && best.score < current.score * (1 + this.minGain())) {
      return {
        shouldSwitch: false,
        reason: 'Ganho de score abaixo do limiar mínimo.',
      };
    }
    return {
      shouldSwitch: true,
      reason: `Modelo ${best.id} tem melhor custo-benefício dentro da allowlist.`,
    };
  }

  private cooldownElapsed(lastSwitchAt?: string) {
    if (!lastSwitchAt) return true;
    const cooldownDays =
      this.config.get<number>('ai.modelSwitchCooldownDays') || 7;
    const elapsedMs = Date.now() - new Date(lastSwitchAt).getTime();
    return elapsedMs >= cooldownDays * 24 * 60 * 60 * 1000;
  }

  private minGain() {
    return this.config.get<number>('ai.modelSwitchMinGain') || 0.15;
  }

  private normalizeList(values: string[]) {
    return Array.from(
      new Set(values.map((value) => value.trim()).filter(Boolean)),
    );
  }
}
