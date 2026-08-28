---
id: D-042
title: Restore OTel trace sampling as SDK head sampling, not a collector processor
date: 2026-08-28
---

# D-042: Restore OTel trace sampling as SDK head sampling

*Decided: 2026-08-28*

**Context**: `docker compose up -d otel-collector` put the collector in a
permanent crash loop:

```
failed to get config: cannot unmarshal the configuration:
error decoding 'processors': unknown type: "tail_sampling" for id: "tail_sampling"
  (valid values: [batch filter k8sattributes elasticinframetrics resourcedetection
   memory_limiter resource attributes transform lsminterval elastictrace])
error decoding 'extensions': unknown type: "zpages" for id: "zpages"
  (valid values: [file_storage health_check bearertokenauth apikeyauth healthcheckv2
   pprof k8s_observer apmconfig agent_status memory_limiter])
```

The pinned `docker.elastic.co/elastic-agent/elastic-agent:8.16.0` image does
not compile the `tail_sampling` processor or the `zpages` extension that
`otel/otelcol-config.yaml` declared. Because `tail_sampling` was referenced
inside the `traces` pipeline (not just defined and unused), the whole
collector config failed to unmarshal and the collector process never started
— so `health_check` never bound, the container was permanently `unhealthy`,
and both `etl` (docker-compose.yml) and `dashboard` — both
`depends_on: otel-collector: condition: service_healthy` — could never start.
`docker compose up -d` was unable to bring up the local stack at all.

Before falling back, checked whether a readily available image compiles both
components, since the intended design (keep 100% of error/slow traces, sample
10% of the rest, zpages for live introspection) is genuinely better than plain
head sampling:
- Pulled `docker.elastic.co/elastic-agent/elastic-agent:8.19.0` (latest at
  time of writing) and ran it against a probe config referencing both
  `tail_sampling` and `zpages`. Same failure mode; the `processors`
  valid-values list moved between the two pinned versions (8.16.0 above has
  `lsminterval`, 8.19.0 has `geoip`/`cumulativetodelta` instead):
  `'processors' unknown type: "tail_sampling" ... (valid values: [memory_limiter
  elastictrace resource attributes transform filter geoip resourcedetection
  batch cumulativetodelta k8sattributes elasticinframetrics])`. The
  `extensions` valid-values list is unchanged from the 8.16.0 error quoted
  above — `'extensions' unknown type: "zpages" ... (valid values: [file_storage
  health_check bearertokenauth apikeyauth healthcheckv2 pprof k8s_observer
  apmconfig agent_status memory_limiter])` — same set at both versions.
  Neither `tail_sampling` nor `zpages` ever ships in an Elastic-Agent-flavored
  EDOT build at either version — Elastic's own `elastictrace` processor is
  span enrichment, not a sampler.
- `otel/opentelemetry-collector-contrib` does ship both, but swapping the base
  image would also change the exporter/processor set the current config is
  built around (`otlphttp/elasticsearch`, Elastic-specific defaults) and would
  need re-validating the whole image against the stack — disproportionate for
  a local-dev/file-sink deployment with no volume-cost pressure driving this.
  Left as a future option if the production APM story ever needs preferential
  error/slow-trace retention badly enough to justify the exporter rework.

**Decision**: Restore sampling at the SDK level via head sampling rather than
swap the collector image. `otel/otelcol-config.yaml` drops the `zpages`
extension and the `tail_sampling` processor entirely (the `traces` pipeline
now runs `[memory_limiter, attributes/redact, resource, batch]`, matching the
`metrics`/`logs` pipelines' processor list). `etl` and `dashboard` in
`docker-compose.yml` set `OTEL_TRACES_SAMPLER=parentbased_traceidratio` and
`OTEL_TRACES_SAMPLER_ARG=0.1` (both overridable via env; default 10%).
`parentbased_traceidratio` is a deterministic, trace-ID-based decision, so a
whole trace is kept or dropped together and child spans honor the root's
decision. A local debugging session can keep every trace with
`OTEL_TRACES_SAMPLER_ARG=1.0` or `OTEL_TRACES_SAMPLER=parentbased_always_on`.
`.env.example` documents the same default.

Production (`docker-compose.prod.yml`) has no `otel-collector` service at all
and is unaffected by any of this — this was purely a local-dev/stack breaker.

**Alternatives rejected**:
- *Swap to a newer `elastic-agent` tag*: checked (8.19.0) — still doesn't
  compile either component, just a different valid-values list. Not a fix at
  any pinned Elastic Agent version currently published.
- *Swap to `otel/opentelemetry-collector-contrib`*: does compile
  `tail_sampling`/`zpages`, but changes the exporter story (this config is
  Elastic-tuned) and requires re-validating the whole image — disproportionate
  for what is today a file-sink local-dev deployment.
- *Leave `parentbased_always_on`*: exports every trace with no volume control
  now that nothing downstream trims it — the crash-loop investigation exists
  specifically to fix a regression like that, not reintroduce one.

**Rationale**: Lowest-risk change that works with the *currently pinned*
image — no image swap, so the collector's now-healthy startup stays simple and
verified. It restores configurable trace-volume control with a sensible 10%
default and a clear env knob on both services. The only capability not
restored is tail sampling's ability to preferentially keep error/slow traces,
since head sampling decides before a trace's outcome/duration is known —
acceptable for local dev with a file-sink export path, revisit if/when the
production APM pipeline needs it.

**See**: `otel/otelcol-config.yaml` (processors + traces pipeline comments),
`docker-compose.yml` (etl/dashboard `OTEL_TRACES_SAMPLER*` env), `.env.example`.
