FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libffi-dev && \
    rm -rf /var/lib/apt/lists/*

# Copy into /app/etl/ so the package is importable as "etl.*"
# (main.py and the rest of etl/ share the same package namespace)
WORKDIR /app
COPY requirements.txt .
# p4d 1.8 uses CFFI-generated C code that triggers an -Wincompatible-pointer-types
# error on GCC 14+ (treated as error by default).  Installed separately so the
# CFLAGS workaround is scoped only to this C extension; other packages install
# normally.  p4d is kept out of requirements.txt so the CI test job (which
# cannot set build env vars) can install dependencies without compilation.
RUN CFLAGS="-Wno-incompatible-pointer-types" pip install --no-cache-dir p4d && \
    pip install --no-cache-dir -r requirements.txt && \
    opentelemetry-bootstrap -a install
COPY . etl/

CMD ["opentelemetry-instrument", "python", "-u", "-m", "etl.main"]
