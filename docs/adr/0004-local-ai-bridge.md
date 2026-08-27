# ADR 0004 — Local AI through a companion bridge, never from the server

**Status:** accepted · **Date:** 2026-08

## Context

The product offers optional AI help — turning pasted coursework into a task,
summarising an announcement, proposing a study plan — and the requirement is
that it runs on the student's own machine, against Ollama or any
OpenAI-compatible endpoint. The app itself is cloud-hosted.

## Decision

A small companion process (`bridge/school-os-bridge.mjs`) runs on the student's
computer, bound to `127.0.0.1`. The **browser** talks to it directly. The server
never does.

Pairing is a short-lived, single-use code: the app issues it (storing only its
hash), the student types it into the bridge, the bridge exchanges it for a
device token scoped to that account and to an explicit capability list. The
bridge additionally checks the `Origin` of every request, so a random web page
cannot drive the student's model.

## Why not have the server call the model

Because on a server, `localhost` means *the server*. A cloud process reaching
for a local endpoint is at best broken and at worst an SSRF primitive pointed at
its own metadata service. Routing through the browser is the only arrangement
where "your coursework never leaves your machine" is structurally true rather
than a policy statement.

## Consequences

- The server stores a device label, a model name, a token hash and the granted
  scopes. It never sees the endpoint, the prompts or the responses.
- AI availability is *measured*, not assumed: the browser probes the bridge and
  shows "Offline" the moment it cannot reach it. No feature waits on that probe.
- Every AI action shows the exact text that will be sent before sending it, and
  returns a preview the student confirms before anything is saved.
- Extracted deadlines must cite the substring they came from; one with no
  evidence in the source text is discarded rather than shown. The deterministic
  quick-add parser is the fallback, and is also the everyday fast path — so the
  offline experience is the normal experience, not a degraded one.
