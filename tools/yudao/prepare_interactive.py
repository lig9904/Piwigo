#!/usr/bin/env python3
"""Copy two original interactive entries and local dependency closure, without rewriting.

Only prepares a local deployment stage. Does not publish or modify the source site.
"""
import argparse
import hashlib
import html.parser
import io
import json
import re
import tarfile
from pathlib import Path
from urllib.parse import unquote, urlsplit

MODELS = [
    {"key": "loft-r26", "label": "R14/R26 檐下露台与日式外观互动模型",
     "version_id": "b90a6f0f-a11f-4696-a499-ade1b902ce3c",
     "entry": "model/covered-terrace-r26/R26檐下露台及日式外观.html"},
    {"key": "site-r03", "label": "R03 场地与景观互动模型",
     "version_id": "1ae5b5cd-bfd7-42a5-80e8-c22a2cbd3c56",
     "entry": "model/site-r03/场地景观模型.html"},
]


class References(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in ("src", "href", "poster") and value:
                self.urls.append(value)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def references(path, data):
    text = data.decode("utf-8")
    urls = []
    if path.suffix.lower() in (".html", ".htm"):
        parser = References()
        parser.feed(text)
        urls.extend(parser.urls)
    # Local CSS resources, module imports, fetch calls and literal loader calls.
    patterns = [r"url\(\s*[\"']?([^\s\"')]+)",
                r"(?:fetch|\.load)\(\s*[\"']([^\"']+)[\"']",
                r"\bimport\s+(?:[^;\n]*?\s+from\s+)?[\"']([^\"']+)[\"']"]
    for pattern in patterns:
        urls.extend(re.findall(pattern, text))
    if path.suffix.lower() == ".gltf":
        doc = json.loads(text)
        urls.extend(item["uri"] for key in ("buffers", "images") for item in doc.get(key, []) if "uri" in item)
    return urls


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True, help="Original static site root")
    parser.add_argument("--output", type=Path, required=True, help="New local package directory")
    args = parser.parse_args()
    source = args.source_root.resolve(strict=True)
    output = args.output.resolve()
    if output == source or source in output.parents:
        raise SystemExit("Output must be outside the original site")
    stage = output / "materials" / "interactive"
    if stage.exists():
        raise SystemExit("Stage already exists; select a new output directory")
    queue = [model["entry"] for model in MODELS]
    files, dependency_edges, external = {}, [], set()
    while queue:
        relative = queue.pop(0)
        if relative in files:
            continue
        path = (source / relative).resolve(strict=True)
        if source not in path.parents or not path.is_file():
            raise SystemExit(f"Unsafe source path: {relative}")
        data = path.read_bytes()
        files[relative] = data
        if path.suffix.lower() in (".html", ".htm", ".js", ".mjs", ".css", ".gltf"):
            for url in references(path, data):
                parsed = urlsplit(url)
                if parsed.scheme or parsed.netloc:
                    if parsed.scheme not in ("data", "blob"):
                        external.add(url)
                    continue
                if not parsed.path:
                    continue
                dependency = ((source if parsed.path.startswith("/") else path.parent)
                              / unquote(parsed.path).lstrip("/")).resolve(strict=True)
                if source not in dependency.parents:
                    raise SystemExit(f"Dependency escapes source: {url}")
                dependency_rel = dependency.relative_to(source).as_posix()
                dependency_edges.append({"from": relative, "to": dependency_rel, "reference": url})
                queue.append(dependency_rel)
    if external:
        raise SystemExit(f"External dependencies require explicit packaging: {sorted(external)}")
    records = []
    for relative, data in sorted(files.items()):
        target = stage / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        copied_sha = digest(target.read_bytes())
        source_sha = digest((source / relative).read_bytes())
        if copied_sha != source_sha or copied_sha != digest(data):
            raise SystemExit(f"Source changed or copied hash mismatch: {relative}")
        records.append({"path": relative, "size": len(data), "source_sha256": source_sha,
                        "copied_sha256": copied_sha})
    manifest = {"source_root": str(source), "stage_root": str(stage), "file_count": len(records),
                "total_bytes": sum(item["size"] for item in records), "files": records,
                "dependencies": dependency_edges, "external_dependencies": sorted(external)}
    output.mkdir(parents=True, exist_ok=True)
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n")
    configs = [{key: model[key] for key in ("key", "label", "version_id")}
               | {"url": "plugins/yudao_design/viewer.php/"+model["entry"]} for model in MODELS]
    (output / "interactive-models.json").write_text(json.dumps(configs, ensure_ascii=False, indent=2)+"\n")
    archive = output / "interactive-materials.tar"
    # Stable metadata produces a reproducible archive across local preparation runs.
    with tarfile.open(archive, "w", format=tarfile.PAX_FORMAT) as bundle:
        for relative, data in sorted(files.items()):
            info = tarfile.TarInfo("interactive/"+relative)
            info.size, info.mode, info.mtime, info.uid, info.gid = len(data), 0o644, 0, 0, 0
            bundle.addfile(info, io.BytesIO(data))
    archive_sha = digest(archive.read_bytes())
    (output / "package.sha256").write_text(archive_sha+"  "+archive.name+"\n")
    print(json.dumps({"file_count": len(records), "total_bytes": manifest["total_bytes"],
                      "archive": str(archive), "sha256": archive_sha}, ensure_ascii=False))


if __name__ == "__main__":
    main()
