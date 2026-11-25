# Atendimento no WhatsApp: implantação

O suporte do Atrupe pelo WhatsApp roda sobre o Chatwoot 4.19.1 (imagem `-ce`), com o robô do kit
`whatsapp-support` 1.0.0 e a API do Atrupe (`src/core/atendimento`). O contexto do robô só o superadmin
edita, em **Super Admin › Atendimento › Robô**.

O Chatwoot, o robô e o OpenWA ficam numa **instância própria**, separada do servidor da API, para não
disputar memória com a produção. A API do Atrupe chama essa instância pelos endereços públicos.

| Peça | Onde |
|---|---|
| Instância | "Atendimento - Atrupe" (`i-0dc1b8fb4d310e6bc`), `52.6.18.128`, t4g.medium (ARM, 2 vCPU, 4 GB), Ubuntu 24.04, us-east-1, 30 GB |
| Painel da equipe | `https://atendimento.atrupe.com.br` |
| Robô | `https://atendimento.atrupe.com.br/robo/` (o Chatwoot avisa em `/robo/chatwoot`) |
| OpenWA (conexão não oficial) | `https://wa.atrupe.com.br/api/*` (só a API; o painel do OpenWA não fica público) |
| Rotas que o robô chama na API | `https://api.atrupe.com.br/atendimento/robo/*` (assinadas com `SUPPORT_BOT_SECRET`) |
| Arquivos | `compose.yml`, `Caddyfile`, `preparar-servidor.sh` e `implantar.sh`, nesta pasta |

## Acesso à instância

A porta 22 da instância só aceita o servidor da API (`18.214.154.178`). Entre passando por ele, com a chave
de deploy (`antigravity-deploy@atrupe`, acrescentada ao usuário `ubuntu` das duas máquinas):

```
ssh -i ~/.ssh/atrupe_deploy -o IdentitiesOnly=yes \
  -o ProxyCommand="ssh -i ~/.ssh/atrupe_deploy -W %h:%p ubuntu@18.214.154.178" ubuntu@52.6.18.128
```

Nos comandos abaixo, `<acesso>` é esse comando `ssh` inteiro, com o `ubuntu@52.6.18.128` no fim.

## Como fica no servidor

```
/home/ubuntu/atendimento/
  base/  gerado/  implantacao/  kit.json  escolhas.json   do git (a pasta atendimento/ do atrupe-back)
  segredos/  chatwoot.env  robo.env  openwa.env           fora do git (pasta 700, arquivos 600)
```

## Primeira implantação

1. **Arquivos.** Da raiz do `atrupe-back`, na máquina com os segredos:

   ```
   git archive HEAD atendimento/base atendimento/gerado atendimento/implantacao atendimento/kit.json \
     atendimento/escolhas.json | <acesso> 'mkdir -p ~/atendimento && tar -x --strip-components=1 -C ~/atendimento'
   tar -C atendimento -cf - segredos/chatwoot.env segredos/robo.env segredos/openwa.env \
     | <acesso> 'umask 077 && tar -x -C ~/atendimento && chmod 700 ~/atendimento/segredos'
   ```

   O `robo.env` precisa da `ANTHROPIC_API_KEY` (ou de outro provedor: veja `api.env.example`).
2. **Servidor**, uma vez só: `sudo bash ~/atendimento/implantacao/preparar-servidor.sh` (swap de 2 GB,
   Docker e teto para os logs). Depois, abra outra sessão de SSH para o grupo `docker` valer.
3. **Atendimento:** `bash ~/atendimento/implantacao/implantar.sh`. Ele baixa as imagens, constrói o robô,
   prepara o banco do Chatwoot, sobe tudo, espera os três endereços públicos responderem e aplica a marca
   e o tema do Atrupe. O Caddy emite os certificados na primeira subida.
4. **Super administrador do Chatwoot.** A página que o cria fica fechada no Caddy para todos, porque
   robôs de varredura visitam o domínio minutos depois do certificado. Para criar, abra só para o IP de
   quem vai criar a conta (o de `https://checkip.amazonaws.com`, na máquina dessa pessoa):

   ```
   cd ~/atendimento/implantacao && ATENDIMENTO_ONBOARDING_IP=<ip>/32 docker compose up -d caddy
   ```

   Abra `https://atendimento.atrupe.com.br/installation/onboarding`, crie o super administrador e guarde a
   senha no cofre: ninguém da equipe usa essa conta no dia a dia. Depois feche a página de novo:
   `docker compose up -d caddy`.
5. **Platform App.** Em `https://atendimento.atrupe.com.br/super_admin`, **Platform Apps › Novo**, nome
   "Atrupe". O token vira `CHATWOOT_PLATFORM_TOKEN` no `segredos/api.env`.
6. **API.** Acrescente as linhas de `segredos/api.env` ao `/home/ubuntu/atrupe-back/.env.prod` do servidor
   da API e refaça o job `deploy-prod` da última execução do `main` no GitHub Actions: o
   `scripts/prepare-stack.py` só lê o `.env.prod` no deploy. Sem essas variáveis, a API sobe normal, as
   rotinas não rodam e as telas dizem que o atendimento não está configurado.
7. **Número.** No Atrupe, **Super Admin › Atendimento › WhatsApp**, conecte o número por uma das duas formas:
   - **Pelo WhatsApp Web (não oficial)**: a tela mostra o aviso de risco e, depois do aceite, o QR. No
     celular do número: WhatsApp › Aparelhos conectados › Conectar um aparelho. O celular precisa ficar
     ligado e com internet.
   - **API oficial**: Phone number ID, WABA ID e token permanente da Meta. A tela devolve a URL de retorno
     e o token de verificação para cadastrar no app da Meta, assinando o campo `messages`.
   - **Os dois ao mesmo tempo:** com um número ligado, "Conectar outro número" na outra forma de conexão
     acrescenta um canal, e o primeiro continua de pé. A tela mostra um bloco por canal, a conferência de
     15 minutos olha os dois e o robô atende os dois. Na mesma forma de conexão, o número novo toma o lugar
     do anterior. "Deixar de usar este número" tira um dos dois da tela e da conferência; as conversas
     dele ficam no painel. O único número não sai.
   - **Número que os clientes chamam:** o botão flutuante do WhatsApp nas telas do sistema, o "Suporte"
     do "?" do topo e as páginas de conta suspensa e de senha usam o número escolhido no bloco "Número
     que os clientes chamam" da mesma tela. Com um número só, vale ele. Com dois e sem escolha, vale o
     da API oficial. O número do WhatsApp Web vem da conferência de 15 minutos. A API expõe esse número
     em `GET /atendimento/contato`, sem sessão (é a linha do suporte). Sem número, as telas escondem o
     contato.
8. **Robô.** Em **Super Admin › Atendimento › Robô**, confira o contexto (vem da base de suporte do Start de
   29/10/2026) e o modo. O robô começa **sugerindo** respostas à equipe; passe para "responde sozinho"
   quando estiver bom.
9. **Painel.** **Abrir painel** leva o superadmin ao Chatwoot já logado. A equipe do painel são os
   superadmins ativos; quem deixa de ser sai do painel na conferência diária (04:20).

## Atualizar (kit, tema ou estes arquivos)

Repita o envio dos arquivos do passo 1 (os segredos só quando mudarem) e rode o `implantar.sh` de novo. Ele
migra o banco do Chatwoot, recria só o que mudou e reaplica a marca e o tema.

## Backup

A AWS Backup copia o disco da instância todo dia às 02:00 (horário de Brasília) e guarda 7 dias. O disco
tem o banco do Chatwoot, os anexos das conversas e as sessões do OpenWA (volumes do Docker). Restaurar é
restaurar o volume pela AWS, com a empresa que cuida da infraestrutura.

## Homolog

Uma API por vez: a conta do Chatwoot é criada pela API que a usa. Para testar com a API do homolog, ponha as
variáveis no `.env.dev` e o `PROJECT_URL` do robô em `https://dev.atrupe.com.br/atendimento/robo`. Ao voltar
para a produção, **tire as variáveis do `.env.dev`** e conecte o número de novo pela tela de produção. Sem
tirar, a rotina do homolog segue conferindo o número antigo e mandando aos superadmins, uma vez por dia, um
e-mail de que ele parou (com `[Homolog]` no assunto).

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
- **Instância fora do ar:** `cd ~/atendimento/implantacao && docker compose ps` e `docker compose logs
  --tail 100 <serviço>`; `bash implantar.sh` sobe de novo o que tiver caído.
- **"Uma mensagem do WhatsApp não chegou ao painel depois de todas as tentativas"
  (`adaptador_mensagens_perdidas`, atenção):** o adaptador desistiu de uma mensagem depois de 5 tentativas,
  30 segundos entre elas. O e-mail traz o último erro, como um 401 do Chatwoot. Essa mensagem se perdeu e
  não volta pelo reenvio. O aviso sai de novo se a contagem crescer. O OpenWA só zera a contagem quando o
  plugin é religado. Com `adaptador_com_erro` (fora), a fila encheu ou a mensagem se perdeu antes dela.
  Nos dois casos, corrija a causa, mande uma mensagem de teste e religue o plugin na instância (a chave
  fica dentro do contêiner):

  ```
  cd ~/atendimento/implantacao
  docker compose exec -T openwa sh -c 'for a in disable enable; do curl -s -X POST -H "X-API-Key: $API_MASTER_KEY" http://127.0.0.1:2785/api/plugins/chatwoot-adapter/$a; echo; done; curl -s -H "X-API-Key: $API_MASTER_KEY" http://127.0.0.1:2785/api/plugins/chatwoot-adapter/health; echo'
  ```

  A última linha deve mostrar `"healthy":true`. A fila de reenvio fica guardada à parte e não se perde.

A conferência não vê uma mensagem que se perde no caminho antes de chegar ao adaptador: depois de implantar
e de cada atualização, mande uma mensagem de outro celular e veja a resposta chegar.

## Bateria de conversas

Antes de abrir o Léo para os clientes, e depois de cada mudança grande nas instruções ou nos perfis, rode a
bateria. Ela usa a IA de verdade e a configuração de produção, e não envia nada a ninguém. Os casos ficam em
`atendimento/bateria.json`, um ou mais por perfil e um para cada coisa que nunca pode acontecer. O formato está em
`references/bateria.md` do kit.

Da raiz do `atrupe-back` (máquina com o kit), com o `robo.env` desta máquina copiado para
`atendimento/segredos/`, que o git ignora:

```
node <kit>/scripts/kit.mjs bateria atendimento --casos atendimento/bateria.json --env atendimento/segredos/robo.env --account 2
```

O relatório sai em `atendimento/conferencia/bateria-<data-hora>/relatorio.md`, para a Nathiely e o Maicol
aprovarem. Cada caso custa o mesmo que uma conversa no atendimento.

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
