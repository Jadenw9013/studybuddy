"""Bounded data-only ingestion. Uploaded notebooks are never executed."""
from __future__ import annotations
import argparse
import csv
import hashlib
import io
import json
import math
import re
from pathlib import Path
import sys

MAX_BYTES = 25 * 1024 * 1024
MAX_TEXT = 2_000_000
PARSER_REVISION = "r2-parser-2"


def parse_dsa(data: dict) -> dict:
    """Read a bounded teaching dataset, never code or a renderer specification."""
    if not isinstance(data, dict) or data.get("format") != "live-tutor-dsa-v1":
        raise ValueError("JSON uploads need the live-tutor-dsa-v1 teaching-data format.")
    if set(data) - {"format", "title", "description", "structure", "teachingExample"}:
        raise ValueError("The DSA file contains unsupported top-level fields.")
    if not isinstance(data.get("title"), str) or not 1 <= len(data["title"]) <= 100:
        raise ValueError("Name this DSA dataset using 1–100 characters.")
    if not isinstance(data.get("description", ""), str) or len(data.get("description", "")) > 2000:
        raise ValueError("Keep the DSA description under 2,000 characters.")
    if "teachingExample" in data and not isinstance(data["teachingExample"], bool):
        raise ValueError("Teaching-example metadata must be a boolean.")
    d = data.get("structure")
    if not isinstance(d, dict) or set(d) - {"kind", "directed", "rootId", "nodes", "edges"}:
        raise ValueError("Choose a bounded graph, binary tree or binary search tree.")
    if d.get("kind") not in ("graph", "binary_tree", "bst") or not isinstance(d.get("directed"), bool):
        raise ValueError("Specify a graph/tree kind and whether its edges are directed.")
    nodes, edges = d.get("nodes"), d.get("edges")
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 31 or not isinstance(edges, list) or len(edges) > 62:
        raise ValueError("DSA diagrams support 1–31 nodes and up to 62 edges.")
    ids = set()
    for node in nodes:
        if not isinstance(node, dict) or set(node) - {"id", "label", "value"}:
            raise ValueError("Each DSA node needs an ID and a text label.")
        node_id = node.get("id")
        if not isinstance(node_id, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,39}", node_id) or node_id in ids:
            raise ValueError("Node IDs must be unique, start with a letter and contain at most 40 letters, numbers, dashes or underscores.")
        ids.add(node_id)
        if not isinstance(node.get("label"), str) or not 1 <= len(node["label"]) <= 60:
            raise ValueError("Node labels must contain 1–60 characters.")
        value = node.get("value")
        if "value" in node and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > 1_000_000):
            raise ValueError("Node values must be finite numbers within ±1,000,000.")
    root = d.get("rootId")
    if root is not None and (not isinstance(root, str) or root not in ids):
        raise ValueError("The root must identify a node in this dataset.")
    seen_edges, children, parents = set(), {n: {} for n in ids}, {n: 0 for n in ids}
    for edge in edges:
        if not isinstance(edge, dict) or set(edge) - {"from", "to", "side"} or not isinstance(edge.get("from"), str) or not isinstance(edge.get("to"), str) or edge.get("from") not in ids or edge.get("to") not in ids:
            raise ValueError("Every edge must connect two existing node IDs.")
        pair = (edge["from"], edge["to"])
        identity = pair if d["directed"] else tuple(sorted(pair))
        if edge["from"] == edge["to"] or identity in seen_edges:
            raise ValueError("Duplicate edges and self-loops are not supported in this teaching dataset.")
        seen_edges.add(identity)
        if d["kind"] == "graph":
            if "side" in edge:
                raise ValueError("Graph edges do not have left/right tree positions.")
        else:
            side = edge.get("side")
            if side not in ("left", "right") or side in children[edge["from"]]:
                raise ValueError("A binary-tree parent can have at most one left child and one right child.")
            children[edge["from"]][side] = edge["to"]
            parents[edge["to"]] += 1
    if d["kind"] != "graph":
        if not d["directed"] or root is None or len(edges) != len(nodes) - 1 or parents[root] != 0 or any(parents[n] != 1 for n in ids if n != root):
            raise ValueError("A binary tree needs one root, directed parent-child edges and one parent for every other node.")
        visited = set()
        values = {n["id"]: n.get("value") for n in nodes}
        def walk(node_id, lower=-math.inf, upper=math.inf):
            if node_id in visited:
                raise ValueError("Binary trees cannot contain cycles.")
            visited.add(node_id)
            value = values[node_id]
            if d["kind"] == "bst" and (value is None or not lower < value < upper):
                raise ValueError("BST values must be unique and obey the ordering rule throughout each subtree.")
            if "left" in children[node_id]:
                walk(children[node_id]["left"], lower, value if d["kind"] == "bst" else upper)
            if "right" in children[node_id]:
                walk(children[node_id]["right"], value if d["kind"] == "bst" else lower, upper)
        walk(root)
        if visited != ids:
            raise ValueError("All tree nodes must be reachable from the root.")
    return d


def chunks(text: str, locator: dict) -> list[dict]:
    words = text.split()
    return [{"text": " ".join(words[start:start + 420]), "locator": locator.copy(),
             "hash": hashlib.sha256(" ".join(words[start:start + 420]).encode()).hexdigest()}
            for start in range(0, len(words), 360)]


def parse(path: str | Path, original_name: str | None = None) -> dict:
    path = Path(path)
    if path.stat().st_size > MAX_BYTES:
        raise ValueError("File exceeds the 25 MB limit.")
    raw = path.read_bytes()
    name = original_name or path.name
    suffix = Path(name).suffix.lower()
    result = {"passages": [], "status": "ready", "skippedPages": [], "parserRevision": PARSER_REVISION}
    if suffix == ".pdf":
        if not raw.startswith(b"%PDF-"):
            raise ValueError("The selected PDF does not have a PDF header.")
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(raw), strict=False)
        if reader.is_encrypted:
            raise ValueError("Export an unencrypted PDF before uploading.")
        if len(reader.pages) > 200:
            raise ValueError("PDF exceeds the 200-page limit.")
        text_size = 0
        for index, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            text_size += len(text)
            if text_size > MAX_TEXT:
                raise ValueError("Extracted text exceeds the ingestion limit.")
            if len(text.strip()) < 12:
                result["skippedPages"].append(index + 1)
                continue
            result["passages"].extend(chunks(text, {"pageIndex": index, "physicalPage": index + 1}))
        if result["skippedPages"]:
            result["status"] = "ready_with_skipped_pages" if result["passages"] else "needs_attention"
            result["message"] = "Some pages have no searchable text. Paste text or export a searchable PDF."
    elif suffix == ".csv":
        text = raw.decode("utf-8-sig", errors="strict")
        reader = csv.DictReader(io.StringIO(text, newline=""))
        columns = reader.fieldnames
        if not columns or len(columns) > 100 or len(set(columns)) != len(columns) or any(not c.strip() for c in columns):
            raise ValueError("CSV needs 1–100 unique named columns.")
        rows = []
        for index, row in enumerate(reader):
            if index >= 100_000:
                raise ValueError("CSV exceeds the 100,000-row limit.")
            if None in row or any(v is None for v in row.values()):
                raise ValueError("CSV row widths do not match the header.")
            rows.append(row)
        numeric = []
        missing = {}; invalid = {}
        for col in columns:
            finite = 0; empty = 0; bad = 0
            for row in rows:
                value = row[col].strip()
                if not value:
                    empty += 1; continue
                try:
                    number = float(value)
                    if not math.isfinite(number):
                        bad += 1
                    else:
                        finite += 1
                except ValueError:
                    bad += 1
            if finite:
                numeric.append(col)
            missing[col] = empty; invalid[col] = bad
        result["dataset"] = {"columns": columns, "rows": rows, "numericColumns": numeric,
                             "rowCount": len(rows), "missing": missing, "invalid": invalid,
                             "fingerprint": hashlib.sha256(raw).hexdigest(), "units": {}}
        for start in range(0, len(rows), 40):
            block = rows[start:start + 40]
            text_block = ", ".join(columns) + "\n" + "\n".join(", ".join(row[c] for c in columns) for row in block)
            result["passages"].extend(chunks(text_block, {"rowStart": start + 1, "rowEnd": start + len(block), "columns": columns}))
    elif suffix == ".json":
        data = json.loads(raw.decode("utf-8-sig"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError("DSA data cannot contain NaN or infinity.")))
        structure = parse_dsa(data)
        result["dsa"] = structure
        result["dsaExample"] = data.get("teachingExample", False)
        result["passages"] = chunks(data["title"] + "\n" + data.get("description", "") + "\nStructure: " + structure["kind"] + ". Directed: " + str(structure["directed"]) + ". Root: " + str(structure.get("rootId", "not specified")), {"dsa": True, "section": "structure"})
        for node in structure["nodes"]:
            result["passages"].extend(chunks("Node " + node["id"] + ": " + node["label"] + (". Value: " + str(node["value"]) if "value" in node else ""), {"dsa": True, "section": "nodes", "nodeId": node["id"]}))
        if structure["edges"]:
            edge_text = "\n".join(edge["from"] + (" -> " if structure["directed"] else " -- ") + edge["to"] + (" (" + edge["side"] + " child)" if "side" in edge else "") for edge in structure["edges"])
            result["passages"].extend(chunks(edge_text, {"dsa": True, "section": "edges"}))
    elif suffix == ".ipynb":
        import nbformat
        data = json.loads(raw.decode("utf-8"))
        if data.get("nbformat") != 4:
            raise ValueError("Only notebook format version 4 is supported.")
        notebook = nbformat.reads(raw.decode("utf-8"), as_version=4)
        if len(notebook.cells) > 2000:
            raise ValueError("Notebook exceeds the 2,000-cell limit.")
        cells = []
        seen_ids = set()
        total = 0
        for index, cell in enumerate(notebook.cells):
            source = str(cell.source)
            total += len(source)
            if total > MAX_TEXT:
                raise ValueError("Notebook text exceeds the ingestion limit.")
            digest = hashlib.sha256(source.encode()).hexdigest()
            # nbformat may synthesize random IDs for older files. Use the original
            # identity or an ordinal/source-hash fallback so retries are stable.
            cell_id = data["cells"][index].get("id") or f"cell-{index + 1}-{digest[:12]}"
            if not isinstance(cell_id, str) or len(cell_id) > 128 or cell_id in seen_ids:
                raise ValueError("Notebook cell identities must be unique and bounded.")
            seen_ids.add(cell_id)
            # Outputs are intentionally excluded; no HTML, JavaScript or remote resources.
            clean = {"id": cell_id, "cellId": cell_id, "ordinal": index + 1,
                     "cellType": cell.cell_type, "source": source, "sourceHash": digest}
            cells.append(clean)
            result["passages"].extend(chunks(source, {"cellId": cell_id, "ordinal": index + 1, "sourceHash": digest}))
        result["notebook"] = {"cells": cells, "snapshot": True}
    elif suffix in (".txt", ".md"):
        text = raw.decode("utf-8-sig", errors="strict")
        if "\x00" in text or len(text) > MAX_TEXT:
            raise ValueError("Text is binary or exceeds the extraction limit.")
        result["passages"] = chunks(text, {"lineStart": 1, "lineEnd": len(text.splitlines())})
    else:
        raise ValueError("Supported files are PDF, UTF-8 CSV, notebook v4, plain text and structured DSA JSON.")
    return result


def main() -> None:
    # The parent consumes JSON as UTF-8 on every OS. Windows redirected Python
    # stdout otherwise follows the locale and corrupts Unicode course notes.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    parser.add_argument("original_name", nargs="?")
    parser.add_argument("--name", dest="name")
    args = parser.parse_args()
    try:
        print(json.dumps(parse(args.path, args.name or args.original_name), ensure_ascii=False, allow_nan=False))
    except Exception as exc:
        print(json.dumps({"error": str(exc), "status": "needs_attention", "passages": [], "skippedPages": []}))
        sys.exit(1)


if __name__ == "__main__":
    main()
