#!/bin/sh
# roda todos os cenários de teste sem janela (capturas na pasta indicada, padrão: /tmp/portal3-testes)
set -u
cd "$(dirname "$0")"
~/.cargo/bin/cargo build --release --bin teste || exit 1
# a linha do tempo (compromissos, voos, âncoras): testes de unidade
~/.cargo/bin/cargo test --release --lib relogio::linha 2>&1 | grep -E "^test result" | sed 's/^/linha (unidade): /'
~/.cargo/bin/cargo test --release --lib relogio::linha 2>&1 | grep -q "test result: ok" || { echo "FALHA linha (unidade)"; exit 1; }
out="${1:-/tmp/portal3-testes}"
mkdir -p "$out"
falhas=0
for t in travessia cubo cubo-portal energia arma torretas fronteira ponte som tempo epoca relogio relogio-bolas relogio-laser relogio-campo relogio-cubo relogio-cubo-paradoxo relogio-bola-volta relogio-bola-laco linha-outra-bola linha-apagar linha-substituto linha-laser-ancora linha-laser-apagar linha-duplo-mesmo linha-duplo-outro linha-duplo-apagar linha-parado linha-parado-longe linha-parado-rapido linha-parado-portal linha-parado-bloqueio holograma plataforma extras chefe idioma editor mecanismos todas multiplayer menu efeitos; do
  r=$(cd "$out" && "$OLDPWD/target/release/teste" "$t" 2>&1 | grep -E "^(ok|FALHA)|panicked|failed to process shader")
  ok=$(echo "$r" | grep -c '^ok')
  f=$(echo "$r" | grep -c -E 'FALHA|panicked|failed to process shader')
  echo "$t: $ok ok, $f falhas"
  echo "$r" | grep -E "FALHA|panicked|failed to process shader"
  falhas=$((falhas + f))
done
[ "$falhas" -eq 0 ]
