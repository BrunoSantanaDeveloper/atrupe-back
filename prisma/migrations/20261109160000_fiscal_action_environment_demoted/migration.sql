-- Rebaixamento de ambiente fiscal passa a deixar rastro.
--
-- Salvar a empresa, trocar o certificado ou girar a chave de acesso derruba
-- para rascunho os ambientes de todos os emissores — e isso era feito com um
-- updateMany solto, sem nenhuma linha em "invoicy_config_history". O emissor
-- perdia a ativação de produção e não havia como descobrir por quê; levou
-- semanas e nove empresas até alguém ligar uma coisa à outra.
ALTER TYPE "FiscalConfigAction" ADD VALUE IF NOT EXISTS 'ENVIRONMENT_DEMOTED';
