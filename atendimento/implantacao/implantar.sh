#!/usr/bin/env bash
# Implanta (ou atualiza) o atendimento no WhatsApp no Swarm, a partir do clone do atrupe-back no servidor:
#
#   cd /home/ubuntu/atrupe-back && bash atendimento/implantacao/implantar.sh
#
# Pré-requisitos (LEIA-ME.md, nesta pasta): DNS de atendimento.atrupe.com.br e wa.atrupe.com.br apontando
# para o servidor e os arquivos /home/ubuntu/atendimento/chatwoot.env, robo.env e openwa.env, com os
# segredos (nunca no git).
#
# O que faz, nesta ordem, e pode rodar de novo sem estragar nada:
#   1. constrói a imagem do robô a partir de atendimento/base/bot (a versão do kit vai na tag);
#   2. sobe ou atualiza o stack "atendimento";
#   3. prepara ou migra o banco do Chatwoot (db:chatwoot_prepare) e reinicia o Chatwoot;
#   4. aplica a marca e o tema do Atrupe no Chatwoot (o "chatwoot-config" do kit).
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
KIT_DIR="$PWD/atendimento"
ENV_DIR="${ATENDIMENTO_ENV_DIR:-/home/ubuntu/atendimento}"
STACK=atendimento
CHATWOOT_IMAGE=chatwoot/chatwoot:v4.19.1-ce
KIT_VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$KIT_DIR/kit.json" | head -1)"
export ATENDIMENTO_ROBO_IMAGE="atrupe/atendimento-robo:kit-${KIT_VERSION}"

for file in chatwoot.env robo.env openwa.env; do
  if [ ! -s "$ENV_DIR/$file" ]; then
    echo "Falta $ENV_DIR/$file (veja atendimento/implantacao/LEIA-ME.md)." >&2
    exit 1
  fi
done

wait_for_service() {
  local name="$1" timeout="${2:-300}" end=$((SECONDS + ${2:-300}))
  while [ "$SECONDS" -lt "$end" ]; do
    local replicas
    replicas=$(docker service ls --filter "name=$name" --format '{{.Replicas}}' | head -1)
    if [ -n "$replicas" ] && [ "${replicas%/*}" = "${replicas#*/}" ] && [ "${replicas#*/}" != "0" ]; then
      echo "$name no ar ($replicas)."
      return 0
    fi
    sleep 5
  done
  echo "$name não subiu em ${timeout}s." >&2
  docker service ps "$name" --no-trunc | head -5 >&2
  return 1
}

run_chatwoot() {
  docker run --rm --network "${STACK}_interno" \
    --env-file "$ENV_DIR/chatwoot.env" \
    -e RAILS_ENV=production -e NODE_ENV=production -e INSTALLATION_ENV=docker \
    "$@"
}

echo "1/4 Imagem do robô ($ATENDIMENTO_ROBO_IMAGE)"
docker build -q -t "$ATENDIMENTO_ROBO_IMAGE" "$KIT_DIR/base/bot"

echo "2/4 Stack $STACK"
docker pull -q "$CHATWOOT_IMAGE" >/dev/null
docker stack deploy -c "$KIT_DIR/implantacao/docker-stack.atendimento.yml" "$STACK"
wait_for_service "${STACK}_postgres" 180
wait_for_service "${STACK}_redis" 120

echo "3/4 Banco do Chatwoot"
run_chatwoot "$CHATWOOT_IMAGE" bundle exec rails db:chatwoot_prepare
docker service update --force --quiet "${STACK}_chatwoot-rails" >/dev/null
docker service update --force --quiet "${STACK}_chatwoot-sidekiq" >/dev/null
wait_for_service "${STACK}_chatwoot-rails" 300
wait_for_service "${STACK}_robo" 120
wait_for_service "${STACK}_openwa" 180

echo "4/4 Marca e tema do Atrupe no Chatwoot"
run_chatwoot \
  --env-file "$KIT_DIR/gerado/marca.env" \
  -v "$KIT_DIR/base/deploy/apply-config.rb:/kit/apply-config.rb:ro" \
  -v "$KIT_DIR/gerado:/kit/gerado:ro" \
  "$CHATWOOT_IMAGE" bundle exec rails runner /kit/apply-config.rb

echo "Pronto: https://atendimento.atrupe.com.br (robô em /robo/health, OpenWA em https://wa.atrupe.com.br/api/health)."
