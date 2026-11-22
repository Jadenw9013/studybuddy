"""Opt-in, revision-pinned BGE embeddings. No model code or remote URLs execute.

Default mode only loads previously downloaded weights. Operators must explicitly
run --prepare once to download the pinned public model into the chosen cache.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import uuid

MODEL = "BAAI/bge-small-en-v1.5"
REVISION = "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a"
DIMENSIONS = 384
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "
_model = None


def load_model(allow_download=False):
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(MODEL, revision=REVISION, trust_remote_code=False,
            local_files_only=not allow_download, device="cpu",
            cache_folder=os.environ.get("BGE_CACHE_DIR"))
        if _model.get_sentence_embedding_dimension() != DIMENSIONS:
            raise ValueError("Unexpected embedding dimensions for pinned BGE revision.")
    return _model


def finite_vector(value):
    values = [float(x) for x in value]
    if len(values) != DIMENSIONS or not all(math.isfinite(x) for x in values):
        raise ValueError("BGE returned an invalid embedding.")
    norm = math.sqrt(sum(x*x for x in values))
    if not 0.999 <= norm <= 1.001:
        raise ValueError("BGE embedding was not normalized.")
    return values


def split_passage(passage, model, namespace=""):
    """Token-boundary splits preserve source locator and exact character offsets."""
    text = passage["text"]
    tokenizer = model.tokenizer
    declared = int(model.max_seq_length)
    tokenizer_limit = int(tokenizer.model_max_length)
    # Some tokenizers use a huge sentinel for 'unknown'. The model limit wins.
    limit = min(declared, tokenizer_limit) if tokenizer_limit < 1_000_000 else declared
    specials = int(tokenizer.num_special_tokens_to_add(pair=False))
    budget = limit - specials
    if budget < 16:
        raise ValueError("Tokenizer exposes no safe document token budget.")
    tokenized = tokenizer(text, add_special_tokens=False, return_offsets_mapping=True, truncation=False)
    offsets = tokenized["offset_mapping"]
    if not offsets:
        return []
    stride = max(1, budget - min(60, budget // 4))
    out = []
    original_id = passage.get("id")
    for start in range(0, len(offsets), stride):
        end = min(start + budget, len(offsets))
        char_start, char_end = offsets[start][0], offsets[end - 1][1]
        exact = text[char_start:char_end]
        if not exact.strip():
            continue
        # Re-tokenize the exact slice; offset-boundary behavior must not hide truncation.
        if len(tokenizer(exact, add_special_tokens=True, truncation=False)["input_ids"]) > limit:
            raise ValueError("A tokenizer-boundary chunk exceeds its actual model limit.")
        locator = dict(passage.get("locator", {}))
        locator.update({"characterStart": char_start, "characterEnd": char_end})
        identity = original_id or hashlib.sha256((json.dumps(locator,sort_keys=True)+text).encode()).hexdigest()
        chunk_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{REVISION}/{namespace}/{identity}/{char_start}/{char_end}"))
        out.append({**passage, "id": chunk_id, "parentPassageId": original_id,
                    "text": exact, "locator": locator, "tokenCount": end - start,
                    "tokenLimit": limit, "specialTokens": specials})
        if end == len(offsets):
            break
    return out


def embed_passages(passages, allow_download=False, namespace=None):
    if len(passages) > 2000 or sum(len(p.get("text", "")) for p in passages) > 2_000_000:
        raise ValueError("Embedding input exceeds the document cap.")
    model = load_model(allow_download)
    # The job/source-version namespace prevents identical files in distinct courses
    # from colliding. Calls without one get an independent ingestion namespace.
    namespace = namespace or str(uuid.uuid4())
    chunks = [chunk for passage in passages for chunk in split_passage(passage, model, namespace)]
    if len(chunks) > 2000:
        raise ValueError("Tokenized passages exceed the index cap.")
    if chunks:
        encoded = model.encode([p["text"] for p in chunks], batch_size=16, normalize_embeddings=True,
                               show_progress_bar=False, convert_to_numpy=True)
        for passage, vector in zip(chunks, encoded):
            passage["embedding"] = finite_vector(vector)
            passage["embeddingRevision"] = REVISION
    return {"passages": chunks, "embeddingModel": MODEL, "embeddingRevision": REVISION}


def embed_query(text, allow_download=False):
    if not isinstance(text, str) or not text.strip() or len(text) > 4000:
        raise ValueError("Query must contain 1–4000 characters.")
    model = load_model(allow_download)
    prefixed = QUERY_PREFIX + text
    if len(model.tokenizer(prefixed, add_special_tokens=True, truncation=False)["input_ids"]) > model.max_seq_length:
        raise ValueError("Query exceeds the actual model token limit; shorten it.")
    vector = model.encode([prefixed], normalize_embeddings=True, show_progress_bar=False, convert_to_numpy=True)[0]
    return {"embedding": finite_vector(vector), "embeddingModel": MODEL, "embeddingRevision": REVISION}


def embed_queries(queries, allow_download=False):
    if not isinstance(queries, list) or not 1 <= len(queries) <= 100:
        raise ValueError("Batch must contain 1–100 queries.")
    model = load_model(allow_download)
    texts = []
    for text in queries:
        if not isinstance(text, str) or not text.strip() or len(text) > 4000:
            raise ValueError("Query must contain 1–4000 characters.")
        prefixed = QUERY_PREFIX + text
        if len(model.tokenizer(prefixed, add_special_tokens=True, truncation=False)["input_ids"]) > model.max_seq_length:
            raise ValueError("Query exceeds the actual model token limit; shorten it.")
        texts.append(prefixed)
    vectors = model.encode(texts, batch_size=16, normalize_embeddings=True, show_progress_bar=False, convert_to_numpy=True)
    return {"embeddings": [finite_vector(v) for v in vectors], "embeddingModel": MODEL, "embeddingRevision": REVISION}


if __name__ == "__main__":
    # Parent processes use UTF-8 JSON, including mathematical notation. Windows
    # redirected streams otherwise inherit a legacy code page.
    for stream in (sys.stdin, sys.stdout):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare", action="store_true", help="Explicitly download the pinned public weights.")
    parser.add_argument("--query", action="store_true", help="Read {query:string} from stdin; otherwise {passages:[]}.")
    parser.add_argument("--queries", action="store_true", help="Read {queries:string[]} from stdin for evaluation batches.")
    args = parser.parse_args()
    try:
        if args.prepare:
            model = load_model(True)
            output = {"prepared": True, "model": MODEL, "revision": REVISION, "dimensions": DIMENSIONS,
                      "tokenLimit": model.max_seq_length,
                      "specialTokens": model.tokenizer.num_special_tokens_to_add(pair=False)}
        else:
            data = json.loads(sys.stdin.read(16 * 1024 * 1024))
            output = embed_queries(data["queries"]) if args.queries else embed_query(data["query"]) if args.query else embed_passages(data["passages"], namespace=data.get("namespace"))
        print(json.dumps(output, ensure_ascii=False, allow_nan=False))
    except Exception as exc:
        # Do not print learner text or provider objects; failure is explicit.
        print(json.dumps({"error": "embedding_unavailable", "message": type(exc).__name__, "model": MODEL, "revision": REVISION}))
        sys.exit(1)
