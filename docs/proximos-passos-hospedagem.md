# Proximos passos para Git e hospedagem

Atualizado em 2026-06-10.

## Estado atual do projeto

- O projeto e um app Node.js/Express que serve a interface estatica em `public/` e APIs em `src/server.js`.
- O comando de producao ja existe: `npm start`.
- O app ja respeita `PORT`, entao funciona em plataformas que injetam a porta automaticamente.
- A pasta `secrets/` foi colocada no `.gitignore` para evitar versionar a chave do Google Cloud.
- A interface agora aceita protecao opcional por Basic Auth usando `APP_BASIC_AUTH_USER` e `APP_BASIC_AUTH_PASSWORD`.

## Recomendacao inicial

Para este projeto, o caminho mais simples e hospedar como Web Service Node.js em Render ou Railway.

Vercel e Netlify sao melhores para frontends estaticos e funcoes pequenas. Aqui o app processa upload de imagens, usa `sharp`, recebe arquivos com `multer` e conversa com Google Cloud Storage, entao um processo Node persistente tende a ser mais previsivel.

Referencias oficiais:

- Render: https://render.com/docs/deploy-node-express-app
- Railway: https://docs.railway.com/guides/express
- Fly.io: https://fly.io/docs/js/

## Antes de subir para Git

1. Confirme que `.env`, `node_modules/`, `.DS_Store`, `*.log` e `secrets/` estao ignorados.
2. Nunca suba o arquivo `secrets/flowing-flame-322416-c1664e4db53e.json` para GitHub.
3. Gere a credencial em base64 para usar no painel da hospedagem:

```bash
base64 < secrets/flowing-flame-322416-c1664e4db53e.json | tr -d '\n' | pbcopy
```

4. Use o valor copiado em `GCS_SERVICE_ACCOUNT_JSON_BASE64` na plataforma de hospedagem.

## Subir para GitHub

Se ainda nao houver repositorio remoto criado:

```bash
git init
git add .
git status
git commit -m "Prepare project for hosting"
git branch -M main
```

Depois, crie um repositorio no GitHub e conecte o remoto:

```bash
git remote add origin git@github.com:SEU_USUARIO/storagemarketplace.git
git push -u origin main
```

Alternativa com GitHub CLI, se estiver autenticado:

```bash
gh repo create storagemarketplace --private --source=. --remote=origin --push
```

## Variaveis de ambiente para hospedagem

Configure estas variaveis no painel da plataforma:

```env
NODE_ENV=production
APP_BASIC_AUTH_USER=seu_usuario
APP_BASIC_AUTH_PASSWORD=uma_senha_forte
GCS_BUCKET_NAME=mktplacealpha
GCS_PROJECT_ID=flowing-flame-322416
GCS_SERVICE_ACCOUNT_JSON_BASE64=cole_o_base64_aqui
GCS_URL_MODE=public
GCS_PUBLIC_BASE_URL=https://storage.googleapis.com/mktplacealpha
GCS_MAKE_PUBLIC=false
GCS_SIGNED_URL_DAYS=7
GCS_DEFAULT_PREFIX=produtos
MAX_FILES_PER_UPLOAD=10000
MAX_FILE_SIZE_MB=20
VTEX_ACCOUNT_NAME=alphabeto
VTEX_API_BASE_URL=https://alphabeto.vtexcommercestable.com.br
VTEX_API_APP_KEY=preencher
VTEX_API_APP_TOKEN=preencher
VTEX_MAX_EXPORT_SKUS=2500
VTEX_REQUEST_CONCURRENCY=6
```

Nao precisa fixar `PORT` na hospedagem se a plataforma ja preencher automaticamente.

## Configuracao no Render

1. Crie um `Web Service`.
2. Conecte o repositorio GitHub.
3. Use:

```text
Build Command: npm ci
Start Command: npm start
```

4. Cadastre as variaveis de ambiente.
5. Depois do deploy, abra `/api/health` para validar que o servidor subiu.
6. Abra a URL principal e entre com o usuario/senha de `APP_BASIC_AUTH_USER` e `APP_BASIC_AUTH_PASSWORD`.

## Configuracao no Railway

1. Crie um novo projeto a partir do repositorio GitHub.
2. Configure as variaveis em `Variables`.
3. Garanta que o comando de start seja `npm start`.
4. Depois do deploy, valide `/api/health` e depois a tela principal.

## Checklist de validacao depois do deploy

- `/api/health` retorna `{ "ok": true }`.
- A tela principal pede usuario e senha.
- `/api/config` mostra `ready: true` e `authEnabled: true`.
- A listagem de pastas carrega sem erro.
- O upload de uma imagem pequena funciona.
- O link gerado abre em aba anonima.
- A busca por SKU da VTEX funciona depois de preencher `VTEX_API_APP_KEY` e `VTEX_API_APP_TOKEN`.

## Riscos e proximos passos

- Adicionar login mais completo se mais pessoas forem usar a ferramenta.
- Revisar permissoes da service account para garantir acesso apenas ao bucket necessario.
- Avaliar limite real de upload da plataforma escolhida, principalmente com `MAX_FILES_PER_UPLOAD=10000`.
- Criar um dominio proprio depois que o deploy inicial estiver validado.
- Criar rotina de backup/rotacao da chave do Google Cloud se a chave atual ja tiver sido compartilhada fora do ambiente seguro.
