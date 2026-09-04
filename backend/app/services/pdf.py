import logging
from pathlib import Path

logger = logging.getLogger(__name__)

def extract_text_from_pdf(file_path: str | Path) -> str:
    path = Path(file_path)
    if not path.is_file():
        return ""
    try:
        from pypdf import PdfReader
        reader = PdfReader(str(path))
        text_parts = []
        for page in reader.pages:
            extracted = page.extract_text()
            if extracted:
                text_parts.append(extracted)
        return "\n".join(text_parts).strip()
    except Exception as exc:
        logger.warning("Error reading PDF %s: %s", path, exc)
        return ""
