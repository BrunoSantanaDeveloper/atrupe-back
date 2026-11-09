# Atendimento no WhatsApp: implantação

O suporte do Atrupe pelo WhatsApp roda sobre o Chatwoot 4.19.1 (imagem `-ce`), com o robô do kit
`whatsapp-support` 1.0.0 e a API do Atrupe (`src/core/atendimento`). O contexto do robô só o superadmin
edita, em **Super Admin › Atendimento › Robô**.

| Peça | Onde |
|---|---|
| Painel da equipe | `https://atendimento.atrupe.com.br` |
| Robô | `https://atendimento.atrupe.com.br/robo/` (o Chatwoot avisa em `/robo/chatwoot`) |
| Rotas que o robô chama na API | `https://api.atrupe.com.br/atendimento/robo/*` (assinadas com `SUPPORT_BOT_SECRET`) |
| OpenWA (conexão não oficial) | `https://wa.atrupe.com.br/api/*` (só a API; o painel do OpenWA não fica público) |
| Stack | `docker-stack.atendimento.yml`, no mesmo Swarm e atrás do mesmo Traefik da API |

## Antes da primeira implantação

1. **Servidor.** O Chatwoot com Postgres e Redis pede uns 2 vCPU e 4 GB a mais do que a máquina já usa
   (regra de bolso do kit), e o OpenWA mais 300 a 500 MB por número conectado (um Chromium por sessão).
   Confira a folga com `free -m` e `docker stats` antes de subir.
2. **DNS.** `atendimento.atrupe.com.br` e `wa.atrupe.com.br` apontando para o servidor do Swarm. O Traefik
   emite os certificados.
3. **Segredos.** Copie para o servidor, fora do git, com `chmod 600`:
   - `atendimento/segredos/chatwoot.env` → `/home/ubuntu/atendimento/chatwoot.env`
   - `atendimento/segredos/robo.env` → `/home/ubuntu/atendimento/robo.env`
     (preencha `ANTHROPIC_API_KEY`, ou outro provedor: veja `api.env.example`)
   - `atendimento/segredos/openwa.env` → `/home/ubuntu/atendimento/openwa.env`
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
3. No Atrupe, **Super Admin › Atendimento › WhatsApp**, conecte o número por uma das duas formas:
   - **Pelo WhatsApp Web (não oficial)**: a tela mostra o aviso de risco e, depois do aceite, o QR. No
     celular do número: WhatsApp › Aparelhos conectados › Conectar um aparelho. O celular precisa ficar
     ligado e com internet.
   - **API oficial**: Phone number ID, WABA ID e token permanente da Meta. A tela devolve a URL de retorno
     e o token de verificação para cadastrar no app da Meta, assinando o campo `messages`.
4. **Super Admin › Atendimento › Robô**: confira o contexto (vem da base de suporte do Start de 29/10/2026)
   e o modo. O robô começa **sugerindo** respostas à equipe; passe para "responde sozinho" quando estiver
   bom.
5. **Abrir painel** leva o superadmin ao Chatwoot já logado. A equipe do painel são os superadmins ativos;
   quem deixa de ser sai do painel na conferência diária (04:20).

## Homologação primeiro

O mesmo stack serve ao homolog: ponha as variáveis da API no `.env.dev` e `PROJECT_URL` do robô em
`https://dev.atrupe.com.br/atendimento/robo`. Para passar à produção, troque o `PROJECT_URL`, leve as
variáveis ao `.env.prod`, **tire-as do `.env.dev`** e conecte o número de novo pela tela de produção (a
conta do Chatwoot é criada pela API que a usa). Sem tirar, a rotina do homolog segue conferindo o número
antigo e mandando aos superadmins, uma vez por dia, um e-mail de que ele parou (com `[Homolog]` no assunto).

## Quando o número para

Por dentro, um número que caiu não mostra erro: o painel só fica vazio, como num dia sem conversas. Por isso
a API confere o número atual a cada 15 minutos (a sessão no OpenWA, ou a saúde na Meta pelo Chatwoot):

- **Quem é avisado:** os superadmins ativos, por e-mail (o SMTP `MAIL_*` que a API já usa; sem ele, o aviso
  não sai e o erro fica no log da API). O e-mail diz o que se viu, o que fazer e, quando é o caso, que a
  correção é de quem cuida do servidor.
- **Quando:** quando o número para, pede atenção ou volta, e uma vez por dia enquanto estiver parado. O que
  costuma passar sozinho (o OpenWA tentando de novo, a sessão iniciando) só vira aviso se continuar na
  conferência seguinte. Se nenhum e-mail sair, o aviso é tentado de novo na conferência seguinte.
- **Como voltar:** em **Super Admin › Atendimento › WhatsApp**, que mostra o que a conferência viu. "Ler o QR
  de novo" (WhatsApp Web) ou "Trocar o token da Meta" (API oficial) retomam a mesma caixa, e as conversas
  continuam nela. "Conectar outro número" cria uma caixa nova.

A conferência não vê uma mensagem que se perde no caminho com tudo dizendo que está bem: depois de implantar
e de cada atualização, mande uma mensagem de outro celular e veja a resposta chegar.

## Conferir

Com o atendimento no ar, da raiz do `atrupe-back` (máquina com o kit instalado):

```
node <kit>/scripts/kit.mjs verify atendimento --env <arquivo .env com as variáveis da API> --account <id da conta>
node <kit>/scripts/kit.mjs look atendimento --account <id da conta> --user <id da pessoa de teste> --env <arquivo .env>
```

O `verify` traz uma linha `numero_conectado_<sessão>` para cada sessão do OpenWA. O número da rota oficial
aparece na tela WhatsApp e na rotina de 15 minutos.

## Conexão não oficial (OpenWA): riscos

O OpenWA 0.29.1 conecta o número como um aparelho do WhatsApp Web, com o plugin `chatwoot-adapter`
(0.9.15), que a API instala pelo catálogo na primeira conexão. O WhatsApp não aprova esse uso:

- o número pode ser banido, com mais chance em volume alto ou em mensagens para quem não salvou o contato;
- o celular do número precisa ficar ligado e com internet; aparelhos conectados saem depois de um tempo
  sem uso do celular (fala-se em 14 dias);
- o OpenWA nunca terá a API oficial. Para trocar depois, conecte pela API oficial na mesma tela.

Prefira um número dedicado ao suporte, que a empresa aceite perder. Grupos ficam fora do atendimento.
