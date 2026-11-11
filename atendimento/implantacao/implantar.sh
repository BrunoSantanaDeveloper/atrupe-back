#!/usr/bin/env bash
# Implanta (ou atualiza) o atendimento no WhatsApp na instância própria (52.6.18.128):
#
#   bash /home/ubuntu/atendimento/implantacao/implantar.sh
#
# Pré-requisitos (LEIA-ME.md, nesta pasta): o preparar-servidor.sh já rodou, o DNS de
# atendimento.atrupe.com.br e wa.atrupe.com.br aponta para a instância e os arquivos
# /home/ubuntu/atendimento/segredos/chatwoot.env, robo.env e openwa.env existem (nunca no git).
#
# O que faz, nesta ordem, e pode rodar de novo sem estragar nada:
#   1. baixa as imagens e constrói a do robô a partir de base/bot (a versão do kit vai na tag);
#   2. sobe o Postgres e o Redis;
#   3. prepara ou migra o banco do Chatwoot (db:chatwoot_prepare);
#   4. sobe ou atualiza o Chatwoot, o robô, o OpenWA e o Caddy, e espera os endereços públicos;
#   5. aplica a marca e o tema do Atrupe no Chatwoot (o serviço chatwoot-config).
set -Eeuo pipefail

cd "$(dirname "$0")"
SEGREDOS=../segredos
KIT_VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' ../kit.json | head -1)"
export ATENDIMENTO_ROBO_IMAGE="atrupe/atendimento-robo:kit-${KIT_VERSION}"

for file in chatwoot.env robo.env openwa.env; do
  if [ ! -s "$SEGREDOS/$file" ]; then
    echo "Falta $SEGREDOS/$file (veja implantacao/LEIA-ME.md)." >&2
    exit 1
  fi
done

# Espera um endereço responder com um dos códigos aceitos (ex.: "200" ou "200|401").
wait_for_url() {
  local url="$1" accept="$2" timeout="${3:-300}" end=$((SECONDS + ${3:-300})) code=""
  while [ "$SECONDS" -lt "$end" ]; do
    code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$url" || true)
    if [[ "$code" =~ ^($accept)$ ]]; then
      echo "  $url ($code)"
      return 0
    fi
    sleep 5
  done
  echo "$url não respondeu em ${timeout}s (último código: ${code:-nenhum})." >&2
  docker compose ps >&2
  return 1
}

echo "1/5 Imagens (robô: $ATENDIMENTO_ROBO_IMAGE)"
docker compose pull -q chatwoot-rails postgres redis openwa caddy
docker compose build -q robo

echo "2/5 Postgres e Redis"
docker compose up -d --wait postgres redis

echo "3/5 Banco do Chatwoot"
docker compose run --rm --no-deps chatwoot-rails bundle exec rails db:chatwoot_prepare

echo "4/5 Chatwoot, robô, OpenWA e Caddy"
docker compose up -d --remove-orphans
wait_for_url https://atendimento.atrupe.com.br/api 200 420
wait_for_url https://atendimento.atrupe.com.br/robo/health 200 120
wait_for_url https://wa.atrupe.com.br/api/health '200|401' 180

echo "5/5 Marca e tema do Atrupe no Chatwoot"
docker compose --profile config run --rm --no-deps chatwoot-config

docker compose ps --format 'table {{.Service}}\t{{.Status}}'
echo "Pronto: https://atendimento.atrupe.com.br"
