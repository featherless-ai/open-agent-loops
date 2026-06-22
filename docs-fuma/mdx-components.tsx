import defaultMdxComponents from "fumadocs-ui/mdx";
import { Callout } from "fumadocs-ui/components/callout";
import { Card, Cards } from "fumadocs-ui/components/card";
import type { MDXComponents } from "mdx/types";
import { LoopDiagram } from "./components/loop-diagram";
import { CodeExecutionDiagram } from "./components/code-execution-diagram";
import { WireFormatDiagram } from "./components/wire-format-diagram";

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Callout,
    Card,
    Cards,
    LoopDiagram,
    CodeExecutionDiagram,
    WireFormatDiagram,
    ...components,
  };
}
