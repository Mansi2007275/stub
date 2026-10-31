import { StringDecoder } from "node:string_decoder";

/** Reads only a real terminal with echo disabled. No clipboard, arguments, files or env values. */
export function readHiddenKeyResult(input = process.stdin, output = process.stderr) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    return Promise.resolve({ value: null, failureCategory: "non_interactive_terminal" });
  }
  return new Promise(resolve => {
    let value = "";
    let pending = "";
    let inPaste = false;
    let failureCategory = null;
    let overflow = false;
    let finished = false;
    const decoder = new StringDecoder("utf8");
    const pasteStart = "\x1b[200~";
    const pasteEnd = "\x1b[201~";
    const wasRaw = !!input.isRaw;
    const finish = (answer, category = failureCategory) => {
      if (finished) return;
      finished = true;
      input.removeListener("data", onData);
      input.removeListener("error", streamError);
      input.removeListener("end", streamEnd);
      try { input.setRawMode(wasRaw); } catch { /* no error payloads */ }
      input.pause();
      value = "";
      pending = "";
      try { output.write("\n"); } catch { /* no error payloads */ }
      resolve({ value: answer, failureCategory: category });
    };
    const cancel = () => finish(null, "input_cancelled");
    const streamError = () => finish(null, "input_error");
    const streamEnd = () => finish(value, inPaste ? "incomplete_bracketed_paste" : "input_ended");
    const append = character => {
      if (value.length + character.length > 1024) overflow = true;
      else value += character;
    };
    const onData = chunk => {
      try {
        pending += typeof chunk === "string" ? chunk : decoder.write(chunk);
        while (pending && !finished) {
          if (pending[0] === "\x1b") {
            // Protocol framing may be split over several Windows paste chunks.
            if ([pasteStart, pasteEnd].some(token => token.startsWith(pending) && pending.length < token.length)) return;
            if (pending.startsWith(pasteStart)) {
              if (inPaste) failureCategory = "unsupported_terminal_sequence";
              inPaste = true;
              pending = pending.slice(pasteStart.length);
              continue;
            }
            if (pending.startsWith(pasteEnd)) {
              if (!inPaste) failureCategory = "unsupported_terminal_sequence";
              inPaste = false;
              pending = pending.slice(pasteEnd.length);
              continue;
            }
            failureCategory = "unsupported_terminal_sequence";
          }
          const character = String.fromCodePoint(pending.codePointAt(0));
          pending = pending.slice(character.length);
          if (!inPaste && (character === "\r" || character === "\n")) {
            finish(overflow ? null : value, overflow ? "input_too_long" : failureCategory); return;
          }
          if (character === "\x03" || character === "\x04") { cancel(); return; }
          if (!inPaste && (character === "\x7f" || character === "\b")) { value = value.slice(0, -1); continue; }
          if (character === "\x16") failureCategory = "paste_not_delivered";
          append(character);
        }
      } catch { streamError(); }
    };
    try {
      input.setRawMode(true);
      output.write("Gateway private key (input hidden): ");
      input.on("data", onData);
      input.once("error", streamError);
      input.once("end", streamEnd);
      input.resume();
    } catch { streamError(); }
  });
}

export async function readHiddenKey(input = process.stdin, output = process.stderr) {
  const result = await readHiddenKeyResult(input, output);
  return result.failureCategory ? null : result.value;
}
