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

## Plataformas que nao hibernam

Atualizado em 2026-06-10 com base nas documentacoes oficiais consultadas.

### Melhor equilibrio para este projeto

1. **Render pago - Web Service**
   - O plano gratis hiberna apos 15 minutos sem trafego.
   - Em instancia paga, essa limitacao do plano gratis deixa de se aplicar.
   - E uma das opcoes mais simples para conectar GitHub, configurar `npm ci`, `npm start` e variaveis de ambiente.

2. **Railway com Serverless desativado**
   - O modo Serverless e o recurso que coloca servicos para dormir quando ficam ociosos.
   - Para nao hibernar, manter o servico como deploy normal, sem Serverless/scale-to-zero.
   - Tambem e simples para deploy via GitHub e variaveis de ambiente.

3. **DigitalOcean App Platform pago**
   - O plano gratis e apenas para sites estaticos.
   - Para este app Express, seria um Web Service pago em container.
   - Boa opcao quando se quer previsibilidade e menos configuracao de servidor.

### Opcoes mais tecnicas, mas bem estaveis

4. **Fly.io com pelo menos uma Machine sempre ligada**
   - O Fly tem autostop/autostart opcional.
   - Para nao hibernar, configurar para manter uma maquina minima rodando ou desativar auto stop.
   - Melhor quando voce quer mais controle de regiao e infraestrutura.

5. **VPS propria: DigitalOcean Droplet, AWS Lightsail, Hetzner, Linode ou Hostinger VPS**
   - Nao hiberna por inatividade.
   - Normalmente e a opcao mais previsivel.
   - Exige configurar servidor Linux, Node, PM2 ou systemd, Nginx, SSL, firewall e backups.

6. **Northflank**
   - A pagina de precos informa compute sempre ligado, sem sleeping.
   - Pode ser uma boa opcao para containers, mas eu validaria custo e simplicidade antes de escolher para este caso.

### Plataformas/modos a evitar se a prioridade for nao hibernar

- **Render Free:** hiberna quando fica sem trafego.
- **Railway Serverless:** pode dormir e ter cold boot.
- **Koyeb Scale-to-Zero:** e feito justamente para escalar a zero quando nao ha trafego.
- **Heroku Eco:** hiberna apos periodo sem trafego; usar Basic ou superior se escolher Heroku.

### Sobre Netlify

Da para hospedar parte deste projeto na Netlify, mas nao no mesmo modelo atual de servidor Express sempre rodando.

A Netlify suporta Express usando **Netlify Functions**. Nesse modelo, o app Express vira uma funcao serverless chamada sob demanda, com redirects do `netlify.toml` apontando `/api/*` para a funcao. A propria documentacao da Netlify alerta que, ao rodar Express assim, passam a valer os limites de Functions, incluindo limites de execucao e memoria.

Para este projeto especifico, existem tres pontos de atencao:

1. O upload usa `multer.memoryStorage()`, entao os arquivos entram na memoria da funcao.
2. O processamento usa `sharp`, que consome CPU/memoria e pode sofrer em lotes grandes.
3. O progresso de tarefas fica em memoria no `src/services/tasks.js`; em ambiente serverless, uma chamada de upload e outra chamada de consulta em `/api/tasks/:taskId` podem cair em instancias diferentes ou em execucoes separadas.

Conclusao: **Netlify e possivel, mas exige adaptacao**. Eu nao recomendaria como primeira opcao para manter o fluxo atual de upload em lote e progresso em tela.

Se quisermos usar Netlify mesmo assim, o caminho mais seguro seria:

1. Hospedar o frontend estatico (`public/`) na Netlify.
2. Manter a API de upload em Render, Railway, DigitalOcean App Platform ou VPS.
3. Ou refatorar o backend para Netlify Functions, reduzindo tamanho/lote de upload e trocando o progresso em memoria por armazenamento externo, como banco, fila ou Netlify Blobs.

Referencias oficiais:

- Express on Netlify: https://docs.netlify.com/build/frameworks/framework-setup-guides/express/
- Netlify Functions overview: https://docs.netlify.com/build/functions/overview/
- Netlify Functions configuration: https://docs.netlify.com/build/functions/configuration/

#### Adaptacao implementada para Netlify

Atualizado em 2026-06-10.

O projeto agora possui uma primeira adaptacao para Netlify:

- `netlify.toml` publica `public/` como site estatico.
- `/api/*` e redirecionado para `netlify/functions/api.mts`.
- `netlify/functions/api.mts` empacota o Express atual com `serverless-http`.
- `serverless-http` e `@netlify/functions` foram adicionados nas dependencias.
- `src/config.js` passa a preferir `Netlify.env.get(...)` quando estiver rodando em ambiente Netlify.
- Para variaveis secretas, `src/config.js` volta para `process.env` quando `Netlify.env.get(...)` retornar vazio.
- Para Netlify, `src/config.js` tambem aceita credencial GCS dividida em `GCS_CLIENT_EMAIL` e `GCS_PRIVATE_KEY_BASE64_PART1` a `PART4`, evitando uma variavel unica grande com o JSON completo.

Configuracao esperada no Netlify:

```text
Build command: npm run build
Publish directory: public
Functions directory: netlify/functions
```

Variaveis obrigatorias no Netlify:

```env
APP_BASIC_AUTH_USER=preencher
APP_BASIC_AUTH_PASSWORD=preencher
GCS_BUCKET_NAME=mktplacealpha
GCS_PROJECT_ID=flowing-flame-322416
GCS_SERVICE_ACCOUNT_JSON_BASE64=preencher
GCS_CLIENT_EMAIL=opcional_para_netlify
GCS_PRIVATE_KEY_BASE64_PART1=opcional_para_netlify
GCS_PRIVATE_KEY_BASE64_PART2=opcional_para_netlify
GCS_PRIVATE_KEY_BASE64_PART3=opcional_para_netlify
GCS_PRIVATE_KEY_BASE64_PART4=opcional_para_netlify
GCS_TOKEN_URI=https://oauth2.googleapis.com/token
GCS_URL_MODE=public
GCS_PUBLIC_BASE_URL=https://storage.googleapis.com/mktplacealpha
GCS_MAKE_PUBLIC=false
GCS_DEFAULT_PREFIX=produtos
VTEX_ACCOUNT_NAME=alphabeto
VTEX_API_BASE_URL=https://alphabeto.vtexcommercestable.com.br
VTEX_API_APP_KEY=preencher
VTEX_API_APP_TOKEN=preencher
```

Observacao importante: esta adaptacao permite publicar e testar na Netlify, mas uploads grandes continuam sujeitos aos limites de Functions. Se a operacao real envolver muitos arquivos por lote, manter API em servidor Node sempre ligado continua sendo o caminho mais robusto.

Validacao do deploy Netlify:

- A primeira publicacao subiu a pagina estatica, mas a Function retornou 502 por causa do bundle com `createRequire(import.meta.url)`.
- A Function foi corrigida para importar o servidor Express via ESM.
- Em seguida, a API respondeu, mas `authEnabled` e `vtexEnabled` ficaram falsos porque variaveis secretas podem chegar vazias via `Netlify.env.get(...)`.
- O helper de ambiente foi ajustado para usar `process.env` como fallback quando isso acontecer.
- O deploy publicado em `https://integracao-storage-mktplc.netlify.app` respondeu `200` na pagina principal, `200` em `/api/health`, `401` em `/api/config` sem senha, `200` em `/api/config` com senha, `authEnabled: true`, `vtexEnabled: true` e listou 8 pastas do bucket.
- A tentativa de gravar `GCS_SERVICE_ACCOUNT_JSON_BASE64` como variavel unica normal quebrou o build da Netlify; a variavel foi removida.
- A credencial GCS foi reconfigurada por partes menores em `GCS_CLIENT_EMAIL` e `GCS_PRIVATE_KEY_BASE64_PART1` a `PART4`.
- O deploy final publicado em `https://integracao-storage-mktplc.netlify.app` respondeu com `credentialMode: inline`, listou 8 pastas e concluiu um upload pequeno de teste com status `201` na pasta `codex-netlify-test`.

Credenciais e acesso:

- O usuario inicial de Basic Auth foi gravado no `.env` local ignorado pelo Git e tambem nas variaveis do projeto Netlify.
- Nao registrar senhas, tokens VTEX nem service account em arquivos versionados.

### Minha escolha recomendada

Para publicar rapido e sem hibernacao, eu escolheria:

1. Render pago, se a prioridade for simplicidade.
2. DigitalOcean App Platform, se a prioridade for previsibilidade.
3. VPS, se a prioridade for menor custo fixo e controle total.

Para este projeto, eu comecaria por **Render pago** ou **DigitalOcean App Platform**. A VPS fica excelente depois, mas aumenta a responsabilidade de manutencao.

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
VTEX_MAX_EXPORT_SKUS=
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
- `VTEX_MAX_EXPORT_SKUS` vazio significa sem limite artificial de SKUs no app; use um numero positivo apenas se quiser rodar um piloto limitado.
