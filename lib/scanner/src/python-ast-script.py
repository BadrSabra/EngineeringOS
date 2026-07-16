"""
Batched Python AST extractor used by the scanner's graph-extractor.

Reads a JSON array of {"path": str, "content": str} objects from stdin,
parses each with the stdlib `ast` module (real structural parsing — no
regex heuristics), and writes a JSON array of results to stdout:

  [{"path": str, "entities": [...], "imports": [...], "error"?: str}, ...]

entities: {"type": "function"|"class", "name": str, "className"?: str}
  - Module-level function/class defs, plus methods nested directly under a
    module-level (or class-nested, e.g. a `Meta` inner class) class
    (recorded as "ClassName.method").
  - Names starting with "_" are skipped (private-by-convention, mirroring
    the TS/JS extractor's private-member skip).
  - Deliberately scope-aware: only module-level and class-nested defs are
    collected. A class or function defined *inside a function body* (a
    local helper) is implementation detail, not part of the module's
    externally-visible surface, so it is not walked into or reported —
    mirroring how the TS/JS extractor only looks at top-level exports.

imports: {"module": str|null, "level": int, "names": [str]}
  - `import a.b` -> {"module": "a.b", "level": 0, "names": []}
  - `from a.b import c` -> {"module": "a.b", "level": 0, "names": ["c"]}
  - `from . import c` -> {"module": null, "level": 1, "names": ["c"]}
  - `from ..pkg import c` -> {"module": "pkg", "level": 2, "names": ["c"]}
  `names` matters because `from . import utils` and `from pkg import utils`
  commonly refer to a *submodule* named `utils`, not an attribute — the
  Node side tries both the module path itself and module+each name as
  candidate file paths. Resolution against actual project file paths
  happens on the Node side, which knows the full set of scanned paths;
  this script only reports the raw import shape.

A syntax error (or any other per-file exception) is captured on that
file's result as "error" rather than aborting the whole batch, so one
malformed file never loses coverage for the rest of the scan.
"""

import ast
import json
import sys


def collect_class_entities(class_node, entities):
    """Record a ClassDef (unless private-by-convention) plus its directly
    nested method/class defs.

    Recurses into nested `ClassDef`s within the class body (e.g. a Django-
    style inner `Meta` class) so those are captured too, but deliberately
    does NOT descend into method bodies — a class or function defined
    inside a method is local implementation detail, not part of the
    module's surface. If the class itself is private-by-convention, its
    methods are skipped too rather than surfacing as orphaned
    `_PrivateClass.method` entities for an otherwise-excluded class.
    """
    is_private = class_node.name.startswith("_")
    if not is_private:
        entities.append({"type": "class", "name": class_node.name})
    for item in class_node.body:
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if not is_private and not item.name.startswith("_"):
                entities.append({
                    "type": "function",
                    "name": "{}.{}".format(class_node.name, item.name),
                    "className": class_node.name,
                })
        elif isinstance(item, ast.ClassDef) and not is_private:
            collect_class_entities(item, entities)


def parse_file(path, content):
    entities = []
    imports = []

    try:
        tree = ast.parse(content, filename=path)
    except SyntaxError as exc:
        return {"path": path, "entities": entities, "imports": imports, "error": str(exc)}

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and not node.name.startswith("_"):
            entities.append({"type": "function", "name": node.name})
        elif isinstance(node, ast.ClassDef):
            collect_class_entities(node, entities)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                imports.append({"module": alias.name, "level": 0, "names": []})
        elif isinstance(node, ast.ImportFrom):
            imports.append({
                "module": node.module,
                "level": node.level or 0,
                "names": [alias.name for alias in node.names],
            })

    return {"path": path, "entities": entities, "imports": imports}


def main():
    raw = sys.stdin.read()
    try:
        files = json.loads(raw)
    except json.JSONDecodeError as exc:
        sys.stderr.write("invalid input: {}\n".format(exc))
        sys.exit(1)

    results = []
    for f in files:
        path = f.get("path", "?")
        try:
            results.append(parse_file(path, f.get("content", "")))
        except Exception as exc:  # never let one bad file kill the batch
            results.append({"path": path, "entities": [], "imports": [], "error": str(exc)})

    sys.stdout.write(json.dumps(results))


if __name__ == "__main__":
    main()
