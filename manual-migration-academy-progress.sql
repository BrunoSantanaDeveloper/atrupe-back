-- Manual migration para criar a tabela academy_progress
-- Execute este SQL quando for seguro fazer alterações no banco de dados

-- Criar a tabela academy_progress
CREATE TABLE IF NOT EXISTS academy_progress (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(36) NOT NULL,
    company_id VARCHAR(36) NOT NULL,
    plan VARCHAR(50) NOT NULL,
    item_id VARCHAR(100) NOT NULL,
    checked BOOLEAN NOT NULL DEFAULT false,
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    -- Criar restrição de unicidade
    CONSTRAINT academy_progress_user_company_item_unique 
        UNIQUE (user_id, company_id, item_id),
    
    -- Criar foreign keys
    CONSTRAINT academy_progress_user_id_fkey 
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT academy_progress_company_id_fkey 
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- Criar índices para melhor performance
CREATE INDEX IF NOT EXISTS academy_progress_user_id_idx ON academy_progress(user_id);
CREATE INDEX IF NOT EXISTS academy_progress_company_id_idx ON academy_progress(company_id);
CREATE INDEX IF NOT EXISTS academy_progress_plan_idx ON academy_progress(plan);
CREATE INDEX IF NOT EXISTS academy_progress_checked_idx ON academy_progress(checked);

-- Comentários
COMMENT ON TABLE academy_progress IS 'Tabela para armazenar o progresso dos usuários na Academy por plano';
COMMENT ON COLUMN academy_progress.id IS 'Identificador único do registro';
COMMENT ON COLUMN academy_progress.user_id IS 'ID do usuário';
COMMENT ON COLUMN academy_progress.company_id IS 'ID da empresa';
COMMENT ON COLUMN academy_progress.plan IS 'Tipo do plano (start, lite, pro, elite, full)';
COMMENT ON COLUMN academy_progress.item_id IS 'ID do item da academy';
COMMENT ON COLUMN academy_progress.checked IS 'Se o item foi marcado como concluído';
COMMENT ON COLUMN academy_progress.completed_at IS 'Data e hora da conclusão';
COMMENT ON COLUMN academy_progress.created_at IS 'Data de criação do registro';
COMMENT ON COLUMN academy_progress.updated_at IS 'Data da última atualização';

-- Inserir alguns dados de exemplo (opcional)
-- INSERT INTO academy_progress (user_id, company_id, plan, item_id, checked, completed_at)
-- VALUES 
--     ('user-id-exemplo', 'company-id-exemplo', 'start', 'apresentacao-start', true, NOW()),
--     ('user-id-exemplo', 'company-id-exemplo', 'start', 'cadastro-empresa', true, NOW()); 