"""Create the first admin account interactively; never ships with credentials."""
import getpass
import re
from app.main import Base, SessionLocal, engine, User, password_hash, cipher, cpf_hmac
from sqlalchemy import select

Base.metadata.create_all(engine)
email = input("Email do administrador: ").strip().lower()
name = input("Nome: ").strip()
password = getpass.getpass("Senha (mínimo 12 caracteres): ")
if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
    raise SystemExit("Email inválido")
if len(password) < 12:
    raise SystemExit("A senha deve ter pelo menos 12 caracteres")
with SessionLocal() as db:
    if db.scalar(select(User).where(User.email_lookup == cpf_hmac(email))):
        raise SystemExit("Já existe uma conta com esse email")
    db.add(User(name_cipher=cipher.encrypt(name.encode()).decode(), email_cipher=cipher.encrypt(email.encode()).decode(),
                email_lookup=cpf_hmac(email), password_hash=password_hash.hash(password), role="admin"))
    db.commit()
print("Administrador criado.")
