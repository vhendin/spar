# Importer image: GDAL with Python bindings, osmium and the importer package.
FROM ghcr.io/osgeo/gdal:ubuntu-small-latest
RUN apt-get update \
 && apt-get install -y --no-install-recommends osmium-tool python3-numpy python3-jsonschema python3-pytest \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY spar_importer /app/spar_importer
COPY tests /app/tests
ENV PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    SPAR_DATA=/data \
    SPAR_DEFS=/defs \
    SPAR_SCHEMAS=/schemas
ENTRYPOINT ["python3", "-m", "spar_importer"]
