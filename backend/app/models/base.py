# -----------------------------------------------------------------------------
# Shared declarative base class that all database models inherit from.
# -----------------------------------------------------------------------------

from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass