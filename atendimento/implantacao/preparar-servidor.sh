#!/usr/bin/env bash
# Prepara a instância do atendimento, uma vez só (Ubuntu 24.04, ARM ou x86):
#
#   sudo bash /home/ubuntu/atendimento/implantacao/preparar-servidor.sh
#
# O que faz, e pode rodar de novo sem estragar nada:
#   1. cria 2 GB de swap (/swapfile), folga para os picos do Chatwoot e do Chromium do OpenWA;
#   2. instala o Docker e o Compose pelos pacotes do Ubuntu, que recebem as atualizações de segurança;
#   3. limita os logs dos contêineres (10 MB x 3 por contêiner) para não encher o disco;
#   4. põe o usuário ubuntu no grupo docker (vale a partir da próxima sessão de SSH).
set -Eeuo pipefail

if [ "$(id -u)" != "0" ]; then
  echo "Rode com sudo." >&2
  exit 1
fi

echo "1/4 Swap"
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  [ -f /swapfile ] || fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/99-atendimento.conf
sysctl -q -p /etc/sysctl.d/99-atendimento.conf

echo "2/4 Docker"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq docker.io docker-compose-v2 >/dev/null

echo "3/4 Logs dos contêineres"
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
systemctl enable --now docker >/dev/null
systemctl restart docker

echo "4/4 Usuário ubuntu no grupo docker"
usermod -aG docker ubuntu

docker --version
docker compose version
free -m | sed -n '1,3p'
echo "Pronto. Abra outra sessão de SSH para o grupo docker valer."
