import { describe, expect, it } from "vitest";

import {
  AbortAcknowledgedExecutionWriter,
  ExecutionWriteAbortedError,
  ExecutionWriteQueueCapacityError,
} from "../src/abortable-execution-writer.js";
import { InvalidEventError } from "../src/index.js";

function deferred<T = void>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe("AbortAcknowledgedExecutionWriter", () => {
  it("releases a running write only after explicit abort acknowledgement", async () => {
    const writer = new AbortAcknowledgedExecutionWriter();
    const order: string[] = [];
    const firstStarted = deferred();
    const lateSettlement = deferred();

    const first = writer.enqueue("execution-1", async ({ signal, acknowledgeAbort }) => {
      order.push("first-start");
      firstStarted.resolve();
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          order.push("first-abort-observed");
          acknowledgeAbort();
          resolve();
        });
      });
      await lateSettlement.promise;
      order.push("first-late-settlement");
      return "late";
    });

    await firstStarted.promise;

    const second = writer.enqueue("execution-1", () => {
      order.push("second");
      return "second";
    });

    first.abort("deadline");
    await first.abortAcknowledged;
    await expect(first.result).rejects.toBeInstanceOf(ExecutionWriteAbortedError);
    await expect(second.result).resolves.toBe("second");

    expect(order).toEqual([
      "first-start",
      "first-abort-observed",
      "second",
    ]);

    lateSettlement.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual([
      "first-start",
      "first-abort-observed",
      "second",
      "first-late-settlement",
    ]);
    expect(first.getState()).toBe("aborted");
    expect(second.getState()).toBe("committed");
  });

  it("removes a queued write immediately when aborted before start", async () => {
    const writer = new AbortAcknowledgedExecutionWriter();
    const gate = deferred();
    const order: string[] = [];

    const first = writer.enqueue("execution-1", async () => {
      order.push("first-start");
      await gate.promise;
      order.push("first-end");
    });

    const skipped = writer.enqueue("execution-1", () => {
      order.push("skipped");
    });
    const third = writer.enqueue("execution-1", () => {
      order.push("third");
      return 3;
    });

    skipped.abort("cancelled before start");
    await skipped.abortAcknowledged;
    await expect(skipped.result).rejects.toBeInstanceOf(ExecutionWriteAbortedError);

    gate.resolve();
    await first.result;
    await expect(third.result).resolves.toBe(3);

    expect(order).toEqual(["first-start", "first-end", "third"]);
  });

  it("does not let one execution block another execution", async () => {
    const writer = new AbortAcknowledgedExecutionWriter();
    const gate = deferred();
    const order: string[] = [];

    const first = writer.enqueue("execution-1", async () => {
      order.push("execution-1-start");
      await gate.promise;
      order.push("execution-1-end");
    });

    const other = writer.enqueue("execution-2", () => {
      order.push("execution-2");
    });

    await other.result;
    expect(order).toEqual(["execution-1-start", "execution-2"]);

    gate.resolve();
    await first.result;
    expect(order).toEqual([
      "execution-1-start",
      "execution-2",
      "execution-1-end",
    ]);
  });

  it("fails closed when one execution reaches its configured queue capacity", async () => {
    const writer = new AbortAcknowledgedExecutionWriter({
      maxWritesPerExecution: 2,
    });
    const gate = deferred();

    const first = writer.enqueue("execution-1", async () => {
      await gate.promise;
      return "first";
    });
    const second = writer.enqueue("execution-1", () => "second");

    expect(() => writer.enqueue("execution-1", () => "overflow")).toThrow(
      ExecutionWriteQueueCapacityError,
    );

    const independent = writer.enqueue("execution-2", () => "independent");
    await expect(independent.result).resolves.toBe("independent");

    gate.resolve();
    await expect(first.result).resolves.toBe("first");
    await expect(second.result).resolves.toBe("second");
  });

  it("reclaims queue capacity when a queued write is aborted", async () => {
    const writer = new AbortAcknowledgedExecutionWriter({
      maxWritesPerExecution: 2,
    });
    const gate = deferred();

    const first = writer.enqueue("execution-1", async () => {
      await gate.promise;
    });
    const cancelled = writer.enqueue("execution-1", () => "cancelled");

    cancelled.abort("not needed");
    await cancelled.abortAcknowledged;
    await expect(cancelled.result).rejects.toBeInstanceOf(ExecutionWriteAbortedError);

    const replacement = writer.enqueue("execution-1", () => "replacement");
    gate.resolve();
    await first.result;
    await expect(replacement.result).resolves.toBe("replacement");
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid maxWritesPerExecution value %p",
    (maxWritesPerExecution) => {
      expect(
        () =>
          new AbortAcknowledgedExecutionWriter({ maxWritesPerExecution }),
      ).toThrow(InvalidEventError);
    },
  );
});
