# Subir o Chimera Songs no Railway

O que já está pronto no projeto:

- `Dockerfile`: compila o motor (wasm para o navegador e o programa de linha de comando que o servidor usa
  para cantar e misturar as bandas), compila o site e monta a imagem final com Node e ffmpeg.
- `railway.json`: diz ao Railway para usar o Dockerfile e checar `/api/songs`.
- `seed/`: as músicas que a galeria tem no primeiro start (copiadas para o disco só se ele estiver vazio).

## Passo a passo

1. **Repositório próprio.** O `origin` desta pasta é o do criador do CHIMERA, então crie um repositório seu no
   GitHub e envie este projeto para ele.
2. **Railway → New Project → Deploy from GitHub repo** e escolha o repositório. O Railway acha o
   `Dockerfile` sozinho. O primeiro build compila Rust e leva alguns minutos.
3. **Volume.** No serviço: *Settings → Volumes → New Volume*, com o ponto de montagem **`/data`**.
   Sem isso a galeria some a cada novo deploy.
4. **Variáveis** (*Variables*):
   - `ADMIN_KEY`: uma chave longa e secreta, só sua. É ela que permite ligar uma moeda a uma música
     (`PATCH /api/songs/:id/coin`). Sem ela esse recurso fica desligado.
5. **Domínio.** *Settings → Networking → Generate Domain*.

O Railway define `PORT` sozinho. As variáveis `DATA_DIR`, `CHIMERA_BIN` e `FFMPEG` já vêm no Dockerfile.

## Conferir depois do deploy

- Abrir o domínio: a aba Moedas deve mostrar as duas músicas iniciais e tocá-las.
- Em Criar, escolher *Banda completa*, pôr algumas notas e apertar ▶: a banda precisa ser gerada e tocar.
  Se isso falhar com "não foi possível gerar a banda", veja os *Deploy Logs* (falta de ffmpeg ou do programa
  `chimera`).

## Cuidados

- Qualquer pessoa pode publicar e pedir geração de banda. O servidor limita (10 publicações e 30 gerações por hora
  por IP, uma geração por vez) e não tem login nem moderação.
- Gerar banda usa bastante processador. Se o plano do Railway for pequeno, as gerações ficam lentas.
- Para ligar uma música a uma moeda, o servidor só guarda o endereço que você informar. Ele não cria moeda.
