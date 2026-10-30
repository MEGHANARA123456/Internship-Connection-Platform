# -----------------------------------------------------------------------------
# Logging configuration for backend requests, errors, and operational events.
# -----------------------------------------------------------------------------

import json
import logging
import sys
class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        """Serialize a record's level, logger name, message, and timestamp as a JSON object."""
        return json.dumps({
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%SZ"),
        })

def configure_logging() -> None:
    """Replace root handlers with JSON output to stdout and set the root level to INFO."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)