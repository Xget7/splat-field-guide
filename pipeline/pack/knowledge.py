"""Reads content/<pack>/knowledge.md into short notes per part, for the instructor to retrieve one at a time.

The on-device model has a 4096-token context, so the app sends only the notes a question needs.
Each "## <part name>" section becomes that part's notes, and each "### <heading>" under it one note whose topic
comes from TOPICS. Source keys like "[VW safety]" and list numbering are dropped: the model reads plain sentences.
"""

import pathlib
import re

# Heading in knowledge.md -> topic id the app retrieves by.
TOPICS = {
    "What it is": "identity",
    "What it does": "purpose",
    "How it is built": "construction",
    "How to check it": "check",
    "Common faults": "faults",
    "Maintenance": "maintenance",
    "Specifications": "specifications",
    "Safety": "safety",
}
SOURCES_HEADING = "Sources"

_CITATION = re.compile(r"\s*\[[^\]]+\]")
_NUMBERING = re.compile(r"^\d+\.\s+")


def _sentences(lines: list[str]) -> str:
    kept = (_NUMBERING.sub("", _CITATION.sub("", line)).strip() for line in lines)
    return " ".join(line for line in kept if line)


def read_notes(path: pathlib.Path, parts: list[dict]) -> dict[str, list[dict]]:
    """Notes per part id, in the file's order; every part section and heading must be known."""
    by_name = {p["name"]: p["id"] for p in parts}
    notes: dict[str, list[dict]] = {p["id"]: [] for p in parts}
    part_id: str | None = None
    topic: str | None = None
    body: list[str] = []

    def flush():
        if part_id is not None and topic is not None:
            text = _sentences(body)
            if not text:
                raise ValueError(f"{part_id}: '{topic}' has no text")
            notes[part_id].append({"topic": topic, "text": text})
        body.clear()

    for line in path.read_text().splitlines():
        if line.startswith("## "):
            flush()
            name = line[3:].strip()
            topic = None
            if name == SOURCES_HEADING:
                part_id = None
                continue
            if name not in by_name:
                raise ValueError(f"knowledge.md section '{name}' names no part")
            part_id = by_name[name]
        elif line.startswith("### "):
            flush()
            heading = line[4:].strip()
            if part_id is None:
                raise ValueError(f"'{heading}' is outside a part section")
            if heading not in TOPICS:
                raise ValueError(f"{part_id}: unknown heading '{heading}'")
            topic = TOPICS[heading]
        elif topic is not None:
            body.append(line)
    flush()
    for part_id, part_notes in notes.items():
        topics = [n["topic"] for n in part_notes]
        if len(set(topics)) != len(topics):
            raise ValueError(f"{part_id}: a heading repeats")
    return notes
