#!/usr/bin/env python3
"""
Vault Semantic Search

Search the vault using vector similarity with optional metadata filtering.
Uses ChromaDB's DefaultEmbeddingFunction for query embedding.

Usage:
    python search.py --query "options trading strategies" --n-results 5
    python search.py --query "task automation" --folder "TaskNotes"
    python search.py --query "earnings" --tag "investing" --status "open"
"""

import argparse
import json
import sqlite3
import struct
import sys
from pathlib import Path

# Check dependencies
try:
    import sqlite_vec
except ImportError:
    print("Error: sqlite-vec not installed. Run: pip install sqlite-vec")
    sys.exit(1)

try:
    from chromadb.utils import embedding_functions
except ImportError:
    print("Error: chromadb not installed. Run: pip install chromadb")
    sys.exit(1)


DEFAULT_DB_PATH = "/Users/roasbeef/vault/.claude/vault_search/vault.db"
DEFAULT_VAULT_PATH = "/Users/roasbeef/vault"
EMBEDDING_DIM = 384


def get_embedding_function():
  """Get the ChromaDB embedding function."""
  return embedding_functions.DefaultEmbeddingFunction()


def path_is_within(base: Path, candidate: Path) -> bool:
    """Return True when candidate is inside base (including base itself)."""
    try:
        candidate.relative_to(base)
        return True
    except ValueError:
        return False


def validate_db_path(db_path: str, vault_path: str) -> Path:
    """Ensure db_path is inside vault_path."""
    resolved_db = Path(db_path).resolve()
    resolved_vault = Path(vault_path).resolve()
    if not path_is_within(resolved_vault, resolved_db):
        print("Error: db_path must be within vault directory", file=sys.stderr)
        sys.exit(1)
    return resolved_db


def search(
    query: str,
    db_path: str,
    vault_path: str,
    n_results: int = 5,
    folder: str = None,
    status: str = None,
    tag: str = None,
    extension: str = None,
) -> list[dict]:
    """
    Perform semantic search with optional metadata filtering.

    Args:
        query: Search query text
        db_path: Path to sqlite database
        vault_path: Path to vault root
        n_results: Number of results to return
        folder: Filter by folder prefix
        status: Filter by note status
        tag: Filter by tag (substring match in tags JSON)
        extension: Filter by file extension

    Returns:
        List of search results with metadata
    """
    resolved_db = validate_db_path(db_path, vault_path)
    if not resolved_db.exists():
        print(f"Error: Database not found: {resolved_db}")
        print("Run: python index.py --rebuild")
        sys.exit(1)

    # Connect to database
    conn = sqlite3.connect(str(resolved_db))
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)

    # Generate query embedding
    ef = get_embedding_function()
    query_embedding = ef([query])[0]

    # Convert to bytes for sqlite-vec
    query_bytes = struct.pack(f"{len(query_embedding)}f", *query_embedding)

    # Build WHERE clause with parameterized queries (security: no string interpolation).
    where_clauses = []
    params: list = [query_bytes]  # First param is always the embedding.
    if folder:
        where_clauses.append("n.folder LIKE ? || '%'")
        params.append(folder)
    if status:
        where_clauses.append("n.status = ?")
        params.append(status)
    if tag:
        where_clauses.append("n.tags LIKE '%' || ? || '%'")
        params.append(tag)
    if extension:
        where_clauses.append("n.filename LIKE '%.' || ?")
        params.append(extension)

    where_sql = ""
    if where_clauses:
        where_sql = "WHERE " + " AND ".join(where_clauses)

    # If we have metadata filters, fetch more results initially to account for filtering.
    fetch_limit = n_results * 3 if where_clauses else n_results
    params.append(fetch_limit)

    # Query with vector search and metadata join.
    sql = f"""
        SELECT
            c.chunk_id,
            c.path,
            c.heading,
            c.chunk_text,
            c.distance,
            n.title,
            n.folder,
            n.status,
            n.priority,
            n.due,
            n.tags
        FROM (
            SELECT
                chunk_id,
                path,
                heading,
                chunk_text,
                distance
            FROM vec_chunks
            WHERE embedding MATCH ?
            ORDER BY distance
            LIMIT ?
        ) c
        LEFT JOIN notes n ON c.path = n.path
        {where_sql}
        ORDER BY c.distance
    """

    # Reorder params: embedding match is first ?, limit is second ?, then filters.
    # The subquery uses (embedding MATCH ?, LIMIT ?) so those must come first.
    ordered_params = [params[0], params[-1]] + params[1:-1]

    try:
        cursor = conn.execute(sql, ordered_params)
        rows = cursor.fetchall()
    except sqlite3.Error as e:
        print(f"Error executing search: {e}")
        conn.close()
        sys.exit(1)

    # Build results
    results = []
    for row in rows[:n_results]:
        result = {
            "chunk_id": row[0],
            "path": row[1],
            "heading": row[2],
            "snippet": row[3][:300] + "..." if len(row[3]) > 300 else row[3],
            "distance": row[4],
            "title": row[5],
            "folder": row[6],
            "status": row[7],
            "priority": row[8],
            "due": row[9],
            "tags": json.loads(row[10]) if row[10] else []
        }
        results.append(result)

    conn.close()
    return results


def format_results(results: list[dict], query: str) -> str:
    """Format results for human-readable output."""
    if not results:
        return f"No results found for: {query}"

    lines = [f"=== Search Results for: {query} ===\n"]

    for i, r in enumerate(results, 1):
        lines.append(f"{i}. {r['title']}")
        lines.append(f"   Path: {r['path']}")
        lines.append(f"   Section: {r['heading']}")
        if r['status']:
            lines.append(f"   Status: {r['status']}")
        if r['distance'] is not None:
            lines.append(f"   Relevance: {1 - r['distance']:.2%}")
        lines.append(f"   Snippet: {r['snippet'][:200]}...")
        lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Semantic search over vault"
    )
    parser.add_argument(
        "--query", "-q",
        required=True,
        help="Search query"
    )
    parser.add_argument(
        "--n-results", "-n",
        type=int,
        default=5,
        help="Number of results (default: 5)"
    )
    parser.add_argument(
        "--folder", "-f",
        help="Filter by folder prefix"
    )
    parser.add_argument(
        "--status",
        help="Filter by note status (e.g., 'open', 'closed')"
    )
    parser.add_argument(
        "--tag", "-t",
        help="Filter by tag (substring match)"
    )
    parser.add_argument(
        "--extension",
        help="Filter by file extension (e.g., 'md')"
    )
    parser.add_argument(
        "--db-path",
        default=DEFAULT_DB_PATH,
        help=f"Database path (default: {DEFAULT_DB_PATH})"
    )
    parser.add_argument(
        "--vault-path",
        default=DEFAULT_VAULT_PATH,
        help=f"Vault path (default: {DEFAULT_VAULT_PATH})"
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output JSON instead of formatted text"
    )

    args = parser.parse_args()

    results = search(
        query=args.query,
        db_path=args.db_path,
        vault_path=args.vault_path,
        n_results=args.n_results,
        folder=args.folder,
        status=args.status,
        tag=args.tag,
        extension=args.extension,
    )

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        print(format_results(results, args.query))
        print("\n--- JSON OUTPUT ---")
        print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
