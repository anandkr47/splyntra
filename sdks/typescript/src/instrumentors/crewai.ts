// SPDX-License-Identifier: Apache-2.0
import { trace, SpanKind, SpanStatusCode, Span } from "@opentelemetry/api";

/**
 * Auto-instrument CrewAI.js. Wraps Crew.kickoff (agent span), Task.execute
 * (step span), and BaseTool.run (tool_call span) to emit nested spans, mirroring
 * the Python CrewAI adapter. Best-effort: a safe no-op if the package is absent
 * or its internals have moved. Returns true if any method was wrapped.
 */
export function instrumentCrewAI(): boolean {
  let crewai: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    crewai = require("crewai");
  } catch {
    return false;
  }

  let wrapped = false;
  wrapped = wrapMethod(crewai?.Crew?.prototype, ["kickoff", "kickoffAsync"], "agent", (self) => self?.name || "crew") || wrapped;
  wrapped = wrapMethod(crewai?.Task?.prototype, ["execute", "executeAsync"], "step", (self) => self?.name || self?.description?.slice?.(0, 40) || "task") || wrapped;
  const BaseTool = crewai?.tools?.BaseTool ?? crewai?.BaseTool;
  wrapped = wrapMethod(BaseTool?.prototype, ["run", "_run"], "tool_call", (self) => self?.name || "tool") || wrapped;
  return wrapped;
}

// wrapMethod patches the first present method name on proto with a span-emitting
// wrapper. Returns true if it wrapped one.
function wrapMethod(
  proto: any,
  methodNames: string[],
  spanType: string,
  nameOf: (self: any, args: any[]) => string
): boolean {
  if (!proto) return false;
  const method = methodNames.find((m) => typeof proto[m] === "function" && !proto[m].__splyntraWrapped);
  if (!method) return false;
  const original = proto[method];
  function patched(this: any, ...args: any[]) {
    const name = nameOf(this, args);
    const tracer = trace.getTracer("splyntra.crewai");
    return tracer.startActiveSpan(
      name,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "splyntra.span.type": spanType,
          [spanType === "tool_call" ? "splyntra.tool.name" : "splyntra.agent.name"]: name,
          "splyntra.framework": "crewai",
        },
      },
      (span: Span) => {
        let result: any;
        try {
          result = original.apply(this, args);
        } catch (err: any) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
          span.recordException(err);
          span.end();
          throw err;
        }
        return Promise.resolve(result)
          .then((res: any) => {
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return res;
          })
          .catch((err: any) => {
            span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
            span.recordException(err);
            span.end();
            throw err;
          });
      }
    );
  }
  (patched as any).__splyntraWrapped = true;
  proto[method] = patched;
  return true;
}
