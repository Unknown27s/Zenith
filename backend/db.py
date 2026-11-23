import time
import uuid
import os
import re
from typing import Any

from sqlalchemy import JSON, Float, MetaData, String, create_engine, event
from sqlalchemy.schema import CreateSchema
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from .config import DATABASE_URL

database_url = make_url(DATABASE_URL)
if database_url.drivername in {'postgres', 'postgresql'}:
    database_url = database_url.set(drivername='postgresql+psycopg')
host = database_url.host or ''
if host.endswith(('.supabase.com', '.supabase.co')) and database_url.query.get('sslmode') not in {'require', 'verify-ca', 'verify-full'}:
    database_url = database_url.update_query_dict({'sslmode': 'require'})
engine = create_engine(database_url, connect_args={'check_same_thread': False, 'timeout': 30} if database_url.drivername.startswith('sqlite') else {'connect_timeout': 15}, pool_pre_ping=True)
if DATABASE_URL.startswith('sqlite'):
    @event.listens_for(engine, 'connect')
    def sqlite_settings(connection, _):
        connection.execute('PRAGMA journal_mode=WAL')
        connection.execute('PRAGMA busy_timeout=30000')

Session = sessionmaker(engine, expire_on_commit=False)
DB_SCHEMA = os.getenv('DATABASE_SCHEMA', 'zenith_private') if engine.dialect.name == 'postgresql' else None
if DB_SCHEMA and not re.fullmatch(r'[a-z][a-z0-9_]{0,62}', DB_SCHEMA):
    raise RuntimeError('DATABASE_SCHEMA must be a lowercase SQL identifier, up to 63 characters')


class Base(DeclarativeBase):
    metadata = MetaData(schema=DB_SCHEMA)


class Record(Base):
    __abstract__ = True
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    owner: Mapped[str] = mapped_column(String(64), index=True)
    created: Mapped[float] = mapped_column(Float, default=time.time)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Source(Record):
    __tablename__ = 'sources'


class Run(Record):
    __tablename__ = 'runs'
    status: Mapped[str] = mapped_column(String(24), default='queued', index=True)
    lease: Mapped[float] = mapped_column(Float, default=0)
    lease_token: Mapped[str] = mapped_column(String(64), default='')


class Incident(Record):
    __tablename__ = 'incidents'
    run_id: Mapped[str] = mapped_column(String(64), index=True)


class Notification(Record):
    __tablename__ = 'notifications'
    status: Mapped[str] = mapped_column(String(24), default='preview')


class Carbon(Record):
    __tablename__ = 'carbon'


class Equipment(Record):
    __tablename__ = 'equipment'


def init_db():
    with engine.begin() as connection:
        if DB_SCHEMA:
            connection.execute(CreateSchema(DB_SCHEMA, if_not_exists=True))
        Base.metadata.create_all(connection)


def serialize(row):
    result = {'id': row.id, 'created': row.created, **row.payload}
    if isinstance(row, Run):
        result['status'] = row.status
    if isinstance(row, Notification):
        result['status'] = row.status
    return result


class VisionReview(Record):
    __tablename__ = 'vision_reviews'

    # Primary key is the incident ID. Keep review writes independent of operator history.
    run_id: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(24), default='queued', index=True)
    lease: Mapped[float] = mapped_column(Float, default=0)
    lease_token: Mapped[str] = mapped_column(String(64), default='')
