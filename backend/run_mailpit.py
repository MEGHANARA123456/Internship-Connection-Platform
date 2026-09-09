import sys
import os

# Ensure backend directory is in sys.path
sys.path.insert(0, os.path.dirname(__file__))

from app.services.mailpit_server import start_mailpit_service

if __name__ == "__main__":
    print("[*] Starting Mailpit Webmail on http://localhost:8025 ...")
    start_mailpit_service(host="0.0.0.0", port=8025)
