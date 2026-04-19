from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    minimax_api_key: str = Field(default="")
    minimax_base_url: str = Field(default="https://api.minimaxi.com/v1")
    minimax_model_text: str = Field(default="MiniMax-M2")
    minimax_model_vision: str = Field(default="MiniMax-M2")

    crossref_mailto: str = Field(default="")

    max_upload_mb: int = Field(default=25)
    max_pdf_pages: int = Field(default=40)
    max_vision_pages: int = Field(default=4)
    max_concurrent_jobs: int = Field(default=5)
    request_timeout_seconds: int = Field(default=60)

    data_dir: Path = Field(default=Path("data"))

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def sqlite_path(self) -> Path:
        return self.data_dir / "apa7.db"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    return settings
