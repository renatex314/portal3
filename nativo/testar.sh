#!/bin/sh
# roda todos os cenários de teste sem janela (capturas na pasta indicada, padrão: /tmp/portal3-testes)
set -u
cd "$(dirname "$0")"
~/.cargo/bin/cargo build --release --bin teste || exit 1
out="${1:-/tmp/portal3-testes}"
mkdir -p "$out"
falhas=0
for t in travessia cubo energia arma torretas fronteira ponte som tempo epoca relogio relogio-bolas relogio-laser relogio-campo extras chefe idioma editor mecanismos todas multiplayer menu efeitos; do
  r=$(cd "$out" && "$OLDPWD/target/release/teste" "$t" 2>&1 | grep -E "^(ok|FALHA)|panicked|failed to process shader")
  ok=$(echo "$r" | grep -c '^ok')
  f=$(echo "$r" | grep -c -E 'FALHA|panicked|failed to process shader')
  echo "$t: $ok ok, $f falhas"
  echo "$r" | grep -E "FALHA|panicked|failed to process shader"
  falhas=$((falhas + f))
done
[ "$falhas" -eq 0 ]
