import csv
import io
import json
import re
from pathlib import Path
from typing import Any

try:
    from openpyxl import load_workbook
except Exception:  # pragma: no cover - optional dependency used for .xlsx import.
    load_workbook = None

try:
    import xlrd
except Exception:  # pragma: no cover - optional dependency for .xls import.
    xlrd = None

try:
    from odf.opendocument import load as load_ods_document
    from odf.table import Table, TableRow, TableCell
    from odf.text import P
except Exception:  # pragma: no cover - optional dependency for .ods import.
    load_ods_document = None
    Table = TableRow = TableCell = P = None

MAX_IMPORT_FILE_SIZE = 2 * 1024 * 1024
SUPPORTED_IMPORT_FORMATS = ".csv, .tsv, .txt, .json, .xlsx, .xls, .ods"
HEADER_ALIASES = {
    "question": "prompt",
    "question_text": "prompt",
    "title": "prompt",
    "category": "topic",
    "skill": "topic",
    "topic_id": "topic",
    "choices": "options",
    "answers": "options",
    "answer_options": "options",
    "option_a": "options",
    "option_b": "options",
    "option_c": "options",
    "option_d": "options",
    "option_1": "options",
    "option_2": "options",
    "option_3": "options",
    "option_4": "options",
    "answer": "correct_index",
    "correct": "correct_index",
    "correct_option": "correct_index",
    "correct_answer": "correct_index",
    "level": "difficulty",
    "type": "question_type",
    "subtopic_id": "subtopic",
    "resource_title": "resource_title",
    "resource_url": "resource_url",
    "resource_subtopic": "resource_subtopic",
    "question_type": "question_type",
    "difficulty": "difficulty",
}

HEADER_GROUPS = {
    "topic": {"topic", "category", "skill", "topic_id"},
    "prompt": {"prompt", "question", "question_text", "title"},
    "options": {"options", "choices", "answers", "answer_options", "option_a", "option_b", "option_c", "option_d", "option_1", "option_2", "option_3", "option_4"},
    "explanation": {"explanation"},
    "difficulty": {"difficulty", "level"},
    "correct_index": {"correct_index", "answer", "correct", "correct_option", "correct_answer"},
    "question_type": {"question_type", "type"},
    "subtopic": {"subtopic", "subtopic_id"},
    "resource_title": {"resource_title"},
    "resource_url": {"resource_url"},
    "resource_subtopic": {"resource_subtopic"},
}


def normalize_header(value: Any) -> str:
    """Normalize import headers to a stable alias-friendly form."""
    cleaned = str(value or "").strip().lower()
    cleaned = cleaned.replace("-", "_").replace(" ", "_")
    cleaned = re.sub(r"[^a-z0-9_]+", "_", cleaned)
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned


def detect_import_kind(filename: str | None, raw_bytes: bytes) -> str:
    """Identify the supported import format using both the filename and file content."""
    lowered = (filename or "").lower()
    if lowered.endswith(".csv"):
        return "csv"
    if lowered.endswith(".tsv"):
        return "tsv"
    if lowered.endswith(".txt"):
        return "txt"
    if lowered.endswith(".json"):
        return "json"
    if lowered.endswith(".xlsx"):
        return "xlsx"
    if lowered.endswith(".xls"):
        return "xls"
    if lowered.endswith(".ods"):
        return "ods"
    if raw_bytes.startswith(b"{") or raw_bytes.lstrip().startswith(b"["):
        return "json"
    if raw_bytes.startswith(b"PK"):
        return "xlsx"
    if raw_bytes.startswith(b"\xD0\xCF\x11\xE0"):
        return "xls"
    return "csv"


def decode_text(raw_bytes: bytes) -> str:
    """Decode a text import using the supported utf-8 and cp1252 codes."""
    for encoding in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            return raw_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw_bytes.decode("utf-8", errors="replace")


def parse_option_string(value: Any) -> list[str]:
    """Convert several option formats into a clean list of option strings."""
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, (int, float)):
        return [str(value)]
    text = str(value).strip()
    if not text:
        return []
    if text.startswith("["):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return [str(item).strip() for item in parsed if str(item).strip()]
        except json.JSONDecodeError:
            pass
    separators = ["|", ";", "\n", "\r\n"]
    for separator in separators:
        if separator in text:
            parts = text.split(separator)
            result = [part.strip() for part in parts if part.strip()]
            if result:
                return result
    return [text]


def parse_correct_index(value: Any, options: list[str]) -> int | None:
    """Normalize answer values like A, 2, or an exact option label to a 0-based index."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.isdigit():
        index = int(text)
        if 0 <= index < len(options):
            return index
        return None
    if re.fullmatch(r"[A-Da-d]", text):
        index = ord(text.upper()) - ord("A")
        if 0 <= index < len(options):
            return index
        return None
    for index, option in enumerate(options):
        if option.casefold() == text.casefold():
            return index
    return None


def _normalize_row(row: dict[str, Any], row_number: int) -> dict[str, Any]:
    """Ensure each row exposes the canonical keys and collects validation errors."""
    errors: list[dict[str, str]] = []
    row_data = row or {}
    prompt = str(row_data.get("prompt") or row_data.get("question") or "").strip()
    topic = str(row_data.get("topic") or row_data.get("category") or "").strip()
    subtopic = str(row_data.get("subtopic") or row_data.get("subtopic_id") or "fundamentals").strip() or "fundamentals"
    explanation = str(row_data.get("explanation") or "").strip()
    difficulty = str(row_data.get("difficulty") or row_data.get("level") or "MEDIUM").strip().upper()
    question_type = str(row_data.get("question_type") or row_data.get("type") or "SINGLE").strip().upper()
    raw_options = row_data.get("options")
    if raw_options is None:
        raw_options = [
            row_data.get("option_a") or "",
            row_data.get("option_b") or "",
            row_data.get("option_c") or "",
            row_data.get("option_d") or "",
        ]
    options = []
    if isinstance(raw_options, str):
        options = parse_option_string(raw_options)
    elif isinstance(raw_options, list):
        options = [str(item).strip() for item in raw_options if str(item).strip()]
    elif isinstance(raw_options, dict):
        options = [str(item).strip() for item in raw_options.values() if str(item).strip()]

    correct_value = row_data.get("correct_index")
    if correct_value is None:
        correct_value = row_data.get("correct_answer") or row_data.get("answer") or row_data.get("correct") or row_data.get("correct_option")
    correct_index = parse_correct_index(correct_value, options) if correct_value is not None else None
    if correct_index is None and correct_value is not None and options:
        errors.append({"field": "correct_index", "message": "Correct answer did not match any provided option"})

    if not topic:
        errors.append({"field": "topic", "message": "Topic is required"})
    if not prompt:
        errors.append({"field": "prompt", "message": "Prompt is required"})
    if len(options) < 2:
        errors.append({"field": "options", "message": "At least two answer options are required"})
    if not explanation:
        errors.append({"field": "explanation", "message": "Explanation is required"})
    if difficulty not in {"EASY", "MEDIUM", "HARD"}:
        difficulty = "MEDIUM"
    if question_type not in {"SINGLE", "MULTI", "TRUE_FALSE"}:
        question_type = "SINGLE"

    clean_row = {
        "topic": topic.strip(),
        "prompt": prompt,
        "subtopic": subtopic.strip() or "fundamentals",
        "options": [item.strip() for item in options if item and item.strip()],
        "correct_index": correct_index,
        "correct_answers": row_data.get("correct_answers"),
        "difficulty": difficulty,
        "question_type": question_type,
        "explanation": explanation,
        "source": str(row_data.get("source") or "Admin bulk import").strip() or "Admin bulk import",
        "resource_title": str(row_data.get("resource_title") or "").strip(),
        "resource_url": str(row_data.get("resource_url") or "").strip(),
        "resource_subtopic": str(row_data.get("resource_subtopic") or "").strip(),
        "active": bool(str(row_data.get("active", True)).strip().lower() not in {"0", "false", "no", "off"}),
    }
    if clean_row["resource_title"] and not clean_row["resource_url"]:
        errors.append({"field": "resource_url", "message": "Resource URL is required when a title is provided"})
    if clean_row["resource_url"] and not clean_row["resource_title"]:
        errors.append({"field": "resource_title", "message": "Resource title is required when a URL is provided"})
    if clean_row["resource_url"]:
        from urllib.parse import urlsplit
        parts = urlsplit(clean_row["resource_url"])
        if parts.scheme not in {"http", "https"} or not parts.netloc:
            errors.append({"field": "resource_url", "message": "Resource URL must start with http:// or https://"})
    return {"row": row_number, "data": clean_row, "errors": errors}


def _validate_header_set(fieldnames: list[str]) -> None:
    """Raise a clear error when required import headers are missing."""
    found = {normalize_header(name) for name in fieldnames if name is not None}
    missing = []
    for canonical, aliases in HEADER_GROUPS.items():
        if canonical not in {"topic", "prompt", "options", "explanation", "difficulty"}:
            continue
        if not any(alias in found for alias in aliases):
            missing.append(canonical)
    if missing:
        alias_text = ", ".join(sorted({alias for field in HEADER_GROUPS for alias in HEADER_GROUPS[field]}))
        found_text = ", ".join(sorted(found)) if found else "none"
        raise ValueError(
            "Missing required headers: " + ", ".join(missing) + ". Found headers: " + found_text + ". Acceptable aliases: " + alias_text
        )


def _load_csv_rows(text: str) -> list[dict[str, Any]]:
    """Parse CSV/TSV/TXT content into row dictionaries."""
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = "," if "," in sample else "\t" if "\t" in sample else ";" if ";" in sample else "|"
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    if reader.fieldnames is None:
        raise ValueError("CSV headers are missing")
    _validate_header_set(reader.fieldnames)
    rows = []
    for raw_row in reader:
        if raw_row is None:
            continue
        row = {}
        for field_name, value in raw_row.items():
            if field_name is None:
                continue
            normalized = normalize_header(field_name)
            alias = HEADER_ALIASES.get(normalized, normalized)
            if value is not None and str(value).strip():
                row[alias] = value
        rows.append(row)
    return rows


def _load_json_rows(raw_bytes: bytes) -> list[dict[str, Any]]:
    """Load a JSON question list or {\"questions\": [...]} payload."""
    try:
        data = json.loads(decode_text(raw_bytes))
    except json.JSONDecodeError as error:
        raise ValueError("JSON content could not be parsed") from error
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        questions = data.get("questions")
        if isinstance(questions, list):
            return questions
    raise ValueError("JSON files must contain a list of question objects or a {\"questions\": [...]} object")


def _load_xlsx_rows(raw_bytes: bytes) -> list[dict[str, Any]]:
    """Load XLSX rows using openpyxl when installed."""
    if load_workbook is None:
        raise ValueError("XLSX import requires openpyxl to be installed")
    workbook = load_workbook(io.BytesIO(raw_bytes), read_only=True, data_only=True)
    sheets = workbook.sheetnames
    if not sheets:
        raise ValueError("The workbook is empty")
    rows: list[dict[str, Any]] = []
    for sheet_name in sheets:
        worksheet = workbook[sheet_name]
        raw_rows = list(worksheet.iter_rows(values_only=True))
        if not raw_rows:
            continue
        headers = [str(cell).strip() if cell is not None else "" for cell in raw_rows[0]]
        for row in raw_rows[1:]:
            entry = {}
            for index, value in enumerate(row):
                if index >= len(headers):
                    continue
                key = normalize_header(headers[index])
                alias = HEADER_ALIASES.get(key, key)
                if value is not None and str(value).strip():
                    entry[alias] = value
            if entry:
                rows.append(entry)
    return rows


def _load_xls_rows(raw_bytes: bytes) -> list[dict[str, Any]]:
    """Load XLS rows using xlrd when installed."""
    if xlrd is None:
        raise ValueError("XLS import requires xlrd to be installed")
    workbook = xlrd.open_workbook(file_contents=raw_bytes)
    rows: list[dict[str, Any]] = []
    for sheet in workbook.sheets():
        raw_rows = [sheet.row_values(row_index) for row_index in range(sheet.nrows)]
        if not raw_rows:
            continue
        headers = [str(value).strip() if value is not None else "" for value in raw_rows[0]]
        for values in raw_rows[1:]:
            entry = {}
            for index, value in enumerate(values):
                if index >= len(headers):
                    continue
                key = normalize_header(headers[index])
                alias = HEADER_ALIASES.get(key, key)
                if value is not None and str(value).strip():
                    entry[alias] = value
            if entry:
                rows.append(entry)
    return rows


def _load_ods_rows(raw_bytes: bytes) -> list[dict[str, Any]]:
    """Load ODS rows using odfpy when installed."""
    if load_ods_document is None:
        raise ValueError("ODS import requires odfpy to be installed")
    document = load_ods_document(io.BytesIO(raw_bytes))
    rows: list[dict[str, Any]] = []
    for sheet in document.spreadsheet.getElementsByType(Table):
        raw_rows: list[list[str]] = []
        for table_row in sheet.getElementsByType(TableRow):
            values = []
            for cell in table_row.getElementsByType(TableCell):
                body = "".join(node.toXml() for node in cell.getElementsByType(P))
                values.append(body or cell.getAttribute("value") or "")
            raw_rows.append(values)
        if not raw_rows:
            continue
        headers = [str(value).strip() for value in raw_rows[0]]
        for values in raw_rows[1:]:
            entry = {}
            for index, value in enumerate(values):
                if index >= len(headers):
                    continue
                key = normalize_header(headers[index])
                alias = HEADER_ALIASES.get(key, key)
                if value is not None and str(value).strip():
                    entry[alias] = value
            if entry:
                rows.append(entry)
    return rows


def parse_question_import_file(filename: str | None, raw_bytes: bytes) -> dict[str, Any]:
    """Parse an uploaded question-bank file and return row-level normalize/validation results."""
    if len(raw_bytes) > MAX_IMPORT_FILE_SIZE:
        raise ValueError("Question imports must be 2 MB or smaller")
    kind = detect_import_kind(filename, raw_bytes)
    supported = ["csv", "tsv", "txt", "json", "xlsx", "xls", "ods"]
    if kind not in supported:
        raise ValueError(f"Unsupported file type. Supported formats: {SUPPORTED_IMPORT_FORMATS}")

    if kind in {"csv", "tsv", "txt"}:
        text = decode_text(raw_bytes)
        raw_rows = _load_csv_rows(text)
    elif kind == "json":
        raw_rows = _load_json_rows(raw_bytes)
    elif kind == "xlsx":
        raw_rows = _load_xlsx_rows(raw_bytes)
    elif kind == "xls":
        raw_rows = _load_xls_rows(raw_bytes)
    elif kind == "ods":
        raw_rows = _load_ods_rows(raw_bytes)
    else:
        raise ValueError(f"Unsupported file type. Supported formats: {SUPPORTED_IMPORT_FORMATS}")

    if not raw_rows:
        raise ValueError("The uploaded file contains no rows")

    if isinstance(raw_rows[0], dict):
        fieldnames = list(raw_rows[0].keys())
        _validate_header_set(fieldnames)

    normalized_rows: list[dict[str, Any]] = []
    for row_number, raw_row in enumerate(raw_rows, start=2):
        if isinstance(raw_row, dict):
            normalized_rows.append(_normalize_row(raw_row, row_number))

    result: dict[str, Any] = {"rows": normalized_rows, "errors": [], "imported": 0, "skipped_duplicates": 0}
    return result


def build_question_import_template_csv() -> bytes:
    """Return a sample CSV import template containing three example questions."""
    template = "\n".join([
        "topic,prompt,options,correct_index,explanation,difficulty,question_type,subtopic,source,resource_title,resource_url,resource_subtopic",
        'python,"Which built-in value is used to represent the absence of a value?","[\"None\", \"null\", \"undefined\", \"void\"]",0,"Python uses None for an intentionally empty value.",easy,SINGLE,syntax,"InternSphere curated assessment bank","Python docs","https://docs.python.org/3/library/functions/open.html",syntax',
        'python,"Which file mode opens a file for writing without truncating it?","[\"a\", \"w\", \"x\", \"r\"]",1,"The append mode writes to the end of the file without clearing it.",medium,SINGLE,file_io,"InternSphere curated assessment bank","Working with files","https://docs.python.org/3/library/functions/open.html",file_io',
        'react,"Which hook is used to manage a component\'s local state?","[\"useMemo\", \"useState\", \"useEffect\", \"useCallback\"]",1,"State is tracked in a component with the useState hook.",easy,SINGLE,components,"InternSphere curated assessment bank","React docs","https://react.dev/reference/react/useState",components',
    ])
    return template.encode("utf-8")


def build_question_import_template_xlsx() -> bytes | None:
    """Create a small XLSX template when openpyxl is available."""
    if load_workbook is None:
        return None
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Questions"
    rows = [
        ["topic", "prompt", "options", "correct_index", "explanation", "difficulty", "question_type", "subtopic", "source", "resource_title", "resource_url", "resource_subtopic"],
        ["python", "Which built-in value is used to represent the absence of a value?", '["None", "null", "undefined", "void"]', 0, "Python uses None for an intentionally empty value.", "easy", "SINGLE", "syntax", "InternSphere curated assessment bank", "Python docs", "https://docs.python.org/3/library/functions/open.html", "syntax"],
        ["python", "Which file mode opens a file for writing without truncating it?", '["a", "w", "x", "r"]', 1, "The append mode writes to the end of the file without clearing it.", "medium", "SINGLE", "file_io", "InternSphere curated assessment bank", "Working with files", "https://docs.python.org/3/library/functions/open.html", "file_io"],
        ["react", "Which hook is used to manage a component's local state?", '["useMemo", "useState", "useEffect", "useCallback"]', 1, "State is tracked in a component with the useState hook.", "easy", "SINGLE", "components", "InternSphere curated assessment bank", "React docs", "https://react.dev/reference/react/useState", "components"],
    ]
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
