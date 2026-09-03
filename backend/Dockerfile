FROM python:3.11-slim

WORKDIR /app

# Install curl (healthcheck) + libpq (postgres client)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all source files
COPY main.py database.py models.py seed.py migrate.py \
     mailer.py email_templates.py notifications.py email_worker.py ./

# Uploads directory
RUN mkdir -p /app/uploads

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
