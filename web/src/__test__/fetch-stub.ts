/** Tiny shared fetch stub used by the api and UI workflow tests. */
export type FetchCall = {
  url: string;
  init?: RequestInit;
};

export function installFetchStub(responder: (call: FetchCall) => Response | Promise<Response>): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];
  const previous = globalThis.fetch;
  const stub: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : ((input as Request).url ?? String(input));
    const call: FetchCall = { url, init };
    calls.push(call);
    return Promise.resolve(responder(call));
  };
  globalThis.fetch = stub;
  return {
    calls,
    restore: () => {
      globalThis.fetch = previous;
    },
  };
}
