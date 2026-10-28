# Base Python image for the backend service
FROM python:3.12-slim

# Set the app work directory inside the container
WORKDIR /app

# Disable bytecode generation and keep Python logs unbuffered
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=.

# Install Python dependencies required by the backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all application source code and migration files
COPY backend/app ./app
COPY backend/kb ./kb
COPY backend/alembic ./alembic
COPY backend/alembic.ini .

# Expose the FastAPI port
EXPOSE 8000

# The FastAPI lifespan applies Alembic migrations before serving requests.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]