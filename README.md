# Bucket Image Desk

Painel local para enviar imagens ao Google Cloud Storage, listar os arquivos ja enviados e exportar um CSV com os links gerados.

## O que este app faz

- envia varias imagens de uma vez para uma pasta do bucket
- cria novas pastas no bucket direto pela interface
- mostra as pastas ja encontradas para selecao rapida
- gera links publicos ou assinados, de acordo com a configuracao
- lista as imagens ja existentes na pasta escolhida
- busca fotos atuais da VTEX por SKU usando a API de arquivos do SKU
- identifica SKU e ordem automaticamente pelo nome do arquivo
- oferece um CSV por SKU, com colunas dinamicas `link 1`, `link 2`, `link 3` e assim por diante

## Requisitos

- Node.js 20+ (testado com Node 24)
- um bucket ja criado no Google Cloud Storage
- credenciais com permissao para gravar no bucket

## Configuracao

1. Copie `.env.example` para `.env`.
2. Preencha pelo menos:

   - `GCS_BUCKET_NAME`
   - uma forma de autenticacao:
     - `GCS_CREDENTIALS_FILE`
     - ou `GCS_SERVICE_ACCOUNT_JSON`
     - ou `GCS_SERVICE_ACCOUNT_JSON_BASE64`

3. Se quiser links estaveis para marketplace, prefira `GCS_URL_MODE=public`.
4. Se o bucket nao for publico por IAM/politica, voce pode testar `GCS_MAKE_PUBLIC=true`.
5. Para habilitar a busca de fotos na VTEX por SKU, preencha tambem:

   - `VTEX_API_APP_KEY`
   - `VTEX_API_APP_TOKEN`
   - `VTEX_ACCOUNT_NAME` ou `VTEX_API_BASE_URL`

## Integracao VTEX por SKU

O projeto consegue buscar as imagens direto do endpoint de arquivos do SKU na VTEX:

- consultar `/api/catalog/pvt/stockkeepingunit/{sku}/file`
- usar `FileLocation` como link publico da imagem
- ordenar os links pela posicao retornada pela VTEX
- exportar uma linha por SKU

Fluxo:

1. use a area `Buscar VTEX`
2. cole uma lista de SKUs
3. clique em `Buscar fotos na VTEX`
4. revise os links encontrados
5. exporte o CSV com uma linha por SKU

## Padrao do nome do arquivo

Salve suas imagens neste formato:

- `51687_1.jpg`
- `51687_2.jpg`
- `99001_1.png`

Regra:

- o que vem antes do `_` vira `sku`
- o que vem depois do `_` vira `position`

Esse preenchimento e automatico na tela e no CSV exportado.

## Rodando o projeto

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

## Hospedagem

O app pode ser hospedado como Web Service Node.js usando `npm start`. Antes de publicar, configure `APP_BASIC_AUTH_USER` e `APP_BASIC_AUTH_PASSWORD` para proteger a interface.

Veja o passo a passo em [docs/proximos-passos-hospedagem.md](docs/proximos-passos-hospedagem.md).

## Observacoes importantes para AnyMarket

- Marketplaces normalmente precisam de links permanentes para as imagens.
- URLs assinadas expiram, entao sao boas para teste, mas nao costumam ser a melhor opcao para importacao em marketplace.
- Se os links exportados nao abrirem em aba anonima, o AnyMarket provavelmente tambem nao vai conseguir ler essas imagens.

## Estrutura exportada no CSV

O CSV gerado pela interface sai com as colunas:

- `sku`
- `link 1`
- `link 2`
- `link 3`
- demais colunas `link N` conforme a maior quantidade de fotos encontrada em um SKU

Se o layout da sua importacao no AnyMarket usar outros nomes de coluna, voce pode abrir o CSV no Excel/Sheets e renomear o cabecalho.
