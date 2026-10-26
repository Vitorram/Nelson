"""Insert six illustrative sneaker listings into the configured MySQL database."""
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text

load_dotenv()
engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)

PRODUCTS = [
    {
        "name": "PC Silver Pulse",
        "description": "Tênis de corrida em mesh cinza e prata, com entressola leve. Foto ilustrativa.",
        "brand": "PC EDITION", "category": "Running", "price": "429.90",
        "image_url": "https://images.unsplash.com/photo-1637437757614-6491c8e915b5?auto=format&fit=crop&w=1000&q=85",
        "photo_credit": "Mostafa Mahmoudi",
        "photo_url": "https://unsplash.com/photos/a-pair-of-running-shoes-on-a-white-background-W_uDEmTq0po?utm_source=passo_certo&utm_medium=referral",
        "sizes": {38: 4, 39: 6, 40: 5, 41: 4, 42: 3},
    },
    {
        "name": "PC Street Pulse",
        "description": "Silhueta esportiva azul e branca para o uso diário. Foto ilustrativa.",
        "brand": "PC EDITION", "category": "Lifestyle", "price": "389.90",
        "image_url": "https://images.unsplash.com/photo-1535595278992-7d1e59b30194?auto=format&fit=crop&w=1000&q=85",
        "photo_credit": "Daniel Octavian",
        "photo_url": "https://unsplash.com/photos/selective-focus-photography-of-unpaired-blue-and-white-adidas-running-shoe-leaning-on-concrete-pavement-at-daytime-nOeHuXPZKhk?utm_source=passo_certo&utm_medium=referral",
        "sizes": {38: 3, 39: 4, 40: 6, 41: 5, 42: 3, 43: 2},
    },
    {
        "name": "PC Orbit Mesh",
        "description": "Cabedal respirável em tons gelo e grafite, com solado robusto. Foto ilustrativa.",
        "brand": "PC EDITION", "category": "Training", "price": "459.90",
        "image_url": "https://images.unsplash.com/photo-1637437411360-b4607d62ddd3?auto=format&fit=crop&w=1000&q=85",
        "photo_credit": "Mostafa Mahmoudi",
        "photo_url": "https://unsplash.com/photos/a-close-up-of-a-shoe-on-a-white-background-P_RXel_thDA?utm_source=passo_certo&utm_medium=referral",
        "sizes": {38: 2, 39: 5, 40: 5, 41: 5, 42: 4},
    },
    {
        "name": "PC Aero Lime",
        "description": "Tênis de corrida branco com pontos de cor vibrante e amortecimento alto. Foto ilustrativa.",
        "brand": "PC EDITION", "category": "Running", "price": "549.90",
        "image_url": "https://images.unsplash.com/photo-1774280246516-5a817f172a39?auto=format&fit=crop&w=1000&q=85",
        "photo_credit": "Landon Liedtke",
        "photo_url": "https://unsplash.com/photos/pair-of-white-hoka-running-shoes-with-lime-green-soles-853F1TIGVpk?utm_source=passo_certo&utm_medium=referral",
        "sizes": {39: 3, 40: 4, 41: 6, 42: 4, 43: 2},
    },
    {
        "name": "PC Court Mono",
        "description": "Tênis branco de linhas clássicas, fácil de combinar. Foto ilustrativa.",
        "brand": "PC EDITION", "category": "Lifestyle", "price": "359.90",
        "image_url": "https://images.unsplash.com/photo-1608231387042-66d1773070a5?auto=format&fit=crop&w=1000&q=85",
        "photo_credit": "The DK Photography",
        "photo_url": "https://unsplash.com/photos/white-sneaker-on-dark-background-NUoPWImmjCU?utm_source=passo_certo&utm_medium=referral",
        "sizes": {37: 2, 38: 5, 39: 5, 40: 4, 41: 3, 42: 2},
    },
    {
        "name": "PC Cloud Runner",
        "description": "Runner branco e cinza com visual retrô e conforto para longas caminhadas. Foto ilustrativa.",
        "brand": "PC EDITION", "category": "Walking", "price": "419.90",
        "image_url": "https://images.unsplash.com/photo-1622760808027-095ea611f657?auto=format&fit=crop&w=1000&q=85",
        "photo_credit": "Ethan Rougon",
        "photo_url": "https://unsplash.com/photos/a-pair-of-white-sneakers-sitting-on-top-of-a-wooden-table-JhCVZC7FwX4?utm_source=passo_certo&utm_medium=referral",
        "sizes": {38: 3, 39: 5, 40: 5, 41: 4, 42: 3, 43: 2},
    },
]

with engine.begin() as connection:
    if not inspect(engine).has_table("products") or not inspect(engine).has_table("inventory"):
        raise SystemExit("Tabelas da loja não encontradas. Rode py create_admin.py primeiro.")
    product_columns = {col["name"] for col in inspect(engine).get_columns("products")}
    for col, sql_type in (("image_url", "VARCHAR(500) NOT NULL DEFAULT ''"),
                          ("photo_credit", "VARCHAR(120) NOT NULL DEFAULT ''"),
                          ("photo_url", "VARCHAR(500) NOT NULL DEFAULT ''")):
        if col not in product_columns:
            connection.execute(text(f"ALTER TABLE products ADD COLUMN {col} {sql_type}"))

    added = 0
    for item in PRODUCTS:
        existing = connection.execute(text("SELECT id FROM products WHERE name = :name LIMIT 1"), {"name": item["name"]}).scalar()
        if existing:
            continue
        product_id = connection.execute(text("""
            INSERT INTO products (name, description, brand, category, image_url, photo_credit, photo_url, price, active, created_at)
            VALUES (:name, :description, :brand, :category, :image_url, :photo_credit, :photo_url, :price, 1, CURRENT_TIMESTAMP)
        """), item).lastrowid
        for size, quantity in item["sizes"].items():
            connection.execute(text("INSERT INTO inventory (product_id, size, quantity) VALUES (:product_id, :size, :quantity)"),
                               {"product_id": product_id, "size": size, "quantity": quantity})
        added += 1

    total = connection.execute(text("SELECT COUNT(*) FROM products WHERE active = 1")).scalar()
    print(f"Produtos adicionados: {added}; total ativo no catálogo: {total}.")
