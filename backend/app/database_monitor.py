from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

AUDIT_TABLE = "database_activity"
SKIP_TABLES = {AUDIT_TABLE, "alembic_version"}
HIDDEN_COLUMN_PARTS = (
    "_cipher", "_lookup", "cpf", "phone", "token", "secret",
    "card_number", "cvc"
)


def _identifier(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_]+", value):
        raise HTTPException(400, "Identificador inválido")
    return f"\`{value}\`"


def _tables(engine) -> list[str]:
    return sorted(name for name in inspect(engine).get_table_names() if name not in SKIP_TABLES)


def _table_or_404(engine, table: str) -> str:
    if table not in _tables(engine):
        raise HTTPException(404, "Tabela não encontrada")
    return table


def _json_value(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bytes):
        return value.hex()
    return value


def _visible_columns(engine, table: str) -> list[dict]:
    columns = inspect(engine).get_columns(table)
    return [
        column for column in columns
        if not any(part in column["name"].lower() for part in HIDDEN_COLUMN_PARTS)
    ]


def create_monitor_router(engine, admin_dependency):
    router = APIRouter(
        prefix="/api/v1/monitor",
        tags=["Database Explorer"],
        dependencies=[Depends(admin_dependency)],
    )

    @router.get("")
    def overview():
        inspector = inspect(engine)
        names = _tables(engine)
        tables = []
        with engine.connect() as conn:
            for name in names:
                count = conn.execute(
                    text(f"SELECT COUNT(*) FROM {_identifier(name)}")
                ).scalar_one()
                tables.append({"table": name, "count": int(count)})
            activity = []
            if AUDIT_TABLE in inspector.get_table_names():
                rows = conn.execute(text("""
                    SELECT id, table_name, operation, record_id, summary, created_at
                    FROM database_activity
                    ORDER BY created_at DESC, id DESC
                    LIMIT 100
                """)).mappings().all()
                activity = [{
                    "id": int(row["id"]),
                    "table": row["table_name"],
                    "operation": row["operation"],
                    "record_id": row["record_id"],
                    "summary": row["summary"],
                    "created_at": _json_value(row["created_at"]),
                } for row in rows]

            db_info = conn.execute(text("""
                SELECT DATABASE() AS database_name, VERSION() AS mysql_version
            """)).mappings().one()

        return {
            "live": True,
            "database": db_info["database_name"],
            "mysql_version": db_info["mysql_version"],
            "updated_at": datetime.now().astimezone().isoformat(),
            "tables": tables,
            "total_rows": sum(item["count"] for item in tables),
            "activity": activity,
        }

    @router.get("/tables/{table}/structure")
    def table_structure(table: str):
        _table_or_404(engine, table)
        inspector = inspect(engine)
        columns = inspector.get_columns(table)
        primary = set(inspector.get_pk_constraint(table).get("constrained_columns") or [])
        foreign_keys = inspector.get_foreign_keys(table)
        foreign_columns = {
            col for fk in foreign_keys for col in (fk.get("constrained_columns") or [])
        }
        indexes = inspector.get_indexes(table)
        unique_constraints = inspector.get_unique_constraints(table)

        return {
            "table": table,
            "columns": [{
                "name": col["name"],
                "type": str(col["type"]),
                "nullable": bool(col.get("nullable", True)),
                "default": _json_value(col.get("default")),
                "primary_key": col["name"] in primary,
                "foreign_key": col["name"] in foreign_columns,
            } for col in columns],
            "primary_key": list(primary),
            "foreign_keys": [{
                "columns": fk.get("constrained_columns") or [],
                "references_table": fk.get("referred_table"),
                "references_columns": fk.get("referred_columns") or [],
                "name": fk.get("name"),
            } for fk in foreign_keys],
            "indexes": [{
                "name": idx.get("name"),
                "columns": idx.get("column_names") or [],
                "unique": bool(idx.get("unique")),
            } for idx in indexes],
            "unique_constraints": [{
                "name": item.get("name"),
                "columns": item.get("column_names") or [],
            } for item in unique_constraints],
        }

    @router.get("/tables/{table}/rows")
    def table_rows(
        table: str,
        limit: int = Query(50, ge=1, le=100),
        offset: int = Query(0, ge=0),
        sort: str | None = None,
        direction: str = Query("asc", pattern="^(asc|desc)$"),
        q: str | None = Query(None, max_length=120),
    ):
        _table_or_404(engine, table)
        columns = _visible_columns(engine, table)
        visible_names = [col["name"] for col in columns]
        if not visible_names:
            return {"table": table, "columns": [], "rows": [], "total": 0, "limit": limit, "offset": offset}

        if sort and sort not in visible_names:
            raise HTTPException(400, "Coluna de ordenação inválida")

        where_sql = ""
        params: dict = {"limit": limit, "offset": offset}
        if q:
            searchable = [
                col["name"] for col in columns
                if any(token in str(col["type"]).lower() for token in ("char", "text", "enum"))
                or col["name"].lower() in ("id", "role", "status", "active")
            ]
            if searchable:
                clauses = []
                for index, name in enumerate(searchable):
                    key = f"search_{index}"
                    clauses.append(f"CAST({_identifier(name)} AS CHAR) LIKE :{key}")
                    params[key] = f"%{q}%"
                where_sql = " WHERE (" + " OR ".join(clauses) + ")"

        order_sql = ""
        if sort:
            order_sql = f" ORDER BY {_identifier(sort)} {direction.upper()}"
        selected = ", ".join(_identifier(name) for name in visible_names)
        table_sql = _identifier(table)

        try:
            with engine.connect() as conn:
                total = conn.execute(
                    text(f"SELECT COUNT(*) FROM {table_sql}{where_sql}"), params
                ).scalar_one()
                records = conn.execute(text(
                    f"SELECT {selected} FROM {table_sql}{where_sql}{order_sql} LIMIT :limit OFFSET :offset"
                ), params).mappings().all()
        except SQLAlchemyError:
            raise HTTPException(500, "Não foi possível consultar os registros")

        return {
            "table": table,
            "columns": visible_names,
            "rows": [{key: _json_value(value) for key, value in row.items()} for row in records],
            "total": int(total),
            "limit": limit,
            "offset": offset,
        }

    return router
