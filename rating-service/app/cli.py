from __future__ import annotations

import typer

from .services.ratings import refresh_sources

cli = typer.Typer(help="Rating MCP utility commands")


@cli.command()
def refresh(source: list[str] | None = typer.Argument(None), force: bool = False) -> None:
    """Refresh selected sources."""

    result = refresh_sources(source, force=force)
    typer.echo(result["summary"])
