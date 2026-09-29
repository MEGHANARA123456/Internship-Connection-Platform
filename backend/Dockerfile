# Base Python image for the backend service
FROM python:3.12-slim

# Set the app work directory inside the container
WORKDIR /app

# Disable bytecode generation and keep Python logs unbuffered
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=.

# Install Python dependencies required by the backend
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all application source code and migration files
COPY app ./app
COPY tests ./tests
COPY alembic ./alembic
COPY alembic.ini .

# Expose the FastAPI port
EXPOSE 8000

# IMPORTANT: Run database migrations before starting the API server.
# This means Alembic is part of the app startup process for this backend.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"]