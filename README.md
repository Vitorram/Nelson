# Passo Certo — loja de calçados

Loja em HTML/CSS/JavaScript com API FastAPI e MySQL. O visual usa uma marca geométrica original em preto, branco e prata, com verde ácido como cor de ação.

## Recursos

- Login/cadastro, catálogo com busca e tamanhos, sacola, endereço, pedidos e histórico do cliente.
- Cartão **de demonstração**: o cliente pode digitar dados fictícios sem validação; número, validade e CVC ficam só no formulário e são descartados sem envio ao servidor. O sistema guarda apenas bandeira, apelido e finais demonstrativos; o pedido é marcado como pago em simulação, sem cobrança real.
- Área administrativa para cadastrar/editar/arquivar produtos, buscar e escolher fotos, consultar usuários e compras, pausar contas e atualizar separação/rastreio.
- Senhas Argon2id, sessão `HttpOnly`, CSRF, limitação de tentativas de login e criptografia dos dados pessoais de cadastro e entrega.
- Estoque abatido em transação ao criar pedido. Produtos são arquivados em vez de apagados fisicamente para preservar o histórico de compras.

## Instalação e execução no Windows

Instale Python 3.11+ e Docker Desktop. Na raiz do projeto, inicie o MySQL:

```powershell
docker compose up -d
```

No terminal do backend:

```powershell
cd backend
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Se ainda não tiver configuração local, copie o exemplo e preencha `APP_SECRET` e `PII_ENCRYPTION_KEY` com chaves próprias:

```powershell
Copy-Item .env.example .env
py -c "import secrets; print(secrets.token_urlsafe(48))"
py -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

No `.env`, para o compose padrão, use:

```text
DATABASE_URL=mysql+pymysql://app:local-app-change-me@127.0.0.1:3308/passo_certo?charset=utf8mb4
COOKIE_SECURE=false
FRONTEND_ORIGINS=http://localhost:5500,http://127.0.0.1:5500
```

O `.env` é ignorado pelo Git. Guarde suas chaves: `APP_SECRET` assina as sessões e `PII_ENCRYPTION_KEY` descriptografa os dados pessoais.

Crie o administrador (o script cria as tabelas na primeira execução) e rode a API:

```powershell
py create_admin.py
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Abra `frontend/index.html` pelo Live Server do VS Code em `localhost:5500` ou `127.0.0.1:5500`. Não abra o HTML diretamente pelo Explorador. A API fica em `http://127.0.0.1:8000/docs`.

## Fotos de produtos

O painel administrativo busca fotos pela API oficial do Unsplash. Crie uma aplicação no [portal de desenvolvedores do Unsplash](https://unsplash.com/developers) e coloque o **Access Key** em `UNSPLASH_ACCESS_KEY` no `.env`; reinicie o FastAPI e use **Buscar fotos** no formulário do produto. A aplicação em modo demo tem limite de 50 buscas por hora. A integração usa os links de imagem fornecidos pelo Unsplash e exibe crédito clicável ao fotógrafo, seguindo as [regras da API](https://unsplash.com/documentation) e as [diretrizes de atribuição](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines).

Sem a chave, ainda é possível cadastrar produtos colando uma URL de imagem HTTPS. Para inserir seis itens ilustrativos no catálogo local, execute `py seed_products.py` dentro de `backend`; o comando é idempotente e inclui estoque inicial e créditos das fotos. Esses itens e estoques são exemplos para a demonstração: revise-os no painel antes de vender produtos reais.

## Rotas principais

- Público: `GET /api/v1/products`, `GET /api/v1/products/{id}`.
- Conta: `POST /api/v1/auth/register`, `/login`, `/logout`, `GET /api/v1/auth/me`.
- Comprador: `GET/POST /api/v1/addresses`, `GET/POST /api/v1/demo-cards`, `POST /api/v1/orders`, `POST /api/v1/orders/{id}/demo-payment`, `GET /api/v1/orders`.
- Administrador: `POST /api/v1/products`, `GET /api/v1/admin/products`, `PATCH/DELETE /api/v1/admin/products/{id}`, `GET /api/v1/admin/users`, `PATCH /api/v1/admin/users/{id}/status`, `GET /api/v1/admin/orders`, `PATCH /api/v1/admin/orders/{id}/status` e `/shipping`, `GET /api/v1/admin/images/search`.

Todas as operações de escrita exigem o valor do cookie CSRF no header `X-CSRF-Token`. Cookies são compartilhados pelo frontend com `credentials: "include"`.

## Roteiro para demonstração em aula

1. Na raiz do projeto, execute `docker compose up -d` e confirme com `docker compose ps` que `nelson-segunda-mysql` está `Up`.
2. No terminal do backend, ative `.venv` e execute `uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`. Acesse `http://127.0.0.1:8000/health`; a resposta esperada é `{"status":"ok"}`.
3. Abra `frontend/index.html` com Live Server no VS Code, pela porta 5500. O catálogo precisa mostrar os produtos antes de começar.
4. Na loja, crie uma conta com email de teste e senha de pelo menos 12 caracteres e entre nela.
5. Em **Minha conta**, cadastre um cartão de demonstração escolhendo Visa ou Mastercard e dando um apelido. O app atribui finais fictícios `4242` ou `4444`; não digite dados de cartão real.
6. Adicione um calçado e tamanho disponível à sacola, avance para o checkout e preencha entrega com dados fictícios. O CPF precisa passar a validação; use somente dados de teste.
7. Confirme o pedido demo. A tela de pedidos deve mostrar o pedido como pago. A compra é simulada e não movimenta dinheiro.
8. No MySQL Workbench, crie uma conexão com **Hostname** `127.0.0.1`, **Port** `3308`, **Username** `app`, **Password** `local-app-change-me`. Abra o schema `passo_certo` e consulte `users`, `addresses`, `demo_cards`, `orders`, `order_items`, `products` e `inventory`.

Os dados pessoais de usuário e entrega aparecem criptografados nas tabelas; isso é esperado. Para demonstrar a compra, confira o novo registro em `orders` (status `paid`, provedor `demo`) e seus itens em `order_items`. Não use `docker compose down -v`: a opção `-v` apaga o volume local e os dados da demonstração.

## Produção

O pagamento é apenas uma simulação local. Antes de aceitar pagamentos reais, integre um provedor com checkout/tokenização e webhooks assinados. Nunca colete PAN completo ou CVV no frontend/backend. Em produção, use HTTPS, `COOKIE_SECURE=true`, segredos gerenciados fora do repositório, uma origem CORS específica, backups protegidos e migrações de banco controladas.
