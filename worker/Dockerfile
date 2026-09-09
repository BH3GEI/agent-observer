FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY scoring ./scoring
COPY worker ./worker
COPY starter_kit ./starter_kit
RUN useradd -r -u 1001 sac && mkdir -p /srv/data && chown -R sac:sac /srv
USER sac
CMD ["python", "-m", "worker.main", "run"]
