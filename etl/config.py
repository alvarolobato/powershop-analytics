"""ETL configuration — loaded from environment variables via python-dotenv."""
import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


@dataclass
class Config:
    p4d_host: str = field(default_factory=lambda: os.environ.get("P4D_HOST", ""))
    p4d_port: int = field(
        default_factory=lambda: int(os.environ.get("P4D_PORT", "19812"))
    )
    p4d_user: str = field(default_factory=lambda: os.environ.get("P4D_USER", ""))
    p4d_password: str = field(
        default_factory=lambda: os.environ.get("P4D_PASSWORD", "")
    )
    postgres_dsn: str = field(
        default_factory=lambda: os.environ.get("POSTGRES_DSN", "")
    )

    def __post_init__(self) -> None:
        if not self.postgres_dsn:
            raise ValueError(
                "POSTGRES_DSN environment variable is required but not set. "
                "Set it to a valid PostgreSQL connection string, e.g.: "
                "postgresql://user:password@host:5432/dbname"
            )
