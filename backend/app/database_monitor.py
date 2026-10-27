from __future__ import annotations

import re
from datetime import datetime

from fastapi import APIRouter
from sqlalchemy import inspect, text


AUDIT_TABLE = "database_activity"
SKIP_TABLES = {AUDIT_TABLE, "alembic_version"}


def _identifier(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_]+", value):
        raise ValueError("Invalid SQL identifier")
    return f"`{value}`"


def _tables(engine):
    return [name for name in inspect(engine).get_table_names() if name not in SKIP_TABLES]


def _ensure_audit_table(engine):
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS database_activity (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                table_name VARCHAR(128) NOT NULL,
                operation VARCHAR(10) NOT NULL,
                record_id BIGINT NULL,
                summary VARCHAR(255) NOT NULL,
                created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                INDEX idx_activity_created_at (created_at),
                INDEX idx_activity_table (table_name)
            ) ENGINE=InnoDB
        """))


def _ensure_triggers(engine):
    _ensure_audit_table(engine)
    inspector = inspect(engine)

    with engine.begin() as conn:
        for table in _tables(engine):
            columns = {column["name"] for column in inspector.get_columns(table)}
            new_id = "NEW.`id`" if "id" in columns else "NULL"
            old_id = "OLD.`id`" if "id" in columns else "NULL"
            safe_table = _identifier(table)
            base = re.sub(r"[^A-Za-z0-9_]", "_", table)[:45]

            for operation, timing, record_id in (
                ("INSERT", "AFTER INSERT", new_id),
                ("UPDATE", "AFTER UPDATE", new_id),
                ("DELETE", "AFTER DELETE", old_id),
            ):
                trigger_name = f"pc_audit_{base}_{operation.lower()}"
                exists = conn.execute(text("""
                    SELECT COUNT(*) FROM information_schema.TRIGGERS
                    WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = :name
                """), {"name": trigger_name}).scalar_one()
                if exists:
                    continue

                sql = f"""
                    CREATE TRIGGER `{trigger_name}`
                    {timing} ON {safe_table}
                    FOR EACH ROW
                    INSERT INTO database_activity
                        (table_name, operation, record_id, summary)
                    VALUES
                        ('{table}', '{operation}', {record_id},
                         CONCAT('{operation} em {table}',
                            IF({record_id} IS NULL, '', CONCAT(' #', {record_id}))))
                """
                conn.execute(text(sql))


def create_monitor_router(engine):
    router = APIRouter(prefix="/api/v1/monitor", tags=["Database Monitor"])

    @router.get("")
    def monitor(limit: int = 100):
        _ensure_triggers(engine)
        limit = max(10, min(limit, 200))

        with engine.connect() as conn:
            tables = []
            for table in _tables(engine):
                count = conn.execute(
                    text(f"SELECT COUNT(*) FROM {_identifier(table)}")
                ).scalar_one()
                tables.append({"table": table, "count": int(count)})

            rows = conn.execute(text("""
                SELECT id, table_name, operation, record_id, summary, created_at
                FROM database_activity
                ORDER BY created_at DESC, id DESC
                LIMIT :limit
            """), {"limit": limit}).mappings().all()

        activity = []
        for row in rows:
            created_at = row["created_at"]
            if isinstance(created_at, datetime):
                created_at = created_at.isoformat()
            activity.append({
                "id": int(row["id"]),
                "table": row["table_name"],
                "operation": row["operation"],
                "record_id": row["record_id"],
                "summary": row["summary"],
                "created_at": str(created_at),
            })

        return {
            "live": True,
            "updated_at": datetime.now().astimezone().isoformat(),
            "tables": tables,
            "activity": activity,
        }

    return router
