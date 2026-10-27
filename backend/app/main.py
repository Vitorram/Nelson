from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal

from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer
import httpx
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from pwdlib import PasswordHash
from sqlalchemy import (Boolean, DateTime, ForeignKey, Integer, Numeric, String,
                        Text, UniqueConstraint, create_engine, select, func, inspect, text)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

from app.database_monitor import create_monitor_router


load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "mysql+pymysql://app:local-app-change-me@127.0.0.1:3308/passo_certo?charset=utf8mb4")
APP_SECRET = os.getenv("APP_SECRET", "")
PII_KEY = os.getenv("PII_ENCRYPTION_KEY", "")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
if len(APP_SECRET) < 32:
    raise RuntimeError("Configure APP_SECRET com pelo menos 32 caracteres.")
try:
    cipher = Fernet(PII_KEY.encode())
except (ValueError, TypeError):
    raise RuntimeError("Configure PII_ENCRYPTION_KEY com uma chave Fernet válida.")

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=1800)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
password_hash = PasswordHash.recommended()


class Base(DeclarativeBase): pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name_cipher: Mapped[str] = mapped_column(Text, nullable=False)
    email_cipher: Mapped[str] = mapped_column(Text, nullable=False)
    email_lookup: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="customer", nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class Address(Base):
    __tablename__ = "addresses"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    recipient_cipher: Mapped[str] = mapped_column(Text, nullable=False)
    cpf_cipher: Mapped[str] = mapped_column(Text, nullable=False)
    cpf_lookup: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    postal_code_cipher: Mapped[str] = mapped_column(Text, nullable=False)
    street_cipher: Mapped[str] = mapped_column(Text, nullable=False)
    number_cipher: Mapped[str] = mapped_column(Text, nullable=False)
    complement_cipher: Mapped[str | None] = mapped_column(Text)
    district_cipher: Mapped[str] = mapped_column(Text, nullable=False)
    city_cipher: Mapped[str] = mapped_column(Text, nullable=False)
    state_cipher: Mapped[str] = mapped_column(Text, nullable=False)
    phone_cipher: Mapped[str] = mapped_column(Text, nullable=False)


class Product(Base):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    brand: Mapped[str] = mapped_column(String(80), nullable=False)
    category: Mapped[str] = mapped_column(String(60), nullable=False)
    image_url: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    photo_credit: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    photo_url: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    sizes: Mapped[list[Inventory]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class Inventory(Base):
    __tablename__ = "inventory"
    __table_args__ = (UniqueConstraint("product_id", "size", name="uq_inventory_product_size"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    address_id: Mapped[int] = mapped_column(ForeignKey("addresses.id"))
    status: Mapped[str] = mapped_column(String(24), default="awaiting_payment", nullable=False)
    total: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    payment_provider: Mapped[str | None] = mapped_column(String(60))
    payment_reference: Mapped[str | None] = mapped_column(String(120))
    tracking_code: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    items: Mapped[list[OrderItem]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class OrderItem(Base):
    __tablename__ = "order_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    product_name: Mapped[str] = mapped_column(String(160), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)


class DemoCard(Base):
    __tablename__ = "demo_cards"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(60), nullable=False)
    brand: Mapped[str] = mapped_column(String(20), nullable=False)
    last4: Mapped[str] = mapped_column(String(4), nullable=False)
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class AddressIn(BaseModel):
    recipient: str = Field(min_length=2, max_length=120)
    cpf: str
    postal_code: str = Field(min_length=8, max_length=9)
    street: str = Field(min_length=2, max_length=180)
    number: str = Field(min_length=1, max_length=20)
    complement: str | None = Field(default=None, max_length=100)
    district: str = Field(min_length=2, max_length=100)
    city: str = Field(min_length=2, max_length=100)
    state: str = Field(min_length=2, max_length=2)
    phone: str = Field(min_length=10, max_length=20)

    @field_validator("cpf")
    @classmethod
    def normalize_cpf(cls, value: str) -> str:
        digits = "".join(c for c in value if c.isdigit())
        if len(digits) != 11 or len(set(digits)) == 1:
            raise ValueError("CPF inválido")
        for end in (9, 10):
            total = sum(int(digits[i]) * (end + 1 - i) for i in range(end))
            check = (total * 10 % 11) % 10
            if check != int(digits[end]): raise ValueError("CPF inválido")
        return digits


class OrderItemIn(BaseModel):
    product_id: int = Field(gt=0)
    size: int = Field(ge=20, le=50)
    quantity: int = Field(ge=1, le=10)


class OrderIn(BaseModel):
    address_id: int = Field(gt=0)
    items: list[OrderItemIn] = Field(min_length=1, max_length=30)


class ProductIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    description: str = Field(default="", max_length=4000)
    brand: str = Field(min_length=1, max_length=80)
    category: str = Field(min_length=2, max_length=60)
    price: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    image_url: str = Field(default="", max_length=500)
    photo_credit: str = Field(default="", max_length=120)
    photo_url: str = Field(default="", max_length=500)
    sizes: dict[int, int]


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    brand: str | None = Field(default=None, min_length=1, max_length=80)
    category: str | None = Field(default=None, min_length=2, max_length=60)
    price: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)
    image_url: str | None = Field(default=None, max_length=500)
    photo_credit: str | None = Field(default=None, max_length=120)
    photo_url: str | None = Field(default=None, max_length=500)
    sizes: dict[int, int] | None = None
    active: bool | None = None


class DemoCardIn(BaseModel):
    label: str = Field(min_length=2, max_length=60)
    brand: Literal["visa", "mastercard"]


class DemoPaymentIn(BaseModel):
    card_id: int = Field(gt=0)


class UserStatusIn(BaseModel):
    active: bool


class ShippingIn(BaseModel):
    tracking_code: str | None = Field(default=None, min_length=3, max_length=80)


class OrderStatusIn(BaseModel):
    status: str = Field(pattern="^(paid|processing|cancelled|delivered)$")


def db_session():
    with SessionLocal() as db: yield db


def csrf_token() -> str: return secrets.token_urlsafe(32)

def sign_session(user_id: int, expiry: int) -> str:
    body = f"{user_id}.{expiry}"
    signature = hmac.new(APP_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{signature}"

def unpack_session(token: str | None) -> int | None:
    if not token: return None
    try:
        uid, expiry, signature = token.split(".")
        body = f"{uid}.{expiry}"
        expected = hmac.new(APP_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected) or int(expiry) < int(time.time()): return None
        return int(uid)
    except (ValueError, TypeError): return None

def get_current_user(request: Request, db: Session = Depends(db_session)) -> User:
    uid = unpack_session(request.cookies.get("session"))
    if not uid: raise HTTPException(401, "Autenticação necessária")
    user = db.get(User, uid)
    if not user or not user.active: raise HTTPException(401, "Autenticação necessária")
    return user

def require_csrf(request: Request):
    cookie = request.cookies.get("csrf")
    header = request.headers.get("x-csrf-token")
    if not cookie or not header or not hmac.compare_digest(cookie, header):
        raise HTTPException(403, "Token CSRF inválido")

def admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin": raise HTTPException(403, "Acesso restrito")
    return user

def cpf_hmac(value: str) -> str:
    return hmac.new(APP_SECRET.encode(), value.encode(), hashlib.sha256).hexdigest()

def decrypt(value: str | None) -> str | None:
    if value is None: return None
    try: return cipher.decrypt(value.encode()).decode()
    except InvalidToken: raise HTTPException(500, "Não foi possível ler dados criptografados")

def safe_user(user: User): return {"id": user.id, "name": decrypt(user.name_cipher), "email": decrypt(user.email_cipher), "role": user.role}

def address_json(address: Address):
    return {"id": address.id, "recipient": decrypt(address.recipient_cipher), "postal_code": decrypt(address.postal_code_cipher),
        "street": decrypt(address.street_cipher), "number": decrypt(address.number_cipher), "complement": decrypt(address.complement_cipher),
        "district": decrypt(address.district_cipher), "city": decrypt(address.city_cipher), "state": decrypt(address.state_cipher)}

def product_json(p: Product):
    return {"id": p.id, "name": p.name, "description": p.description, "brand": p.brand,
            "category": p.category, "price": str(p.price), "image_url": p.image_url, "active": p.active,
            "photo_credit": p.photo_credit, "photo_url": p.photo_url,
            "sizes": [{"size": s.size, "stock": s.quantity} for s in p.sizes]}

def order_json(o: Order):
    return {"id": o.id, "status": o.status, "total": str(o.total), "tracking_code": o.tracking_code,
            "created_at": o.created_at.isoformat(), "items": [{"product_id": i.product_id, "name": i.product_name,
            "size": i.size, "quantity": i.quantity, "unit_price": str(i.unit_price)} for i in o.items]}


def demo_card_json(card: DemoCard):
    return {"id": card.id, "label": card.label, "brand": card.brand, "last4": card.last4}


def admin_order_json(order: Order, user: User, address: Address):
    result = order_json(order)
    result["customer"] = safe_user(user)
    result["shipping_address"] = {
        **address_json(address),
        "phone": decrypt(address.phone_cipher),
    }
    return result


app = FastAPI(title="Passo Certo API", version="1.0.0", docs_url="/docs", redoc_url=None)
app.include_router(create_monitor_router(engine))
origins = [x.strip() for x in os.getenv("FRONTEND_ORIGINS", "http://localhost:5500,http://127.0.0.1:5500").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Content-Type", "X-CSRF-Token"])
login_attempts: dict[str, deque[float]] = defaultdict(deque)


@app.on_event("startup")
def startup():
    Base.metadata.create_all(engine)
    product_columns = {column["name"] for column in inspect(engine).get_columns("products")}
    product_additions = {
        "image_url": "VARCHAR(500) NOT NULL DEFAULT ''",
        "photo_credit": "VARCHAR(120) NOT NULL DEFAULT ''",
        "photo_url": "VARCHAR(500) NOT NULL DEFAULT ''",
    }
    missing = [(name, definition) for name, definition in product_additions.items() if name not in product_columns]
    if missing:
        with engine.begin() as connection:
            for name, definition in missing:
                connection.execute(text(f"ALTER TABLE products ADD COLUMN {name} {definition}"))

@app.get("/health")
def health(): return {"status": "ok"}

@app.get("/api/v1/csrf")
def get_csrf(response: Response):
    token = csrf_token()
    response.set_cookie("csrf", token, httponly=False, secure=COOKIE_SECURE, samesite="lax", max_age=3600, path="/")
    return {"csrf_token": token}

@app.post("/api/v1/auth/register", status_code=201)
def register(data: RegisterIn, request: Request, db: Session = Depends(db_session), _: None = Depends(require_csrf)):
    email = data.email.lower().strip()
    lookup = cpf_hmac(email)
    if db.scalar(select(User).where(User.email_lookup == lookup)): raise HTTPException(409, "Não foi possível criar a conta com esses dados")
    user = User(name_cipher=cipher.encrypt(data.name.strip().encode()).decode(), email_cipher=cipher.encrypt(email.encode()).decode(),
                email_lookup=lookup, password_hash=password_hash.hash(data.password))
    db.add(user); db.commit(); db.refresh(user)
    return {"user": safe_user(user)}

@app.post("/api/v1/auth/login")
def login(data: LoginIn, request: Request, response: Response, db: Session = Depends(db_session), _: None = Depends(require_csrf)):
    ip = request.client.host if request.client else "unknown"
    key = hashlib.sha256((ip + data.email.lower()).encode()).hexdigest()
    now = time.time(); attempts = login_attempts[key]
    while attempts and attempts[0] < now - 900: attempts.popleft()
    if len(attempts) >= 8: raise HTTPException(429, "Muitas tentativas. Aguarde alguns minutos.")
    user = db.scalar(select(User).where(User.email_lookup == cpf_hmac(data.email.lower().strip())))
    if not user or not password_hash.verify(data.password, user.password_hash) or not user.active:
        attempts.append(now); raise HTTPException(401, "Email ou senha inválidos")
    attempts.clear(); response.set_cookie("session", sign_session(user.id, int(now + 8 * 3600)), httponly=True, secure=COOKIE_SECURE, samesite="lax", max_age=8 * 3600, path="/")
    token = csrf_token(); response.set_cookie("csrf", token, httponly=False, secure=COOKIE_SECURE, samesite="lax", max_age=8 * 3600, path="/")
    return {"user": safe_user(user), "csrf_token": token}

@app.post("/api/v1/auth/logout")
def logout(response: Response, _: User = Depends(get_current_user), __: None = Depends(require_csrf)):
    response.delete_cookie("session", path="/"); response.delete_cookie("csrf", path="/"); return {"ok": True}

@app.get("/api/v1/auth/me")
def me(user: User = Depends(get_current_user)): return {"user": safe_user(user)}

@app.get("/api/v1/products")
def products(q: str | None = None, category: str | None = None, size: int | None = None,
             limit: int = 24, offset: int = 0, db: Session = Depends(db_session)):
    stmt = select(Product).where(Product.active.is_(True)).order_by(Product.id).limit(min(limit, 100)).offset(max(offset, 0))
    if q: stmt = stmt.where(Product.name.ilike(f"%{q[:80]}%"))
    if category: stmt = stmt.where(Product.category == category[:60])
    found = db.scalars(stmt).all()
    if size is not None: found = [p for p in found if any(s.size == size and s.quantity > 0 for s in p.sizes)]
    return {"products": [product_json(p) for p in found]}

@app.get("/api/v1/products/{product_id}")
def product_detail(product_id: int, db: Session = Depends(db_session)):
    p = db.get(Product, product_id)
    if not p or not p.active: raise HTTPException(404, "Produto não encontrado")
    return {"product": product_json(p)}

@app.post("/api/v1/products", status_code=201)
def create_product(data: ProductIn, db: Session = Depends(db_session), _: User = Depends(admin), __: None = Depends(require_csrf)):
    if any(size < 20 or size > 50 or stock < 0 or stock > 10000 for size, stock in data.sizes.items()): raise HTTPException(422, "Tamanho ou estoque inválido")
    if any(url and not url.startswith("https://") for url in (data.image_url, data.photo_url)):
        raise HTTPException(422, "Links de imagem e créditos precisam usar HTTPS")
    p = Product(name=data.name, description=data.description, brand=data.brand, category=data.category, price=data.price,
                image_url=data.image_url, photo_credit=data.photo_credit, photo_url=data.photo_url,
                sizes=[Inventory(size=size, quantity=stock) for size, stock in data.sizes.items()])
    db.add(p); db.commit(); db.refresh(p); return {"product": product_json(p)}

@app.get("/api/v1/admin/products")
def admin_products(db: Session = Depends(db_session), _: User = Depends(admin)):
    rows = db.scalars(select(Product).order_by(Product.created_at.desc())).all()
    return {"products": [product_json(product) for product in rows]}


@app.patch("/api/v1/admin/products/{product_id}")
def update_product(product_id: int, data: ProductUpdate, db: Session = Depends(db_session), _: User = Depends(admin), __: None = Depends(require_csrf)):
    product = db.get(Product, product_id)
    if not product: raise HTTPException(404, "Produto não encontrado")
    changes = data.model_dump(exclude_unset=True)
    sizes = changes.pop("sizes", None)
    if any(changes.get(field) and not changes[field].startswith("https://") for field in ("image_url", "photo_url")):
        raise HTTPException(422, "Links de imagem e créditos precisam usar HTTPS")
    if sizes is not None:
        if any(size < 20 or size > 50 or stock < 0 or stock > 10000 for size, stock in sizes.items()):
            raise HTTPException(422, "Tamanho ou estoque inválido")
        current = {row.size: row for row in product.sizes}
        for size, row in current.items(): row.quantity = sizes.get(size, 0)
        for size, stock in sizes.items():
            if size not in current: product.sizes.append(Inventory(size=size, quantity=stock))
    for field, value in changes.items(): setattr(product, field, value)
    db.commit(); db.refresh(product)
    return {"product": product_json(product)}


@app.delete("/api/v1/admin/products/{product_id}")
def delete_product(product_id: int, db: Session = Depends(db_session), _: User = Depends(admin), __: None = Depends(require_csrf)):
    product = db.get(Product, product_id)
    if not product: raise HTTPException(404, "Produto não encontrado")
    product.active = False
    db.commit()
    return {"ok": True}


@app.get("/api/v1/admin/users")
def admin_users(db: Session = Depends(db_session), _: User = Depends(admin)):
    users = db.scalars(select(User).order_by(User.created_at.desc()).limit(500)).all()
    counts = dict(db.execute(select(Order.user_id, func.count(Order.id)).group_by(Order.user_id)).all())
    return {"users": [{**safe_user(user), "active": user.active, "created_at": user.created_at.isoformat(),
                       "orders_count": counts.get(user.id, 0)} for user in users]}


@app.patch("/api/v1/admin/users/{user_id}/status")
def update_user_status(user_id: int, data: UserStatusIn, db: Session = Depends(db_session), current: User = Depends(admin), __: None = Depends(require_csrf)):
    user = db.get(User, user_id)
    if not user: raise HTTPException(404, "Usuário não encontrado")
    if user.id == current.id and not data.active: raise HTTPException(409, "Não é possível desativar sua própria conta")
    user.active = data.active
    db.commit()
    return {"user": {**safe_user(user), "active": user.active}}


@app.get("/api/v1/admin/orders")
def admin_orders(db: Session = Depends(db_session), _: User = Depends(admin)):
    rows = db.scalars(select(Order).order_by(Order.created_at.desc()).limit(500)).all()
    result = []
    for order in rows:
        user = db.get(User, order.user_id)
        address = db.get(Address, order.address_id)
        if user and address: result.append(admin_order_json(order, user, address))
    return {"orders": result}


@app.get("/api/v1/admin/images/search")
async def search_product_photos(q: str = "sneaker shoe product", _: User = Depends(admin)):
    access_key = os.getenv("UNSPLASH_ACCESS_KEY", "").strip()
    if not access_key: raise HTTPException(503, "Configure UNSPLASH_ACCESS_KEY no backend/.env para buscar fotos")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get("https://api.unsplash.com/search/photos", params={"query": q[:100], "per_page": 12}, headers={"Authorization": f"Client-ID {access_key}", "Accept-Version": "v1"})
            response.raise_for_status()
    except httpx.HTTPError: raise HTTPException(502, "A busca de fotos está indisponível")
    photos = response.json().get("results", [])
    return {"photos": [{"id": photo["id"], "image_url": photo["urls"]["regular"], "thumb_url": photo["urls"]["small"],
                        "alt": photo.get("alt_description") or photo.get("description") or "Tênis",
                        "photographer": photo["user"]["name"],
                        "photographer_url": photo["user"]["links"]["html"] + "?utm_source=passo_certo&utm_medium=referral",
                        "photo_url": photo["links"]["html"] + "?utm_source=passo_certo&utm_medium=referral"} for photo in photos]}


@app.get("/api/v1/demo-cards")
def list_demo_cards(db: Session = Depends(db_session), user: User = Depends(get_current_user)):
    cards = db.scalars(select(DemoCard).where(DemoCard.user_id == user.id).order_by(DemoCard.id.desc())).all()
    return {"cards": [demo_card_json(card) for card in cards]}


@app.post("/api/v1/demo-cards", status_code=201)
def create_demo_card(data: DemoCardIn, db: Session = Depends(db_session), user: User = Depends(get_current_user), _: None = Depends(require_csrf)):
    card = DemoCard(user_id=user.id, label=data.label.strip(), brand=data.brand,
                    last4="4242" if data.brand == "visa" else "4444", token=secrets.token_urlsafe(32))
    db.add(card); db.commit(); db.refresh(card)
    return {"card": demo_card_json(card)}


@app.delete("/api/v1/demo-cards/{card_id}")
def delete_demo_card(card_id: int, db: Session = Depends(db_session), user: User = Depends(get_current_user), _: None = Depends(require_csrf)):
    card = db.get(DemoCard, card_id)
    if not card or card.user_id != user.id: raise HTTPException(404, "Cartão não encontrado")
    db.delete(card); db.commit()
    return {"ok": True}


@app.post("/api/v1/orders/{order_id}/demo-payment")
def pay_order_demo(order_id: int, data: DemoPaymentIn, db: Session = Depends(db_session), user: User = Depends(get_current_user), _: None = Depends(require_csrf)):
    order = db.get(Order, order_id)
    if not order or order.user_id != user.id: raise HTTPException(404, "Pedido não encontrado")
    if order.status != "awaiting_payment": raise HTTPException(409, "Pedido não está aguardando pagamento")
    card = db.get(DemoCard, data.card_id)
    if not card or card.user_id != user.id: raise HTTPException(404, "Cartão de demonstração não encontrado")
    order.status = "paid"
    order.payment_provider = "demo"
    order.payment_reference = "DEMO-" + secrets.token_hex(12)
    db.commit(); db.refresh(order)
    return {"order": order_json(order), "payment": {"status": "approved", "mode": "simulation"}}


@app.post("/api/v1/addresses", status_code=201)
def create_address(data: AddressIn, db: Session = Depends(db_session), user: User = Depends(get_current_user), _: None = Depends(require_csrf)):
    lookup = cpf_hmac(data.cpf)
    address = Address(user_id=user.id, recipient_cipher=cipher.encrypt(data.recipient.encode()).decode(), cpf_cipher=cipher.encrypt(data.cpf.encode()).decode(), cpf_lookup=lookup,
        postal_code_cipher=cipher.encrypt(data.postal_code.encode()).decode(), street_cipher=cipher.encrypt(data.street.encode()).decode(),
        number_cipher=cipher.encrypt(data.number.encode()).decode(), complement_cipher=cipher.encrypt(data.complement.encode()).decode() if data.complement else None,
        district_cipher=cipher.encrypt(data.district.encode()).decode(), city_cipher=cipher.encrypt(data.city.encode()).decode(),
        state_cipher=cipher.encrypt(data.state.upper().encode()).decode(), phone_cipher=cipher.encrypt(data.phone.encode()).decode())
    db.add(address); db.commit(); db.refresh(address)
    return {"address": address_json(address)}

@app.get("/api/v1/addresses")
def addresses(db: Session = Depends(db_session), user: User = Depends(get_current_user)):
    rows = db.scalars(select(Address).where(Address.user_id == user.id)).all()
    return {"addresses": [address_json(a) for a in rows]}

@app.post("/api/v1/orders", status_code=201)
def create_order(data: OrderIn, db: Session = Depends(db_session), user: User = Depends(get_current_user), _: None = Depends(require_csrf)):
    address = db.get(Address, data.address_id)
    if not address or address.user_id != user.id: raise HTTPException(404, "Endereço não encontrado")
    try:
        total = Decimal("0.00"); order = Order(user_id=user.id, address_id=address.id, status="awaiting_payment", total=0)
        db.add(order); db.flush()
        for line in data.items:
            inventory = db.scalar(select(Inventory).where(Inventory.product_id == line.product_id, Inventory.size == line.size).with_for_update())
            product = db.get(Product, line.product_id)
            if not product or not product.active or not inventory: raise HTTPException(400, "Produto ou tamanho indisponível")
            if inventory.quantity < line.quantity: raise HTTPException(409, "Estoque insuficiente")
            inventory.quantity -= line.quantity; total += product.price * line.quantity
            order.items.append(OrderItem(product_id=product.id, product_name=product.name, size=line.size, quantity=line.quantity, unit_price=product.price))
        order.total = total; db.commit(); db.refresh(order)
    except Exception:
        db.rollback(); raise
    return {"order": order_json(order), "payment": {"status": "awaiting_payment", "message": "Integre um provedor de pagamento para concluir a cobrança."}}

@app.get("/api/v1/orders")
def my_orders(db: Session = Depends(db_session), user: User = Depends(get_current_user)):
    rows = db.scalars(select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc())).all()
    return {"orders": [order_json(o) for o in rows]}

@app.get("/api/v1/orders/{order_id}")
def order_detail(order_id: int, db: Session = Depends(db_session), user: User = Depends(get_current_user)):
    o = db.get(Order, order_id)
    if not o or (o.user_id != user.id and user.role != "admin"): raise HTTPException(404, "Pedido não encontrado")
    return {"order": order_json(o)}

@app.patch("/api/v1/admin/orders/{order_id}/shipping")
def set_shipping(order_id: int, data: ShippingIn, db: Session = Depends(db_session), _: User = Depends(admin), __: None = Depends(require_csrf)):
    o = db.get(Order, order_id)
    if not o: raise HTTPException(404, "Pedido não encontrado")
    if o.status not in ("paid", "processing", "shipped"): raise HTTPException(409, "Pedido precisa estar pago antes do envio")
    if o.status == "shipped" and o.tracking_code:
        raise HTTPException(409, "Este pedido já tem código de rastreio")
    tracking_code = (data.tracking_code or "").strip()
    if not tracking_code:
        while True:
            tracking_code = f"PC-{datetime.utcnow():%Y%m%d}-{secrets.token_hex(4).upper()}"
            if not db.scalar(select(Order.id).where(Order.tracking_code == tracking_code)):
                break
    o.tracking_code = tracking_code
    o.status = "shipped"
    db.commit(); db.refresh(o)
    return {"order": order_json(o)}


@app.patch("/api/v1/admin/orders/{order_id}/status")
def update_order_status(order_id: int, data: OrderStatusIn, db: Session = Depends(db_session), _: User = Depends(admin), __: None = Depends(require_csrf)):
    o = db.get(Order, order_id)
    if not o: raise HTTPException(404, "Pedido não encontrado")
    allowed = {"awaiting_payment": {"paid", "cancelled"}, "paid": {"processing", "cancelled"},
               "processing": {"shipped", "cancelled"}, "shipped": {"delivered"}}
    if data.status not in allowed.get(o.status, set()): raise HTTPException(409, "Transição de status inválida")
    if data.status == "cancelled":
        for line in o.items:
            inv = db.scalar(select(Inventory).where(Inventory.product_id == line.product_id, Inventory.size == line.size).with_for_update())
            if inv: inv.quantity += line.quantity
    o.status = data.status; db.commit(); return {"order": order_json(o)}
