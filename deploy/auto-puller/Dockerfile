# Phase 2 auto-puller - queries modalities and pulls missing studies into Orthanc.
# Build: docker build -t dicomviewer/auto-puller deploy/auto-puller/
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY auto_puller.py .

# run as non-root
RUN useradd --system --uid 1001 puller
USER puller

# sane docker defaults: stop within 5s on SIGTERM
ENV PYTHONUNBUFFERED=1
STOPSIGNAL SIGTERM

CMD ["python", "-u", "auto_puller.py"]
