import { describe, expect, it } from "bun:test";

import { audioPart, contentToText, filePart, imagePart, textPart, userMessage } from "../types";
import { Role } from "../types";

describe("content-part factories", () => {
  it("textPart carries the text", () => {
    expect(textPart("hi")).toEqual({ type: "text", text: "hi" });
  });

  it("imagePart defaults to no detail hint", () => {
    expect(imagePart("https://x/y.png")).toEqual({
      type: "image_url",
      image_url: { url: "https://x/y.png" },
    });
  });

  it("imagePart includes the detail hint when given", () => {
    expect(imagePart("data:image/png;base64,AAAA", "high")).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAAA", detail: "high" },
    });
  });

  it("audioPart carries the base64 data and format", () => {
    expect(audioPart("AQID", "wav")).toEqual({
      type: "input_audio",
      input_audio: { data: "AQID", format: "wav" },
    });
  });

  it("filePart passes the file reference through verbatim", () => {
    expect(filePart({ file_data: "data:application/pdf;base64,JVB", filename: "report.pdf" })).toEqual({
      type: "file",
      file: { file_data: "data:application/pdf;base64,JVB", filename: "report.pdf" },
    });
  });
});

describe("contentToText", () => {
  it("passes a plain string through unchanged", () => {
    expect(contentToText("just text")).toBe("just text");
  });

  it("flattens text parts verbatim and non-text parts to placeholders", () => {
    const content = [
      textPart("look at "),
      imagePart("https://x/y.png"),
      audioPart("AQID", "mp3"),
      filePart({ filename: "report.pdf" }),
      filePart({ file_id: "f_1" }),
    ];
    expect(contentToText(content)).toBe("look at [image][audio][file: report.pdf][file]");
  });
});

describe("userMessage with multimodal content", () => {
  it("accepts a ContentPart[] as content", () => {
    const content = [textPart("describe this"), imagePart("https://x/y.png", "low")];
    expect(userMessage({ content, timestamp: 5 })).toEqual({
      role: Role.User,
      content,
      timestamp: 5,
    });
  });
});
