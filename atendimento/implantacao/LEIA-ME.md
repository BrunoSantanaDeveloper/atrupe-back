# Atendimento no WhatsApp: implantação

O suporte do Atrupe pelo WhatsApp roda sobre o Chatwoot 4.19.1 (imagem `-ce`), com o robô do kit
`whatsapp-support` 1.0.0 e a API do Atrupe (`src/core/atendimento`). O contexto do robô só o superadmin
edita, em **Super Admin › Atendimento › Robô**.

| Peça | Onde |
|---|---|
| Painel da equipe | `https://atendimento.atrupe.com.br` |
| Robô | `https://atendimento.atrupe.com.br/robo/` (o Chatwoot avisa em `/robo/chatwoot`) |
| Rotas que o robô chama na API | `https://api.atrupe.com.br/atendimento/robo/*` (assinadas com `SUPPORT_BOT_SECRET`) |
| Stack | `docker-stack.atendimento.yml`, no mesmo Swarm e atrás do mesmo Traefik da API |

## Antes da primeira implantação

1. **Servidor.** O Chatwoot com Postgres e Redis pede uns 2 vCPU e 4 GB a mais do que a máquina já usa
   (regra de bolso do kit). Confira a folga com `free -m` e `docker stats` antes de subir.
2. **DNS.** `atendimento.atrupe.com.br` apontando para o servidor do Swarm. O Traefik emite o certificado.
3. **Segredos.** Copie para o servidor, fora do git, com `chmod 600`:
   - `atendimento/segredos/chatwoot.env` → `/home/ubuntu/atendimento/chatwoot.env`
   - `atendimento/segredos/robo.env` → `/home/ubuntu/atendimento/robo.env`
     (preencha `ANTHROPIC_API_KEY`, ou outro provedor: veja `api.env.example`)
   - as linhas de `atendimento/segredos/api.env` no `.env` da API (`.env.dev` no homolog primeiro)

   Os arquivos de `atendimento/segredos/` foram gerados com valores aleatórios e não vão para o git.
   Os modelos comentados ficam nesta pasta (`*.env.example`).

## Implantar (e a cada atualização do kit ou do tema)

```
cd /home/ubuntu/atrupe-back && git pull
bash atendimento/implantacao/implantar.sh
```

O roteiro constrói a imagem do robô, sobe o stack, prepara o banco do Chatwoot e aplica a marca e o tema
do Atrupe (`atendimento/gerado/`). Pode rodar de novo quantas vezes precisar.

## Depois da primeira implantação

1. Abra `https://atendimento.atrupe.com.br` e crie o **super administrador do Chatwoot**
   (`/installation/onboarding`). Guarde a senha no cofre: ninguém da equipe usa essa conta no dia a dia.
2. Em `https://atendimento.atrupe.com.br/super_admin`, **Platform Apps › Novo**, nome "Atrupe". O token
   vira `CHATWOOT_PLATFORM_TOKEN` no `.env` da API. Reimplante a API.
3. No Atrupe, **Super Admin › Atendimento › WhatsApp**: conecte o número pela API oficial (Phone number ID,
   WABA ID e token permanente da Meta). A tela devolve a URL de retorno e o token de verificação para
   cadastrar no app da Meta, assinando o campo `messages`.
4. **Super Admin › Atendimento › Robô**: confira o contexto (vem da base de suporte do Start de 29/10/2026)
   e o modo. O robô começa **sugerindo** respostas à equipe; passe para "responde sozinho" quando estiver
   bom.
5. **Abrir painel** leva o superadmin ao Chatwoot já logado. A equipe do painel são os superadmins ativos;
   quem deixa de ser sai do painel na conferência diária (04:20).

## Homologação primeiro

O mesmo stack serve ao homolog: ponha as variáveis da API no `.env.dev` e `PROJECT_URL` do robô em
`https://dev.atrupe.com.br/atendimento/robo`. Para passar à produção, troque o `PROJECT_URL`, leve as
variáveis ao `.env.prod` e conecte o número de novo pela tela de produção (a conta do Chatwoot é criada
pela API que a usa).

## Conferir

Com o atendimento no ar, da raiz do `atrupe-back` (máquina com o kit instalado):

```
node <kit>/scripts/kit.mjs verify atendimento --env <arquivo .env com as variáveis da API> --account <id da conta>
node <kit>/scripts/kit.mjs look atendimento --account <id da conta> --user <id da pessoa de teste> --env <arquivo .env>
```

## Rota não oficial (OpenWA)

Fora deste stack. Só com aceite do risco (banimento do número, celular ligado). O modelo está em
`atendimento/modelos/implantacao/` (serviço `openwa` e o domínio `wa.atrupe.com.br`).
